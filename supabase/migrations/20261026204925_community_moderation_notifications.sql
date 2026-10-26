-- One durable email intent per approve/reject audit event. No email address,
-- moderation reason, artwork URL, or user-authored content is copied here.
create table public.community_moderation_email_outbox (
  moderation_event_id bigint primary key references public.community_moderation_events(id) on delete restrict,
  author_user_id uuid references auth.users(id) on delete set null,
  notification_type text not null check (notification_type in ('approved', 'rejected')),
  state text not null default 'pending' check (state in ('pending', 'sending', 'sent', 'suppressed', 'uncertain')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  first_attempt_at timestamptz,
  payload_fingerprint text check (payload_fingerprint is null or payload_fingerprint ~ '^[a-f0-9]{64}$'),
  template_version text,
  provider_message_id text,
  last_error_code text check (last_error_code is null or last_error_code in ('provider_error', 'network_error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_moderation_email_outbox_lease_consistency check (
    (state = 'sending' and lease_token is not null and lease_expires_at is not null)
    or (state <> 'sending' and lease_token is null and lease_expires_at is null)
  )
);
create index community_moderation_email_outbox_due_idx
  on public.community_moderation_email_outbox (next_attempt_at, moderation_event_id)
  where state = 'pending';
create index community_moderation_email_outbox_lease_idx
  on public.community_moderation_email_outbox (lease_expires_at, moderation_event_id)
  where state = 'sending';

alter table public.community_moderation_email_outbox enable row level security;
revoke all on public.community_moderation_email_outbox from public, anon, authenticated, service_role;
grant select, insert, update on public.community_moderation_email_outbox to service_role;

create or replace function private.community_queue_moderation_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author_id uuid;
begin
  if new.to_status not in ('approved', 'rejected') then return new; end if;
  select artwork.author_id into v_author_id
  from public.community_artworks artwork where artwork.id = new.artwork_id;
  if v_author_id is null then return new; end if;
  insert into public.community_moderation_email_outbox (
    moderation_event_id, author_user_id, notification_type
  ) values (
    new.id, v_author_id, new.to_status
  ) on conflict (moderation_event_id) do nothing;
  return new;
end;
$$;
revoke all on function private.community_queue_moderation_email() from public, anon, authenticated, service_role;
create trigger community_moderation_events_queue_email
after insert on public.community_moderation_events
for each row execute function private.community_queue_moderation_email();

-- An opt-out, suspension, stale rules acceptance, or profile deletion
-- permanently suppresses queued notifications for that profile.
create or replace function private.community_suppress_inactive_author_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.community_moderation_email_outbox
    set state = 'suppressed', author_user_id = null, lease_token = null, lease_expires_at = null, updated_at = now()
    where author_user_id = old.user_id and state in ('pending', 'sending');
    return old;
  end if;
  if new.is_adult is distinct from true or new.adult_attested_at is null
    or new.opted_in_at is null or new.participation_revoked_at is not null
    or new.suspended_at is not null or new.rules_version is distinct from '2026-10-25-v1' then
    update public.community_moderation_email_outbox
    set state = 'suppressed', author_user_id = null, lease_token = null, lease_expires_at = null, updated_at = now()
    where author_user_id = new.user_id and state in ('pending', 'sending');
  end if;
  return new;
end;
$$;
revoke all on function private.community_suppress_inactive_author_notifications() from public, anon, authenticated, service_role;
create trigger community_profiles_suppress_outbox_when_inactive
after update of is_adult, adult_attested_at, opted_in_at, participation_revoked_at, suspended_at, rules_version
on public.community_profiles
for each row execute function private.community_suppress_inactive_author_notifications();
create trigger community_profiles_suppress_outbox_before_delete
before delete on public.community_profiles
for each row execute function private.community_suppress_inactive_author_notifications();

-- Claim a bounded number of due rows using a worker-generated fencing token.
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
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_lease_token is null or p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception using errcode = '22023', message = 'invalid notification claim';
  end if;
  update public.community_moderation_email_outbox outbox
  set state = 'uncertain', lease_token = null, lease_expires_at = null, updated_at = now()
  where outbox.state in ('pending', 'sending')
    and (outbox.state = 'pending' or outbox.lease_expires_at <= now())
    and outbox.first_attempt_at <= now() - interval '24 hours';

  return query
  with candidates as (
    select outbox.moderation_event_id
    from public.community_moderation_email_outbox outbox
    where ((outbox.state = 'pending' and outbox.next_attempt_at <= now())
      or (outbox.state = 'sending' and outbox.lease_expires_at <= now()))
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

-- Freeze the exact recipient/body fingerprint on first attempt. If the
-- recipient or template changes, or the 24-hour provider window elapsed, do
-- not send again under a different payload with the same key.
create or replace function public.community_prepare_moderation_email_send(
  p_moderation_event_id bigint,
  p_lease_token uuid,
  p_payload_fingerprint text,
  p_template_version text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.community_moderation_email_outbox%rowtype;
begin
  if p_moderation_event_id is null or p_lease_token is null
    or p_payload_fingerprint is null or p_payload_fingerprint !~ '^[a-f0-9]{64}$'
    or p_template_version is null or char_length(p_template_version) > 40 then
    raise exception using errcode = '22023', message = 'invalid notification payload';
  end if;
  select * into v_row from public.community_moderation_email_outbox
  where moderation_event_id = p_moderation_event_id and state = 'sending' and lease_token = p_lease_token
  for update;
  if not found then return false; end if;
  if v_row.first_attempt_at is not null and (
    v_row.first_attempt_at <= now() - interval '24 hours'
    or v_row.payload_fingerprint is distinct from p_payload_fingerprint
    or v_row.template_version is distinct from p_template_version
  ) then
    update public.community_moderation_email_outbox set state = 'uncertain', lease_token = null,
      lease_expires_at = null, updated_at = now()
    where moderation_event_id = p_moderation_event_id and lease_token = p_lease_token;
    return false;
  end if;
  update public.community_moderation_email_outbox set
    first_attempt_at = coalesce(first_attempt_at, now()),
    payload_fingerprint = coalesce(payload_fingerprint, p_payload_fingerprint),
    template_version = coalesce(template_version, p_template_version),
    updated_at = now()
  where moderation_event_id = p_moderation_event_id and lease_token = p_lease_token;
  return true;
end;
$$;

create or replace function public.community_finish_moderation_email_send(
  p_moderation_event_id bigint,
  p_lease_token uuid,
  p_result text,
  p_provider_message_id text default null,
  p_error_code text default null
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt integer;
begin
  if p_moderation_event_id is null or p_lease_token is null
    or p_result is null or p_result not in ('sent', 'suppressed', 'retry')
    or (p_result = 'sent' and (p_provider_message_id is null or char_length(p_provider_message_id) > 200))
    or (p_result = 'retry' and (p_error_code is null or p_error_code not in ('provider_error', 'network_error'))) then
    raise exception using errcode = '22023', message = 'invalid notification result';
  end if;
  select attempt_count into v_attempt from public.community_moderation_email_outbox
  where moderation_event_id = p_moderation_event_id and state = 'sending' and lease_token = p_lease_token
  for update;
  if not found then return false; end if;
  if p_result = 'retry' and v_attempt >= 8 then
    update public.community_moderation_email_outbox set state = 'uncertain', lease_token = null,
      lease_expires_at = null, last_error_code = p_error_code, updated_at = now()
    where moderation_event_id = p_moderation_event_id and lease_token = p_lease_token;
    return true;
  end if;
  update public.community_moderation_email_outbox set
    state = case when p_result = 'retry' then 'pending' else p_result end,
    next_attempt_at = case when p_result = 'retry' then now() + make_interval(mins => least(60, 5 * (2 ^ least(v_attempt, 4)))::integer) else next_attempt_at end,
    provider_message_id = case when p_result = 'sent' then p_provider_message_id else provider_message_id end,
    last_error_code = case when p_result = 'retry' then p_error_code else null end,
    lease_token = null, lease_expires_at = null, updated_at = now()
  where moderation_event_id = p_moderation_event_id and lease_token = p_lease_token;
  return true;
end;
$$;

revoke all on function public.community_claim_moderation_email_outbox(uuid, integer) from public, anon, authenticated;
revoke all on function public.community_prepare_moderation_email_send(bigint, uuid, text, text) from public, anon, authenticated;
revoke all on function public.community_finish_moderation_email_send(bigint, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.community_claim_moderation_email_outbox(uuid, integer) to service_role;
grant execute on function public.community_prepare_moderation_email_send(bigint, uuid, text, text) to service_role;
grant execute on function public.community_finish_moderation_email_send(bigint, uuid, text, text, text) to service_role;

-- Preserve the verified #84 lock order and current return contract while
-- closing NULL/CAS bypasses before the outbox trigger is active.
create or replace function public.community_moderate_artwork(
  p_actor_user_id uuid,
  p_artwork_id uuid,
  p_expected_revision integer,
  p_action text,
  p_reason text default null
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artwork public.community_artworks%rowtype;
  v_admin_role text;
  v_author_profile public.community_profiles%rowtype;
  v_author_user_id uuid;
  v_product_id uuid;
  v_product_status text;
  v_next_status text;
  v_new_revision integer;
begin
  if p_actor_user_id is null or p_artwork_id is null or p_expected_revision is null or p_expected_revision < 1
    or p_action is null or p_action not in ('approve', 'reject', 'remove', 'restore') then
    raise exception using errcode = '22023', message = 'invalid moderation action';
  end if;
  if p_action in ('reject', 'remove') and char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'moderation reason required';
  end if;

  if p_action = 'approve' then
    select author_id, product_id into v_author_user_id, v_product_id
    from public.community_artworks where id = p_artwork_id and deleted_at is null;
    if not found then raise exception using errcode = '40001', message = 'artwork is unavailable or revision changed'; end if;
    if v_author_user_id is null then raise exception using errcode = '42501', message = 'active eligible author required for approval'; end if;
    if p_actor_user_id <= v_author_user_id then
      if not private.community_actor_is_verified(p_actor_user_id) then raise exception using errcode = '42501', message = 'active administrator required'; end if;
      if v_author_user_id <> p_actor_user_id and not private.community_actor_is_verified(v_author_user_id) then raise exception using errcode = '42501', message = 'active eligible author required for approval'; end if;
    else
      if not private.community_actor_is_verified(v_author_user_id) then raise exception using errcode = '42501', message = 'active eligible author required for approval'; end if;
      if not private.community_actor_is_verified(p_actor_user_id) then raise exception using errcode = '42501', message = 'active administrator required'; end if;
    end if;
    select p.role into v_admin_role from public.profiles p where p.id = p_actor_user_id for share;
    if v_admin_role is distinct from 'admin' then raise exception using errcode = '42501', message = 'active administrator required'; end if;
    select * into v_author_profile from public.community_profiles cp where cp.user_id = v_author_user_id for share;
    if not found or not v_author_profile.is_adult or v_author_profile.adult_attested_at is null
      or v_author_profile.opted_in_at is null or v_author_profile.participation_revoked_at is not null
      or v_author_profile.suspended_at is not null or v_author_profile.rules_version <> '2026-10-25-v1' then
      raise exception using errcode = '42501', message = 'active eligible author required for approval';
    end if;
  else
    if not private.community_actor_is_verified(p_actor_user_id) then raise exception using errcode = '42501', message = 'active administrator required'; end if;
    select p.role into v_admin_role from public.profiles p where p.id = p_actor_user_id for share;
    if v_admin_role is distinct from 'admin' then raise exception using errcode = '42501', message = 'active administrator required'; end if;
  end if;

  select * into v_artwork from public.community_artworks
  where id = p_artwork_id and deleted_at is null for update;
  if not found or v_artwork.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'artwork is unavailable or revision changed';
  end if;
  if p_action = 'approve' and (v_artwork.author_id is distinct from v_author_user_id
    or v_artwork.product_id is distinct from v_product_id
    or v_author_profile.is_adult is distinct from true or v_author_profile.adult_attested_at is null
    or v_author_profile.opted_in_at is null or v_author_profile.participation_revoked_at is not null
    or v_author_profile.suspended_at is not null or v_author_profile.rules_version <> '2026-10-25-v1') then
    raise exception using errcode = '40001', message = 'artwork is unavailable or revision changed';
  end if;
  v_next_status := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' when 'remove' then 'removed' when 'restore' then 'pending' end;
  if not ((p_action in ('approve', 'reject') and v_artwork.status = 'pending')
    or (p_action = 'remove' and v_artwork.status = 'approved')
    or (p_action = 'restore' and v_artwork.status = 'removed')) then
    raise exception using errcode = '40001', message = 'moderation transition is not allowed';
  end if;
  if p_action = 'approve' then
    select p.status into v_product_status from public.products p where p.id = v_product_id for share;
    if v_product_status is distinct from 'published' then raise exception using errcode = '42501', message = 'published product required for approval'; end if;
    if not exists (select 1 from public.user_product_unlocks u where u.user_id = v_author_user_id and u.product_id = v_product_id) then
      raise exception using errcode = '42501', message = 'unlocked product required for approval';
    end if;
  end if;
  update public.community_artworks set
    status = v_next_status,
    moderation_reason = case when p_action in ('reject', 'remove') then btrim(p_reason) else null end,
    published_at = case when p_action = 'approve' then now() else null end,
    revision = revision + 1,
    updated_at = now()
  where id = p_artwork_id returning revision into v_new_revision;
  insert into public.community_moderation_events (artwork_id, actor_user_id, revision, from_status, to_status, reason)
  values (p_artwork_id, p_actor_user_id, v_new_revision, v_artwork.status, v_next_status,
    case when p_action in ('reject', 'remove') then btrim(p_reason) else null end);
  return v_new_revision;
end;
$$;
revoke all on function public.community_moderate_artwork(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.community_moderate_artwork(uuid, uuid, integer, text, text) to service_role;
