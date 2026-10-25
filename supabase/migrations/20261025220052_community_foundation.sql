-- Coloring Club data foundation. Raw rows remain server-only; public callers
-- receive allow-listed DTOs through the server repository, never direct REST.

create table public.community_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  avatar_seed uuid not null default gen_random_uuid(),
  is_adult boolean not null default false,
  adult_attested_at timestamptz,
  opted_in_at timestamptz,
  participation_revoked_at timestamptz,
  rules_version text not null,
  accepted_at timestamptz not null default now(),
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_profiles_username_normalized
    check (username = lower(username) and username ~ '^[a-z0-9_]{3,24}$'),
  constraint community_profiles_username_not_reserved
    check (username <> all (array[
      'admin','administrator','support','help','official','lamilialomi','api','club','creators',
      'community','login','register','account','library','artworks','moderation',
      'pomoc','administratorzy','oficjalnie','spolecznosc','klub','tworcy'
    ])),
  constraint community_profiles_adult_attestation
    check (is_adult = (adult_attested_at is not null)),
  constraint community_profiles_opt_in_attestation
    check (opted_in_at is null or adult_attested_at is not null)
);

create unique index community_profiles_username_unique
  on public.community_profiles (username);

create table public.community_artworks (
  id uuid primary key default gen_random_uuid(),
  author_id uuid constraint community_artworks_author_profile_fkey
    references public.community_profiles(user_id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  storage_path text not null,
  storage_provider text not null check (storage_provider in ('local', 'supabase', 'r2')),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 4194304),
  description text not null default '' check (char_length(description) <= 240),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed')),
  revision integer not null default 1 check (revision > 0),
  moderation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  deleted_at timestamptz,
  idempotency_key uuid,
  constraint community_artworks_idempotency_owner_unique unique (author_id, idempotency_key),
  constraint community_artworks_description_trimmed check (description = btrim(description)),
  constraint community_artworks_publication_state check (
    (status = 'approved' and published_at is not null)
    or (status <> 'approved')
  ),
  constraint community_artworks_storage_path_safe check (
    storage_path !~ '(^/|\.\.|\\|[[:space:]])'
    and storage_path ~ '^community/[0-9a-f-]{36}/[0-9a-f-]{36}$'
  )
);

create index community_artworks_public_page_idx
  on public.community_artworks (status, published_at desc, id desc)
  where deleted_at is null;
create index community_artworks_product_status_page_idx
  on public.community_artworks (product_id, status, published_at desc, id desc)
  where deleted_at is null;
create index community_artworks_author_created_idx
  on public.community_artworks (author_id, created_at desc, id desc)
  where deleted_at is null;
create index community_artworks_admin_queue_idx
  on public.community_artworks (created_at, id)
  where status = 'pending' and deleted_at is null;

create table public.community_moderation_events (
  id bigint generated always as identity primary key,
  artwork_id uuid not null references public.community_artworks(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  revision integer not null check (revision > 0),
  from_status text check (from_status in ('pending', 'approved', 'rejected', 'removed')),
  to_status text not null check (to_status in ('pending', 'approved', 'rejected', 'removed')),
  reason text,
  created_at timestamptz not null default now()
);
create index community_moderation_events_artwork_created_idx
  on public.community_moderation_events (artwork_id, created_at desc, id desc);

create table public.community_rate_limit_buckets (
  bucket_key text primary key check (bucket_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  hit_count integer not null check (hit_count >= 0),
  updated_at timestamptz not null default now()
);
create index community_rate_limit_buckets_updated_idx
  on public.community_rate_limit_buckets (updated_at);

alter table public.community_profiles enable row level security;
alter table public.community_artworks enable row level security;
alter table public.community_moderation_events enable row level security;
alter table public.community_rate_limit_buckets enable row level security;

revoke all on public.community_profiles, public.community_artworks,
  public.community_moderation_events, public.community_rate_limit_buckets
  from public, anon, authenticated;
grant select, insert, update, delete on public.community_profiles,
  public.community_artworks, public.community_rate_limit_buckets to service_role;
revoke update, delete on public.community_moderation_events from service_role;
grant select, insert on public.community_moderation_events to service_role;
grant usage, select on sequence public.community_moderation_events_id_seq to service_role;

-- service_role lacks direct SELECT on auth.users. This private helper exposes
-- only a boolean and holds a share lock so deletion/unverification cannot
-- race a privileged community mutation.
create or replace function private.community_actor_is_verified(p_actor_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from auth.users u
  where u.id = p_actor_user_id and u.email_confirmed_at is not null and u.deleted_at is null
  for share;
  return found;
end;
$$;
revoke all on function private.community_actor_is_verified(uuid) from public, anon, authenticated;
grant execute on function private.community_actor_is_verified(uuid) to service_role;

-- Service-only invoker functions. Caller UUIDs originate from verified server
-- sessions; each operation revalidates auth confirmation, profile role,
-- community eligibility, product state and unlock in the database.
create or replace function public.community_join(
  p_actor_user_id uuid,
  p_username text,
  p_adult_attested boolean,
  p_rules_version text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile public.community_profiles%rowtype;
  v_username text := lower(btrim(p_username));
  v_current_rules constant text := '2026-10-25-v1';
begin
  if not private.community_actor_is_verified(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'verified account required';
  end if;
  if p_adult_attested is distinct from true or p_rules_version is distinct from v_current_rules then
    raise exception using errcode = '22023', message = 'adult attestation and current rules acceptance required';
  end if;
  if v_username is null or v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception using errcode = '22023', message = 'invalid username';
  end if;
  if v_username = any(array[
    'admin','administrator','support','help','official','lamilialomi','api','club','creators',
    'community','login','register','account','library','artworks','moderation',
    'pomoc','administratorzy','oficjalnie','spolecznosc','klub','tworcy'
  ]) then
    raise exception using errcode = '22023', message = 'reserved username';
  end if;
  select * into v_profile from public.community_profiles where user_id = p_actor_user_id for update;
  if found and v_profile.suspended_at is not null then
    raise exception using errcode = '42501', message = 'community participation suspended';
  end if;
  if found and v_profile.username <> v_username then
    raise exception using errcode = '22023', message = 'use the rate-limited username change operation';
  end if;
  if found and v_profile.is_adult and v_profile.adult_attested_at is not null
    and v_profile.opted_in_at is not null and v_profile.participation_revoked_at is null
    and v_profile.rules_version = v_current_rules and v_profile.accepted_at is not null then
    return p_actor_user_id;
  end if;
  insert into public.community_profiles (
    user_id, username, is_adult, adult_attested_at, opted_in_at,
    participation_revoked_at, rules_version, accepted_at, updated_at
  ) values (
    p_actor_user_id, v_username, true, now(), now(), null,
    v_current_rules, now(), now()
  )
  on conflict (user_id) do update set
    username = excluded.username,
    is_adult = true,
    adult_attested_at = coalesce(public.community_profiles.adult_attested_at, excluded.adult_attested_at),
    opted_in_at = excluded.opted_in_at,
    participation_revoked_at = null,
    rules_version = excluded.rules_version,
    accepted_at = excluded.accepted_at,
    updated_at = now();
  return p_actor_user_id;
end;
$$;

create or replace function public.community_change_username(
  p_actor_user_id uuid,
  p_username text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_username text := lower(btrim(p_username));
begin
  if not private.community_actor_is_verified(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'verified account required';
  end if;
  if v_username is null or v_username !~ '^[a-z0-9_]{3,24}$' or v_username = any(array[
    'admin','administrator','support','help','official','lamilialomi','api','club','creators',
    'community','login','register','account','library','artworks','moderation',
    'pomoc','administratorzy','oficjalnie','spolecznosc','klub','tworcy'
  ]) then
    raise exception using errcode = '22023', message = 'invalid or reserved username';
  end if;
  if not public.community_consume_rate_limit(
    encode(extensions.digest('community-username-change:' || p_actor_user_id::text, 'sha256'), 'hex'),
    3, 3600
  ) then
    raise exception using errcode = '42900', message = 'username changes are rate limited';
  end if;
  update public.community_profiles
  set username = v_username, updated_at = now()
  where user_id = p_actor_user_id
    and is_adult and adult_attested_at is not null and opted_in_at is not null
    and participation_revoked_at is null and suspended_at is null
    and rules_version = '2026-10-25-v1';
  if not found then
    raise exception using errcode = '42501', message = 'active community membership required';
  end if;
  return true;
end;
$$;

create or replace function public.community_revoke_participation(p_actor_user_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.community_actor_is_verified(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'verified account required';
  end if;
  update public.community_profiles
  set participation_revoked_at = now(), updated_at = now()
  where user_id = p_actor_user_id and participation_revoked_at is null;
  return found;
end;
$$;

create or replace function public.community_create_pending_artwork(
  p_actor_user_id uuid,
  p_product_id uuid,
  p_storage_path text,
  p_storage_provider text,
  p_content_type text,
  p_size_bytes bigint,
  p_description text,
  p_idempotency_key uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artwork_id uuid;
  v_profile public.community_profiles%rowtype;
  v_product_status text;
  v_existing public.community_artworks%rowtype;
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
  if p_product_id is null or p_idempotency_key is null
    or p_storage_path is distinct from ('community/' || p_actor_user_id::text || '/' || p_idempotency_key::text) then
    raise exception using errcode = '22023', message = 'unsafe community storage path';
  end if;
  if char_length(coalesce(p_description, '')) > 240 or p_size_bytes <= 0 or p_size_bytes > 4194304
    or p_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_storage_provider not in ('local', 'supabase', 'r2') then
    raise exception using errcode = '22023', message = 'invalid community artwork metadata';
  end if;
  select p.status into v_product_status from public.products p
  where p.id = p_product_id for share;
  if v_product_status is distinct from 'published' or not exists (
    select 1 from public.user_product_unlocks u where u.product_id = p_product_id and u.user_id = p_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'published unlocked product required';
  end if;
  insert into public.community_artworks (
    author_id, product_id, storage_path, storage_provider, content_type,
    size_bytes, description, status, revision, idempotency_key
  ) values (
    p_actor_user_id, p_product_id, p_storage_path, p_storage_provider, p_content_type,
    p_size_bytes, btrim(coalesce(p_description, '')), 'pending', 1, p_idempotency_key
  ) on conflict (author_id, idempotency_key) do nothing
  returning id into v_artwork_id;
  if v_artwork_id is null then
    select * into v_existing from public.community_artworks
    where author_id = p_actor_user_id and idempotency_key = p_idempotency_key;
    if not found then
      raise exception using errcode = '40001', message = 'idempotent artwork retry could not be resolved';
    end if;
    if v_existing.product_id is distinct from p_product_id
      or v_existing.storage_path is distinct from p_storage_path
      or v_existing.storage_provider is distinct from p_storage_provider
      or v_existing.content_type is distinct from p_content_type
      or v_existing.size_bytes is distinct from p_size_bytes
      or v_existing.description is distinct from btrim(coalesce(p_description, '')) then
      raise exception using errcode = '22023', message = 'idempotency key was reused with different artwork metadata';
    end if;
    v_artwork_id := v_existing.id;
  end if;
  return v_artwork_id;
end;
$$;

create or replace function public.community_edit_artwork_description(
  p_actor_user_id uuid,
  p_artwork_id uuid,
  p_expected_revision integer,
  p_description text
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new_revision integer;
begin
  if not private.community_actor_is_verified(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'verified account required';
  end if;
  if char_length(coalesce(p_description, '')) > 240 then
    raise exception using errcode = '22023', message = 'description is too long';
  end if;
  update public.community_artworks a
  set description = btrim(coalesce(p_description, '')),
      status = case when a.status in ('approved', 'rejected') then 'pending' else a.status end,
      published_at = case when a.status in ('approved', 'rejected') then null else a.published_at end,
      moderation_reason = case when a.status in ('approved', 'rejected') then null else a.moderation_reason end,
      revision = a.revision + 1,
      updated_at = now()
  where a.id = p_artwork_id and a.author_id = p_actor_user_id
    and a.deleted_at is null and a.status in ('pending', 'approved', 'rejected', 'removed')
    and a.revision = p_expected_revision
    and exists (
      select 1 from public.community_profiles cp
      where cp.user_id = p_actor_user_id and cp.is_adult and cp.adult_attested_at is not null
        and cp.opted_in_at is not null and cp.participation_revoked_at is null and cp.suspended_at is null
        and cp.rules_version = '2026-10-25-v1'
    )
  returning revision into v_new_revision;
  if not found then
    raise exception using errcode = '40001', message = 'artwork is unavailable or revision changed';
  end if;
  return v_new_revision;
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
begin
  if not private.community_actor_is_verified(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'verified account required';
  end if;
  update public.community_artworks
  set deleted_at = now(), revision = revision + 1, updated_at = now(), moderation_reason = null
  where id = p_artwork_id and author_id = p_actor_user_id
    and deleted_at is null and revision = p_expected_revision;
  if not found then
    raise exception using errcode = '40001', message = 'artwork is unavailable or revision changed';
  end if;
  return true;
end;
$$;

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
  v_product_status text;
  v_next_status text;
  v_new_revision integer;
begin
  if not private.community_actor_is_verified(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  select p.role into v_admin_role from public.profiles p where p.id = p_actor_user_id for share;
  if v_admin_role is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if p_action not in ('approve', 'reject', 'remove', 'restore') then
    raise exception using errcode = '22023', message = 'invalid moderation action';
  end if;
  if p_action in ('reject', 'remove') and char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'moderation reason required';
  end if;
  select * into v_artwork from public.community_artworks
  where id = p_artwork_id and deleted_at is null for update;
  if not found or v_artwork.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'artwork is unavailable or revision changed';
  end if;
  v_next_status := case p_action
    when 'approve' then 'approved'
    when 'reject' then 'rejected'
    when 'remove' then 'removed'
    when 'restore' then 'pending'
  end;
  if not (
    (p_action in ('approve', 'reject') and v_artwork.status = 'pending')
    or (p_action = 'remove' and v_artwork.status = 'approved')
    or (p_action = 'restore' and v_artwork.status = 'removed')
  ) then
    raise exception using errcode = '40001', message = 'moderation transition is not allowed';
  end if;
  if p_action = 'approve' then
    select p.status into v_product_status from public.products p
    where p.id = v_artwork.product_id for share;
    if v_product_status is distinct from 'published' then
      raise exception using errcode = '42501', message = 'published product required for approval';
    end if;
    if v_artwork.author_id is null or not private.community_actor_is_verified(v_artwork.author_id) then
      raise exception using errcode = '42501', message = 'active eligible author required for approval';
    end if;
    if not exists (
      select 1 from public.user_product_unlocks u
      where u.user_id = v_artwork.author_id and u.product_id = v_artwork.product_id
    ) then
      raise exception using errcode = '42501', message = 'unlocked product required for approval';
    end if;
    select * into v_author_profile from public.community_profiles cp
    where cp.user_id = v_artwork.author_id for share;
    if not found or not v_author_profile.is_adult or v_author_profile.adult_attested_at is null
      or v_author_profile.opted_in_at is null or v_author_profile.participation_revoked_at is not null
      or v_author_profile.suspended_at is not null or v_author_profile.rules_version <> '2026-10-25-v1' then
      raise exception using errcode = '42501', message = 'active eligible author required for approval';
    end if;
  end if;
  update public.community_artworks set
    status = v_next_status,
    moderation_reason = case when p_action in ('reject', 'remove') then btrim(p_reason) else null end,
    published_at = case when p_action = 'approve' then now() else null end,
    revision = revision + 1,
    updated_at = now()
  where id = p_artwork_id
  returning revision into v_new_revision;
  insert into public.community_moderation_events (
    artwork_id, actor_user_id, revision, from_status, to_status, reason
  ) values (
    p_artwork_id, p_actor_user_id, v_new_revision, v_artwork.status, v_next_status,
    case when p_action in ('reject', 'remove') then btrim(p_reason) else null end
  );
  return v_new_revision;
end;
$$;

create or replace function public.community_consume_rate_limit(
  p_bucket_key text,
  p_max_hits integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_now timestamptz := now();
begin
  if p_bucket_key is null or p_max_hits is null or p_window_seconds is null
    or p_bucket_key !~ '^[0-9a-f]{64}$' or p_max_hits < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception using errcode = '22023', message = 'invalid rate-limit parameters';
  end if;
  insert into public.community_rate_limit_buckets (bucket_key, window_started_at, hit_count, updated_at)
  values (p_bucket_key, v_now, 1, v_now)
  on conflict (bucket_key) do update set
    window_started_at = case
      when public.community_rate_limit_buckets.window_started_at <= v_now - make_interval(secs => p_window_seconds)
        then v_now else public.community_rate_limit_buckets.window_started_at end,
    hit_count = case
      when public.community_rate_limit_buckets.window_started_at <= v_now - make_interval(secs => p_window_seconds)
        then 1 else least(public.community_rate_limit_buckets.hit_count + 1, p_max_hits + 1) end,
    updated_at = v_now
  returning hit_count into v_count;
  delete from public.community_rate_limit_buckets
  where updated_at < v_now - interval '2 days' and bucket_key <> p_bucket_key;
  return v_count <= p_max_hits;
end;
$$;

-- New functions default to EXECUTE for PUBLIC; explicitly remove all client
-- access and allow only the server's service role.
revoke all on function public.community_join(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.community_change_username(uuid, text) from public, anon, authenticated;
revoke all on function public.community_revoke_participation(uuid) from public, anon, authenticated;
revoke all on function public.community_create_pending_artwork(uuid, uuid, text, text, text, bigint, text, uuid) from public, anon, authenticated;
revoke all on function public.community_edit_artwork_description(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.community_delete_artwork(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.community_moderate_artwork(uuid, uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.community_consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.community_join(uuid, text, boolean, text) to service_role;
grant execute on function public.community_change_username(uuid, text) to service_role;
grant execute on function public.community_revoke_participation(uuid) to service_role;
grant execute on function public.community_create_pending_artwork(uuid, uuid, text, text, text, bigint, text, uuid) to service_role;
grant execute on function public.community_edit_artwork_description(uuid, uuid, integer, text) to service_role;
grant execute on function public.community_delete_artwork(uuid, uuid, integer) to service_role;
grant execute on function public.community_moderate_artwork(uuid, uuid, integer, text, text) to service_role;
grant execute on function public.community_consume_rate_limit(text, integer, integer) to service_role;
