-- Private abuse reports. Raw report text and reporter identity are never
-- exposed through anonymous/authenticated Data API access.
create table public.community_artwork_reports (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references public.community_artworks(id) on delete restrict,
  reporter_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (reason in ('rights', 'privacy', 'harmful', 'other')),
  details text not null default '' check (char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved', 'dismissed')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  retention_expires_at timestamptz
);
create unique index community_artwork_reports_reporter_artwork_unique
  on public.community_artwork_reports (reporter_user_id, artwork_id)
  where reporter_user_id is not null;
create index community_artwork_reports_admin_page_idx
  on public.community_artwork_reports (created_at desc, id desc);
create index community_artwork_reports_status_page_idx
  on public.community_artwork_reports (status, created_at desc, id desc);

create table public.community_artwork_report_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.community_artwork_reports(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('submitted', 'reviewed', 'resolve', 'dismiss', 'retention_scrubbed')),
  from_status text check (from_status in ('open', 'reviewed', 'resolved', 'dismissed')),
  to_status text not null check (to_status in ('open', 'reviewed', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);
create index community_artwork_report_events_report_idx
  on public.community_artwork_report_events (report_id, created_at desc, id desc);

alter table public.community_artwork_reports enable row level security;
alter table public.community_artwork_report_events enable row level security;
revoke all on public.community_artwork_reports, public.community_artwork_report_events from public, anon, authenticated;
grant select, insert, update, delete on public.community_artwork_reports to service_role;
grant select, insert on public.community_artwork_report_events to service_role;
grant usage, select on sequence public.community_artwork_report_events_id_seq to service_role;

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
  if p_actor_user_id is null or p_artwork_id is null
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
  insert into public.community_artwork_reports (artwork_id, reporter_user_id, reason, details)
  values (p_artwork_id, p_actor_user_id, p_reason, btrim(coalesce(p_details, '')))
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
  if p_action not in ('reviewed', 'resolve', 'dismiss') then
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
    retention_expires_at = case when v_next_status in ('resolved', 'dismissed') then now() + interval '30 days' else null end
  where id = p_report_id returning revision into v_revision;
  insert into public.community_artwork_report_events (report_id, actor_user_id, action, from_status, to_status)
  values (p_report_id, p_actor_user_id, p_action, v_report.status, v_next_status);
  return v_revision;
end;
$$;

-- Reports remain in the private queue until handled. After resolution, the
-- operational retention draft is 30 days; this scrub removes reporter linkage
-- and optional free text while retaining only category/status audit metadata.
create or replace function public.community_purge_expired_report_details(p_limit integer default 100)
returns integer
language plpgsql
security invoker
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
    where report.status in ('resolved', 'dismissed')
      and report.retention_expires_at <= now()
      and (report.reporter_user_id is not null or report.details <> '')
    order by report.retention_expires_at, report.id
    limit p_limit for update skip locked
  ) expired;
  if v_ids is null then return 0; end if;
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

create or replace function private.community_anonymize_deleted_reporter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.community_artwork_reports
  set reporter_user_id = null, details = '', revision = revision + 1, updated_at = now()
  where reporter_user_id = old.id;
  return old;
end;
$$;
revoke all on function private.community_anonymize_deleted_reporter() from public, anon, authenticated, service_role;
create trigger auth_users_anonymize_community_reports_before_delete
before delete on auth.users
for each row execute function private.community_anonymize_deleted_reporter();

revoke all on function public.community_create_artwork_report(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.community_update_artwork_report(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.community_purge_expired_report_details(integer) from public, anon, authenticated;
grant execute on function public.community_create_artwork_report(uuid, uuid, text, text) to service_role;
grant execute on function public.community_update_artwork_report(uuid, uuid, integer, text) to service_role;
grant execute on function public.community_purge_expired_report_details(integer) to service_role;
