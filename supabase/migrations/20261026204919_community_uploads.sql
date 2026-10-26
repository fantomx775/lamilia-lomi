-- Private, durable upload reservations. Raw table access remains service-only.
alter table public.community_artworks
  add column upload_fingerprint text;

create table public.community_upload_reservations (
  author_id uuid not null references public.community_profiles(user_id) on delete cascade,
  idempotency_key uuid not null,
  product_id uuid not null references public.products(id) on delete restrict,
  storage_path text not null,
  storage_provider text not null check (storage_provider in ('local', 'supabase', 'r2')),
  content_type text not null check (content_type = 'image/webp'),
  original_size_bytes integer not null check (original_size_bytes between 1 and 4194304),
  size_bytes integer not null check (size_bytes between 1 and 4194304),
  description text not null default '' check (char_length(description) <= 240 and description = btrim(description)),
  upload_fingerprint text not null check (upload_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null default 'reserved' check (state in ('reserved', 'stored', 'finalized', 'cleanup_pending', 'cleaned')),
  lease_token uuid not null,
  lease_expires_at timestamptz not null default (now() + interval '10 minutes'),
  cleanup_token uuid,
  cleanup_expires_at timestamptz,
  artwork_id uuid references public.community_artworks(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (author_id, idempotency_key),
  constraint community_upload_reservation_path_safe check (
    storage_path = 'community/' || author_id::text || '/' || idempotency_key::text
  ),
  constraint community_upload_reservation_finalized check (
    (state = 'finalized' and artwork_id is not null)
    or (state <> 'finalized')
  )
);
create index community_upload_reservations_cleanup_idx
  on public.community_upload_reservations (state, lease_expires_at, updated_at);
alter table public.community_upload_reservations enable row level security;
revoke all on public.community_upload_reservations from public, anon, authenticated;
grant select, insert, update, delete on public.community_upload_reservations to service_role;

create or replace function public.community_reserve_upload(
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_product_id uuid,
  p_idempotency_key uuid,
  p_upload_fingerprint text,
  p_storage_provider text,
  p_original_size_bytes integer,
  p_size_bytes integer,
  p_content_type text,
  p_description text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile public.community_profiles%rowtype;
  v_reservation public.community_upload_reservations%rowtype;
  v_product_status text;
begin
  if not private.community_actor_is_verified(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'verified account required';
  end if;
  select * into v_profile from public.community_profiles where user_id = p_actor_user_id for share;
  if not found or not v_profile.is_adult or v_profile.adult_attested_at is null
    or v_profile.opted_in_at is null or v_profile.participation_revoked_at is not null
    or v_profile.suspended_at is not null or v_profile.rules_version <> '2026-10-25-v1' then
    raise exception using errcode = '42501', message = 'active community membership required';
  end if;
  if p_lease_token is null or p_product_id is null or p_idempotency_key is null
    or p_upload_fingerprint is null or p_upload_fingerprint !~ '^[0-9a-f]{64}$'
    or p_storage_provider not in ('local', 'supabase', 'r2')
    or p_content_type is distinct from 'image/webp'
    or p_original_size_bytes not between 1 and 4194304
    or p_size_bytes not between 1 and 4194304
    or char_length(coalesce(p_description, '')) > 240 then
    raise exception using errcode = '22023', message = 'invalid upload metadata';
  end if;
  select p.status into v_product_status from public.products p where p.id = p_product_id for share;
  if v_product_status is distinct from 'published' or not exists (
    select 1 from public.user_product_unlocks u where u.product_id = p_product_id and u.user_id = p_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'published unlocked product required';
  end if;

  insert into public.community_upload_reservations (
    author_id, idempotency_key, product_id, storage_path, storage_provider,
    content_type, original_size_bytes, size_bytes, description, upload_fingerprint, lease_token
  ) values (
    p_actor_user_id, p_idempotency_key, p_product_id,
    'community/' || p_actor_user_id::text || '/' || p_idempotency_key::text,
    p_storage_provider, p_content_type, p_original_size_bytes, p_size_bytes,
    btrim(coalesce(p_description, '')), p_upload_fingerprint, p_lease_token
  ) on conflict (author_id, idempotency_key) do nothing;

  select * into v_reservation from public.community_upload_reservations
  where author_id = p_actor_user_id and idempotency_key = p_idempotency_key for update;
  if v_reservation.upload_fingerprint is distinct from p_upload_fingerprint
    or v_reservation.product_id is distinct from p_product_id
    or v_reservation.storage_provider is distinct from p_storage_provider
    or v_reservation.content_type is distinct from p_content_type
    or v_reservation.original_size_bytes is distinct from p_original_size_bytes
    or v_reservation.size_bytes is distinct from p_size_bytes
    or v_reservation.description is distinct from btrim(coalesce(p_description, '')) then
    raise exception using errcode = '40001', message = 'idempotency key was reused with different artwork';
  end if;
  if v_reservation.state = 'finalized' then
    return jsonb_build_object('state', 'finalized', 'artworkId', v_reservation.artwork_id);
  end if;
  if v_reservation.state = 'stored' then
    return jsonb_build_object(
      'state', 'stored', 'leaseToken', v_reservation.lease_token,
      'storagePath', v_reservation.storage_path, 'storageProvider', v_reservation.storage_provider
    );
  end if;
  if v_reservation.state = 'cleanup_pending' then
    raise exception using errcode = '40001', message = 'upload cleanup is in progress';
  end if;
  if v_reservation.state = 'cleaned' then
    if exists (select 1 from public.community_artworks a where a.author_id = p_actor_user_id and a.idempotency_key = p_idempotency_key) then
      raise exception using errcode = '40001', message = 'deleted artwork cannot reuse its upload key';
    end if;
    update public.community_upload_reservations set
      state = 'reserved', lease_token = p_lease_token, lease_expires_at = now() + interval '10 minutes',
      cleanup_token = null, cleanup_expires_at = null, updated_at = now()
    where author_id = p_actor_user_id and idempotency_key = p_idempotency_key
    returning * into v_reservation;
  elsif v_reservation.lease_token is distinct from p_lease_token and v_reservation.lease_expires_at >= now() then
    raise exception using errcode = '40001', message = 'upload is already processing';
  elsif v_reservation.lease_token is distinct from p_lease_token then
    update public.community_upload_reservations set
      lease_token = p_lease_token, lease_expires_at = now() + interval '10 minutes', updated_at = now()
    where author_id = p_actor_user_id and idempotency_key = p_idempotency_key
    returning * into v_reservation;
  end if;
  return jsonb_build_object(
    'state', 'reserved', 'leaseToken', v_reservation.lease_token,
    'storagePath', v_reservation.storage_path, 'storageProvider', v_reservation.storage_provider
  );
end;
$$;

create or replace function public.community_finalize_upload(
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_lease_token uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reservation public.community_upload_reservations%rowtype;
  v_profile public.community_profiles%rowtype;
  v_product_status text;
  v_artwork_id uuid;
begin
  if not private.community_actor_is_verified(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'verified account required';
  end if;
  select * into v_reservation from public.community_upload_reservations
  where author_id = p_actor_user_id and idempotency_key = p_idempotency_key for update;
  if not found then raise exception using errcode = '40001', message = 'upload reservation expired'; end if;
  if v_reservation.state = 'finalized' then return v_reservation.artwork_id; end if;
  if v_reservation.state <> 'stored' or v_reservation.lease_token is distinct from p_lease_token then
    raise exception using errcode = '40001', message = 'upload reservation changed';
  end if;
  select * into v_profile from public.community_profiles where user_id = p_actor_user_id for share;
  if not found or not v_profile.is_adult or v_profile.adult_attested_at is null
    or v_profile.opted_in_at is null or v_profile.participation_revoked_at is not null
    or v_profile.suspended_at is not null or v_profile.rules_version <> '2026-10-25-v1' then
    raise exception using errcode = '42501', message = 'active community membership required';
  end if;
  select p.status into v_product_status from public.products p where p.id = v_reservation.product_id for share;
  if v_product_status is distinct from 'published' or not exists (
    select 1 from public.user_product_unlocks u where u.product_id = v_reservation.product_id and u.user_id = p_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'published unlocked product required';
  end if;

  insert into public.community_artworks (
    author_id, product_id, storage_path, storage_provider, content_type, size_bytes,
    description, status, revision, idempotency_key, upload_fingerprint
  ) values (
    p_actor_user_id, v_reservation.product_id, v_reservation.storage_path,
    v_reservation.storage_provider, v_reservation.content_type, v_reservation.size_bytes,
    v_reservation.description, 'pending', 1, v_reservation.idempotency_key, v_reservation.upload_fingerprint
  ) returning id into v_artwork_id;
  update public.community_upload_reservations set
    state = 'finalized', artwork_id = v_artwork_id, updated_at = now()
  where author_id = p_actor_user_id and idempotency_key = p_idempotency_key;
  return v_artwork_id;
end;
$$;

create or replace function public.community_mark_upload_stored(
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_lease_token uuid
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_profile public.community_profiles%rowtype;
begin
  if not private.community_actor_is_verified(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'verified account required';
  end if;
  select * into v_profile from public.community_profiles where user_id = p_actor_user_id for share;
  if not found or not v_profile.is_adult or v_profile.adult_attested_at is null
    or v_profile.opted_in_at is null or v_profile.participation_revoked_at is not null
    or v_profile.suspended_at is not null or v_profile.rules_version <> '2026-10-25-v1' then
    raise exception using errcode = '42501', message = 'active community membership required';
  end if;
  update public.community_upload_reservations set state = 'stored', updated_at = now()
  where author_id = p_actor_user_id and idempotency_key = p_idempotency_key
    and state = 'reserved' and lease_token = p_lease_token and lease_expires_at >= now();
  if found then return true; end if;
  if exists (select 1 from public.community_upload_reservations
    where author_id = p_actor_user_id and idempotency_key = p_idempotency_key
      and state in ('stored', 'finalized') and lease_token = p_lease_token) then return true; end if;
  raise exception using errcode = '40001', message = 'upload reservation changed';
end;
$$;

create or replace function public.community_schedule_upload_cleanup(
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_lease_token uuid
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.community_upload_reservations set
    state = 'cleanup_pending', cleanup_token = gen_random_uuid(),
    cleanup_expires_at = now(), updated_at = now()
  where author_id = p_actor_user_id and idempotency_key = p_idempotency_key
    and lease_token = p_lease_token and state in ('reserved', 'stored');
  return found;
end;
$$;

create or replace function public.community_claim_upload_cleanup(p_limit integer default 10)
returns table(author_id uuid, idempotency_key uuid, storage_path text, storage_provider text, cleanup_token uuid)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 50 then raise exception using errcode = '22023', message = 'invalid cleanup limit'; end if;
  return query
  with candidates as (
    select r.author_id, r.idempotency_key from public.community_upload_reservations r
    where (r.state = 'cleanup_pending' and (r.cleanup_expires_at is null or r.cleanup_expires_at < now()))
      or (r.state in ('reserved', 'stored') and r.lease_expires_at < now() - interval '24 hours')
    order by r.updated_at limit p_limit for update skip locked
  ), claimed as (
    update public.community_upload_reservations r set state = 'cleanup_pending',
      cleanup_token = gen_random_uuid(), cleanup_expires_at = now() + interval '10 minutes', updated_at = now()
    from candidates c where r.author_id = c.author_id and r.idempotency_key = c.idempotency_key
    returning r.author_id, r.idempotency_key, r.storage_path, r.storage_provider, r.cleanup_token
  ) select * from claimed;
end;
$$;

create or replace function public.community_finish_upload_cleanup(
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_cleanup_token uuid
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.community_upload_reservations set state = 'cleaned', cleanup_token = null,
    cleanup_expires_at = null, updated_at = now()
  where author_id = p_actor_user_id and idempotency_key = p_idempotency_key
    and state = 'cleanup_pending' and cleanup_token = p_cleanup_token;
  return found;
end;
$$;

create or replace function public.community_delete_artwork(
  p_actor_user_id uuid,
  p_artwork_id uuid,
  p_expected_revision integer
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_artwork public.community_artworks%rowtype;
begin
  if not private.community_actor_is_verified(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'verified account required';
  end if;
  update public.community_artworks set deleted_at = now(), revision = revision + 1,
    updated_at = now(), moderation_reason = null
  where id = p_artwork_id and author_id = p_actor_user_id
    and deleted_at is null and revision = p_expected_revision
  returning * into v_artwork;
  if not found then raise exception using errcode = '40001', message = 'artwork is unavailable or revision changed'; end if;
  update public.community_upload_reservations set state = 'cleanup_pending',
    cleanup_token = gen_random_uuid(), cleanup_expires_at = now(), updated_at = now()
  where author_id = p_actor_user_id and idempotency_key = v_artwork.idempotency_key;
  return true;
end;
$$;

revoke all on function public.community_reserve_upload(uuid,uuid,uuid,uuid,text,text,integer,integer,text,text) from public, anon, authenticated;
revoke all on function public.community_finalize_upload(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.community_mark_upload_stored(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.community_schedule_upload_cleanup(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.community_claim_upload_cleanup(integer) from public, anon, authenticated;
revoke all on function public.community_finish_upload_cleanup(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.community_delete_artwork(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.community_reserve_upload(uuid,uuid,uuid,uuid,text,text,integer,integer,text,text) to service_role;
grant execute on function public.community_finalize_upload(uuid,uuid,uuid) to service_role;
grant execute on function public.community_mark_upload_stored(uuid,uuid,uuid) to service_role;
grant execute on function public.community_schedule_upload_cleanup(uuid,uuid,uuid) to service_role;
grant execute on function public.community_claim_upload_cleanup(integer) to service_role;
grant execute on function public.community_finish_upload_cleanup(uuid,uuid,uuid) to service_role;
grant execute on function public.community_delete_artwork(uuid,uuid,integer) to service_role;
