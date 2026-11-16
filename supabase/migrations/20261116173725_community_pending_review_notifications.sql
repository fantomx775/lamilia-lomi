-- Queue review alerts for new artwork and changed descriptions. No historical
-- entries are backfilled. The same transaction records the audit and email intent.
alter table public.community_moderation_email_outbox
  drop constraint community_moderation_email_outbox_notification_type_check,
  add constraint community_moderation_email_outbox_notification_type_check
    check (notification_type in ('approved', 'rejected', 'admin_pending'));

create function private.community_queue_pending_review_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before text;
  v_event_id bigint;
begin
  if tg_op = 'UPDATE' then
    v_before := old.status;
    if new.revision is not distinct from old.revision then return new; end if;
    if new.status = 'pending' and new.deleted_at is null and new.description is not distinct from old.description then
      return new;
    end if;
    update public.community_moderation_email_outbox outbox
    set state = 'suppressed', lease_token = null, lease_expires_at = null, updated_at = now()
    from public.community_moderation_events event
    where event.artwork_id = new.id and outbox.moderation_event_id = event.id
      and outbox.notification_type = 'admin_pending' and outbox.state in ('pending', 'sending')
      and outbox.first_attempt_at is null;
  end if;
  if new.status <> 'pending' or new.author_id is null or new.deleted_at is not null then return new; end if;

  insert into public.community_moderation_events (artwork_id, actor_user_id, revision, from_status, to_status)
  values (new.id, new.author_id, new.revision, v_before, 'pending')
  returning id into v_event_id;

  insert into public.community_moderation_email_outbox (moderation_event_id, notification_type)
  values (v_event_id, 'admin_pending');
  return new;
end;
$$;
revoke all on function private.community_queue_pending_review_email() from public, anon, authenticated, service_role;

create trigger community_artworks_queue_pending_review_email
after insert or update of description, status, deleted_at on public.community_artworks
for each row execute function private.community_queue_pending_review_email();

-- Deploy the schema first. Old workers use the two-argument overload and
-- cannot consume admin alerts or messages prepared with the new template.

create or replace function public.community_claim_moderation_email_outbox(p_lease_token uuid, p_limit integer, p_include_pending_review boolean)
returns table (
  moderation_event_id bigint,
  author_user_id uuid,
  notification_type text,
  attempt_count integer,
  first_attempt_at timestamptz,
  payload_fingerprint text,
  template_version text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_include_pending_review is null or p_lease_token is null or p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception using errcode = '22023', message = 'invalid notification claim';
  end if;
  update public.community_moderation_email_outbox outbox
  set state = 'uncertain', lease_token = null, lease_expires_at = null, updated_at = now()
  where (p_include_pending_review or (
      outbox.notification_type <> 'admin_pending'
      and (outbox.template_version is null or outbox.template_version = 'cc-status-2026-10-26-v2')
    ))
    and outbox.state in ('pending', 'sending')
    and (outbox.state = 'pending' or outbox.lease_expires_at <= now())
    and outbox.first_attempt_at <= now() - interval '24 hours';

  return query
  with candidates as (
    select outbox.moderation_event_id
    from public.community_moderation_email_outbox outbox
    where ((outbox.state = 'pending' and outbox.next_attempt_at <= now())
      or (outbox.state = 'sending' and outbox.lease_expires_at <= now()))
      and (p_include_pending_review or (
        outbox.notification_type <> 'admin_pending'
        and (outbox.template_version is null or outbox.template_version = 'cc-status-2026-10-26-v2')
      ))
      and (outbox.first_attempt_at is null or outbox.first_attempt_at > now() - interval '24 hours')
    order by outbox.next_attempt_at, outbox.moderation_event_id
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.community_moderation_email_outbox outbox
    set state = 'sending', lease_token = p_lease_token, lease_expires_at = now() + interval '3 minutes',
      attempt_count = outbox.attempt_count + 1, updated_at = now()
    from candidates
    where outbox.moderation_event_id = candidates.moderation_event_id
    returning outbox.moderation_event_id, outbox.author_user_id, outbox.notification_type,
      outbox.attempt_count, outbox.first_attempt_at, outbox.payload_fingerprint, outbox.template_version
  )
  select * from claimed;
end;
$$;

revoke all on function public.community_claim_moderation_email_outbox(uuid, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.community_claim_moderation_email_outbox(uuid, integer, boolean) to service_role;

create or replace function public.community_claim_moderation_email_outbox(p_lease_token uuid, p_limit integer default 10)
returns table (
  moderation_event_id bigint,
  author_user_id uuid,
  notification_type text,
  attempt_count integer,
  first_attempt_at timestamptz,
  payload_fingerprint text,
  template_version text
)
language sql
security invoker
set search_path = ''
as $$
  select * from public.community_claim_moderation_email_outbox(p_lease_token, p_limit, false);
$$;
