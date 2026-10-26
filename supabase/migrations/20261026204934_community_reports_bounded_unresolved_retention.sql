-- Bound private report detail and identity retention for both fresh and upgraded databases.
-- Engineering proposal pending owner/legal review; never treat as a legal period.
update public.community_artwork_reports
set retention_expires_at = case
  when status in ('resolved', 'dismissed') then least(
    coalesce(retention_expires_at, coalesce(resolved_at, created_at) + interval '30 days'),
    coalesce(resolved_at, created_at) + interval '30 days',
    created_at + interval '90 days'
  )
  else coalesce(retention_expires_at, created_at + interval '90 days')
end
where retention_expires_at is null
   or retention_expires_at > created_at + interval '90 days'
   or (status in ('resolved', 'dismissed') and retention_expires_at > coalesce(resolved_at, created_at) + interval '30 days');

create index if not exists community_artwork_reports_retention_idx
  on public.community_artwork_reports (retention_expires_at, id)
  where retention_expires_at is not null;

create or replace function public.community_create_artwork_report(
  p_actor_user_id uuid,
  p_artwork_id uuid,
  p_reason text,
  p_details text default ''
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_report_id uuid;
  v_author_id uuid;
begin
  if p_actor_user_id is null or p_artwork_id is null or p_reason is null
    or p_reason not in ('rights', 'privacy', 'harmful', 'other')
    or char_length(coalesce(p_details, '')) > 500 then
    raise exception using errcode = '22023', message = 'invalid report';
  end if;
  if not private.community_actor_is_verified(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'verified account required';
  end if;
  -- Reporters need a verified account, not a club profile or book unlock.
  select artwork.author_id into v_author_id
  from public.community_artworks artwork
  join public.products product on product.id = artwork.product_id
  join public.community_profiles author on author.user_id = artwork.author_id
  where artwork.id = p_artwork_id
    and artwork.status = 'approved' and artwork.published_at is not null and artwork.deleted_at is null
    and product.status = 'published'
    and author.is_adult and author.adult_attested_at is not null and author.opted_in_at is not null
    and author.participation_revoked_at is null and author.suspended_at is null
    and author.rules_version = '2026-10-25-v1';
  if v_author_id is null then
    raise exception using errcode = '40001', message = 'report target unavailable';
  end if;
  insert into public.community_artwork_reports (artwork_id, reporter_user_id, reason, details, retention_expires_at)
  values (p_artwork_id, p_actor_user_id, p_reason, btrim(coalesce(p_details, '')), now() + interval '90 days')
  on conflict (reporter_user_id, artwork_id) where reporter_user_id is not null do nothing
  returning id into v_report_id;
  if v_report_id is null then
    select id into v_report_id from public.community_artwork_reports
    where artwork_id = p_artwork_id and reporter_user_id = p_actor_user_id;
    return jsonb_build_object('reportId', v_report_id, 'duplicate', true);
  end if;
  insert into public.community_artwork_report_events (report_id, actor_user_id, action, from_status, to_status)
  values (v_report_id, p_actor_user_id, 'submitted', null, 'open');
  return jsonb_build_object('reportId', v_report_id, 'duplicate', false);
end;
$$;

create or replace function public.community_update_artwork_report(
  p_actor_user_id uuid,
  p_report_id uuid,
  p_expected_revision integer,
  p_action text
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_report public.community_artwork_reports%rowtype;
  v_admin_role text;
  v_next_status text;
  v_revision integer;
begin
  if p_action is null or p_report_id is null or p_expected_revision is null or p_expected_revision < 1
    or p_action not in ('reviewed', 'resolve', 'dismiss') then
    raise exception using errcode = '22023', message = 'invalid report action';
  end if;
  if not private.community_actor_is_verified(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  select profile.role into v_admin_role from public.profiles profile
  where profile.id = p_actor_user_id for share;
  if v_admin_role is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  select * into v_report from public.community_artwork_reports
  where id = p_report_id for update;
  if not found or v_report.revision <> p_expected_revision
    or v_report.status in ('resolved', 'dismissed') then
    raise exception using errcode = '40001', message = 'report revision changed';
  end if;
  v_next_status := case p_action when 'reviewed' then 'reviewed' when 'resolve' then 'resolved' else 'dismissed' end;
  update public.community_artwork_reports set status = v_next_status, revision = revision + 1,
    updated_at = now(), resolved_at = case when v_next_status in ('resolved', 'dismissed') then now() else null end,
    retention_expires_at = case
      when v_next_status in ('resolved', 'dismissed') then least(now() + interval '30 days', v_report.created_at + interval '90 days')
      else retention_expires_at
    end
  where id = p_report_id returning revision into v_revision;
  insert into public.community_artwork_report_events (report_id, actor_user_id, action, from_status, to_status)
  values (p_report_id, p_actor_user_id, p_action, v_report.status, v_next_status);
  return v_revision;
end;
$$;

create or replace function public.community_purge_expired_report_details(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_count integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'invalid retention batch size';
  end if;
  select array_agg(id) into v_ids from (
    select report.id from public.community_artwork_reports report
    where report.retention_expires_at <= now()
      and (report.reporter_user_id is not null or report.details <> '' or exists (
        select 1 from public.community_artwork_report_events event
        where event.report_id = report.id and event.actor_user_id is not null
      ))
    order by report.retention_expires_at, report.id
    limit p_limit for update skip locked
  ) expired;
  if v_ids is null then return 0; end if;
  update public.community_artwork_report_events event
  set actor_user_id = null
  where event.report_id = any(v_ids);
  with scrubbed as (
    update public.community_artwork_reports report
    set reporter_user_id = null, details = '', revision = revision + 1, updated_at = now()
    where report.id = any(v_ids)
    returning report.id, report.status
  )
  insert into public.community_artwork_report_events (report_id, action, from_status, to_status)
  select id, 'retention_scrubbed', status, status from scrubbed;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

