-- Profile photos use a separate bucket. Only the application may read or write
-- raw objects; public delivery checks the exact approved revision on each GET.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-avatars', 'community-avatars', false, 524288, array['image/webp']);

create policy community_avatars_no_direct_access
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'community-avatars')
  with check (bucket_id <> 'community-avatars');

create table public.community_profile_avatars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.community_profiles(user_id) on delete cascade,
  status text not null check (status in ('uploading', 'pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_id uuid references auth.users(id) on delete set null,
  constraint community_profile_avatar_state_unique unique (user_id, status)
);
create index community_profile_avatars_queue_idx on public.community_profile_avatars (status, created_at, id);
create index community_profile_avatars_reviewer_idx on public.community_profile_avatars (reviewer_id)
  where reviewer_id is not null;
alter table public.community_profile_avatars enable row level security;
revoke all on public.community_profile_avatars from public, anon, authenticated;
grant select, insert, update, delete on public.community_profile_avatars to service_role;

alter table public.community_account_media_cleanup_jobs
  drop constraint community_account_media_cleanup_jobs_storage_path_check,
  add constraint community_account_media_cleanup_jobs_storage_path_check check (
    storage_path ~ '^community/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (storage_provider = 'supabase' and storage_path ~ '^avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  );

create function private.community_queue_avatar_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'rejected' then
    insert into public.community_account_media_cleanup_jobs (storage_provider, storage_path, not_before)
    values ('supabase', 'avatars/' || old.id,
      case when old.status = 'uploading' then greatest(now(), old.created_at + interval '5 minutes') else now() end)
    on conflict (storage_provider, storage_path) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function private.community_queue_avatar_cleanup() from public, anon, authenticated, service_role;

create trigger community_avatar_deleted
  after delete on public.community_profile_avatars
  for each row execute function private.community_queue_avatar_cleanup();
create trigger community_avatar_rejected
  after update of status on public.community_profile_avatars
  for each row when (new.status = 'rejected' and old.status <> 'rejected')
  execute function private.community_queue_avatar_cleanup();

create function private.community_purge_revoked_avatars()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.community_profile_avatars where user_id = new.user_id;
  return null;
end;
$$;
revoke all on function private.community_purge_revoked_avatars() from public, anon, authenticated, service_role;
create trigger community_profile_avatars_revoked
  after update of participation_revoked_at, suspended_at, rules_version on public.community_profiles
  for each row when (
    (new.participation_revoked_at is not null and old.participation_revoked_at is null)
    or (new.suspended_at is not null and old.suspended_at is null)
    or new.rules_version is distinct from old.rules_version
  )
  execute function private.community_purge_revoked_avatars();

create function private.community_purge_unverified_avatars()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.community_profile_avatars where user_id = new.id;
  return null;
end;
$$;
revoke all on function private.community_purge_unverified_avatars() from public, anon, authenticated, service_role;
create trigger community_auth_avatars_revoked
  after update of email_confirmed_at, deleted_at on auth.users
  for each row when (
    (old.email_confirmed_at is not null and new.email_confirmed_at is null)
    or (old.deleted_at is null and new.deleted_at is not null)
  )
  execute function private.community_purge_unverified_avatars();

create function private.community_avatar_owner_is_verified(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
    where id = p_user and email_confirmed_at is not null and deleted_at is null
  );
$$;
revoke all on function private.community_avatar_owner_is_verified(uuid) from public, anon, authenticated;
grant execute on function private.community_avatar_owner_is_verified(uuid) to service_role;

create function public.community_avatar_owner_is_verified(p_user uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.community_avatar_owner_is_verified(p_user);
$$;
revoke all on function public.community_avatar_owner_is_verified(uuid) from public, anon, authenticated;
grant execute on function public.community_avatar_owner_is_verified(uuid) to service_role;

-- Lock order is auth user then community profile. Owner operations and review
-- serialize on the same profile row, including simultaneous removal and approval.
create function public.community_avatar_reserve(p_user uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if not private.community_actor_is_verified(p_user) then
    raise exception using errcode = '42501', message = 'verified member required';
  end if;
  perform 1 from public.community_profiles
  where user_id = p_user and is_adult and opted_in_at is not null
    and participation_revoked_at is null and suspended_at is null and rules_version = '2026-10-25-v1'
  for update;
  if not found then raise exception using errcode = '42501', message = 'active member required'; end if;
  delete from public.community_profile_avatars
    where user_id = p_user and status = 'uploading' and created_at <= now() - interval '2 minutes';
  if exists (select 1 from public.community_profile_avatars where user_id = p_user and status = 'uploading') then
    raise exception using errcode = '40001', message = 'photo upload already in progress';
  end if;
  insert into public.community_profile_avatars (user_id, status) values (p_user, 'uploading') returning id into v_id;
  return v_id;
end;
$$;

create function public.community_avatar_finalize(p_user uuid, p_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.community_actor_is_verified(p_user) then
    raise exception using errcode = '42501', message = 'verified member required';
  end if;
  perform 1 from public.community_profiles
  where user_id = p_user and is_adult and opted_in_at is not null
    and participation_revoked_at is null and suspended_at is null and rules_version = '2026-10-25-v1'
  for update;
  if not found then raise exception using errcode = '42501', message = 'active member required'; end if;
  perform 1 from public.community_profile_avatars where id = p_id and user_id = p_user and status = 'uploading'
    and created_at > clock_timestamp() - interval '2 minutes' for update;
  if not found then raise exception using errcode = '40001', message = 'photo upload expired or removed'; end if;
  delete from public.community_profile_avatars where user_id = p_user and status in ('pending', 'rejected');
  update public.community_profile_avatars set status = 'pending' where id = p_id;
end;
$$;

create function public.community_avatar_remove(p_user uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.community_actor_is_verified(p_user) then
    raise exception using errcode = '42501', message = 'verified account required';
  end if;
  perform 1 from public.community_profiles where user_id = p_user for update;
  delete from public.community_profile_avatars where user_id = p_user;
end;
$$;

create function public.community_avatar_review(p_admin uuid, p_id uuid, p_decision text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected', 'removed') then
    raise exception using errcode = '22023', message = 'invalid review decision';
  end if;
  if not private.community_actor_is_verified(p_admin) then
    raise exception using errcode = '42501', message = 'verified administrator required';
  end if;
  perform 1 from public.profiles where id = p_admin and role = 'admin' for share;
  if not found then raise exception using errcode = '42501', message = 'administrator required'; end if;
  select user_id into v_user from public.community_profile_avatars where id = p_id;
  perform 1 from public.community_profiles
  where user_id = v_user and is_adult and opted_in_at is not null
    and participation_revoked_at is null and suspended_at is null and rules_version = '2026-10-25-v1'
  for update;
  if not found then raise exception using errcode = '40001', message = 'profile no longer available'; end if;
  perform 1 from public.community_profile_avatars where id = p_id
    and status = case when p_decision = 'removed' then 'approved' else 'pending' end;
  if not found then raise exception using errcode = '40001', message = 'photo changed'; end if;
  if p_decision = 'removed' then
    delete from public.community_profile_avatars where id = p_id;
    return;
  end if;
  delete from public.community_profile_avatars where user_id = v_user and status = p_decision;
  update public.community_profile_avatars
  set status = p_decision, reviewed_at = now(), reviewer_id = p_admin where id = p_id;
end;
$$;

-- Abandoned reservations can occur after process loss or an uncertain storage
-- write. Reaping invokes the same durable, leased object deletion queue.
create function public.community_avatar_reap_uploads(p_limit integer default 20)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode = '22023', message = 'invalid avatar cleanup limit';
  end if;
  delete from public.community_profile_avatars avatar using (
    select candidate.id from public.community_profile_avatars candidate
    where candidate.status = 'uploading' and candidate.created_at <= now() - interval '5 minutes'
    order by candidate.created_at, candidate.id limit p_limit for update skip locked
  ) expired where avatar.id = expired.id;
end;
$$;

-- Keep the existing application RPC contract across schema versions. Queued
-- avatar objects remain private until a compatible worker processes them.
alter function public.community_claim_account_media_cleanup(uuid, integer)
  rename to community_claim_account_media_cleanup_before_avatars;
alter function public.community_claim_account_media_cleanup_before_avatars(uuid, integer) set schema private;
create function public.community_claim_account_media_cleanup(p_lease_token uuid, p_limit integer default 10)
returns table (id bigint, storage_provider text, storage_path text, lease_token uuid)
language plpgsql security invoker set search_path = '' as $$
begin
  perform public.community_avatar_reap_uploads(p_limit);
  return query select * from private.community_claim_account_media_cleanup_before_avatars(p_lease_token, p_limit);
end;
$$;
revoke all on function public.community_claim_account_media_cleanup(uuid, integer) from public, anon, authenticated;
grant execute on function public.community_claim_account_media_cleanup(uuid, integer) to service_role;

revoke all on function public.community_avatar_reserve(uuid), public.community_avatar_finalize(uuid, uuid),
  public.community_avatar_remove(uuid), public.community_avatar_review(uuid, uuid, text),
  public.community_avatar_reap_uploads(integer) from public, anon, authenticated;
grant execute on function public.community_avatar_reserve(uuid), public.community_avatar_finalize(uuid, uuid),
  public.community_avatar_remove(uuid), public.community_avatar_review(uuid, uuid, text),
  public.community_avatar_reap_uploads(integer) to service_role;
