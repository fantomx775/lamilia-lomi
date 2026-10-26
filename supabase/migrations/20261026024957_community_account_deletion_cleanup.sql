-- Account erasure must not lose the only paths for private community objects.
-- This queue intentionally has no auth.users/community_profiles/reservation FK.
alter table public.community_artworks alter column storage_path drop not null;

create table public.community_account_media_cleanup_jobs (
  id bigint generated always as identity primary key,
  storage_provider text not null check (storage_provider in ('local', 'supabase', 'r2')),
  storage_path text not null check (
    storage_path ~ '^community/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  not_before timestamptz not null,
  state text not null default 'pending' check (state in ('pending', 'sending')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code in ('provider_error', 'network_error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_account_media_cleanup_lease check (
    (state = 'sending' and lease_token is not null and lease_expires_at is not null)
    or (state = 'pending' and lease_token is null and lease_expires_at is null)
  ),
  unique (storage_provider, storage_path)
);
create index community_account_media_cleanup_due_idx
  on public.community_account_media_cleanup_jobs (not_before, next_attempt_at, id)
  where state = 'pending';
create index community_account_media_cleanup_lease_idx
  on public.community_account_media_cleanup_jobs (lease_expires_at, id)
  where state = 'sending';
alter table public.community_account_media_cleanup_jobs enable row level security;
revoke all on public.community_account_media_cleanup_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.community_account_media_cleanup_jobs to service_role;

create or replace function private.community_capture_account_media_before_auth_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artwork_ids uuid[];
  v_artwork_id uuid;
begin
  -- The deterministic community key can still have an in-flight writer. Keep
  -- the object until the ten-minute reservation lease plus the bounded upload
  -- request and a two-minute safety margin have elapsed (at least 12 minutes).
  with path_entries as (
    select artwork.storage_provider, artwork.storage_path, reservation.lease_expires_at
    from public.community_artworks artwork
    left join public.community_upload_reservations reservation
      on reservation.author_id = old.id and reservation.idempotency_key = artwork.idempotency_key
    where artwork.author_id = old.id and artwork.storage_path is not null
    union all
    select reservation.storage_provider, reservation.storage_path, reservation.lease_expires_at
    from public.community_upload_reservations reservation
    where reservation.author_id = old.id
  ), unique_paths as (
    select storage_provider, storage_path,
      max(greatest(now() + interval '12 minutes', coalesce(lease_expires_at + interval '2 minutes', now() + interval '12 minutes'))) as not_before
    from path_entries
    group by storage_provider, storage_path
  )
  insert into public.community_account_media_cleanup_jobs (storage_provider, storage_path, not_before)
  select storage_provider, storage_path, not_before from unique_paths
  on conflict (storage_provider, storage_path) do update set
    not_before = greatest(public.community_account_media_cleanup_jobs.not_before, excluded.not_before),
    updated_at = now();

  select array_agg(artwork.id order by artwork.id) into v_artwork_ids
  from public.community_artworks artwork where artwork.author_id = old.id;
  if v_artwork_ids is not null then
    -- Deterministic artwork order preserves the #84 art-lock ordering while
    -- heart-counter triggers remove reactions attached to erased work.
    foreach v_artwork_id in array v_artwork_ids loop
      perform 1 from public.community_artworks artwork where artwork.id = v_artwork_id for update;
      delete from public.community_artwork_likes reaction where reaction.artwork_id = v_artwork_id;
    end loop;
    update public.community_moderation_events event
    set reason = null
    where event.artwork_id = any(v_artwork_ids) and event.reason is not null;
    update public.community_artworks artwork
    set author_id = null, idempotency_key = null, description = '', moderation_reason = null,
      status = 'removed', published_at = null, deleted_at = coalesce(deleted_at, now()),
      storage_path = null, revision = revision + 1, updated_at = now()
    where artwork.id = any(v_artwork_ids);
  end if;

  return old;
end;
$$;
revoke all on function private.community_capture_account_media_before_auth_delete() from public, anon, authenticated, service_role;
create trigger auth_users_capture_community_media_before_delete
before delete on auth.users
for each row execute function private.community_capture_account_media_before_auth_delete();

create or replace function public.community_claim_account_media_cleanup(p_lease_token uuid, p_limit integer default 10)
returns table (id bigint, storage_provider text, storage_path text, lease_token uuid)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_lease_token is null or p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception using errcode = '22023', message = 'invalid account cleanup claim';
  end if;
  return query
  with candidates as (
    select job.id from public.community_account_media_cleanup_jobs job
    where job.not_before <= now() and (
      (job.state = 'pending' and job.next_attempt_at <= now())
      or (job.state = 'sending' and job.lease_expires_at <= now())
    )
    order by job.not_before, job.next_attempt_at, job.id
    limit p_limit for update skip locked
  ), claimed as (
    update public.community_account_media_cleanup_jobs job
    set state = 'sending', lease_token = p_lease_token, lease_expires_at = now() + interval '5 minutes',
      attempt_count = attempt_count + 1, updated_at = now()
    from candidates where job.id = candidates.id
    returning job.id, job.storage_provider, job.storage_path, job.lease_token
  )
  select * from claimed;
end;
$$;

create or replace function public.community_finish_account_media_cleanup(p_id bigint, p_lease_token uuid, p_result text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_attempt integer;
begin
  if p_id is null or p_lease_token is null or p_result is null or p_result not in ('deleted', 'retry') then
    raise exception using errcode = '22023', message = 'invalid account cleanup result';
  end if;
  select attempt_count into v_attempt from public.community_account_media_cleanup_jobs
  where id = p_id and state = 'sending' and lease_token = p_lease_token for update;
  if not found then return false; end if;
  if p_result = 'deleted' then
    delete from public.community_account_media_cleanup_jobs where id = p_id and lease_token = p_lease_token;
    return true;
  end if;
  update public.community_account_media_cleanup_jobs
  set state = 'pending', lease_token = null, lease_expires_at = null,
    next_attempt_at = now() + make_interval(mins => least(360, 5 * (2 ^ least(v_attempt, 6)))::integer),
    last_error_code = 'provider_error', updated_at = now()
  where id = p_id and lease_token = p_lease_token;
  return true;
end;
$$;

revoke all on function public.community_claim_account_media_cleanup(uuid, integer) from public, anon, authenticated;
revoke all on function public.community_finish_account_media_cleanup(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.community_claim_account_media_cleanup(uuid, integer) to service_role;
grant execute on function public.community_finish_account_media_cleanup(bigint, uuid, text) to service_role;

-- Auth deletion/anonymization and profile-triggered suppression are bounded by
-- the new predicates this slice adds.
create index community_artwork_report_events_actor_idx
  on public.community_artwork_report_events (actor_user_id)
  where actor_user_id is not null;
create index community_moderation_email_outbox_author_pending_idx
  on public.community_moderation_email_outbox (author_user_id, state)
  where author_user_id is not null and state in ('pending', 'sending');
create index community_moderation_events_actor_idx
  on public.community_moderation_events (actor_user_id)
  where actor_user_id is not null;
create index community_artworks_author_delete_idx
  on public.community_artworks (author_id, id)
  where author_id is not null;
create index community_artworks_product_all_idx
  on public.community_artworks (product_id);
create index community_upload_reservations_product_idx
  on public.community_upload_reservations (product_id);
drop index public.community_moderation_email_outbox_author_pending_idx;
create index community_moderation_email_outbox_author_user_idx
  on public.community_moderation_email_outbox (author_user_id)
  where author_user_id is not null;
