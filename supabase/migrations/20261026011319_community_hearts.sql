-- Positive community reactions are private per-member rows with a public-safe,
-- transactionally maintained aggregate on each artwork.

alter table public.community_artworks
  add column likes_count integer not null default 0,
  add constraint community_artworks_likes_count_nonnegative check (likes_count >= 0);

create table public.community_artwork_likes (
  artwork_id uuid not null references public.community_artworks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint community_artwork_likes_pkey primary key (artwork_id, user_id)
);

create index community_artwork_likes_user_artwork_idx
  on public.community_artwork_likes (user_id, artwork_id);

create index community_artworks_popular_page_idx
  on public.community_artworks (likes_count desc, published_at desc, id desc)
  where status = 'approved' and deleted_at is null;

alter table public.community_artwork_likes enable row level security;
revoke all on public.community_artwork_likes from public, anon, authenticated;
grant select, insert, delete on public.community_artwork_likes to service_role;

-- Counter triggers run with their fixed, empty search path and touch only the
-- artwork counter. Execute is not exposed to any API role.
create or replace function private.community_adjust_artwork_likes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artwork_id uuid;
  v_delta integer;
begin
  if tg_op = 'INSERT' then
    v_artwork_id := new.artwork_id;
    v_delta := 1;
  else
    v_artwork_id := old.artwork_id;
    v_delta := -1;
  end if;

  update public.community_artworks
  set likes_count = likes_count + v_delta
  where id = v_artwork_id;

  if tg_op = 'INSERT' then
    return new;
  end if;
  return old;
end;
$$;
revoke all on function private.community_adjust_artwork_likes_count() from public, anon, authenticated, service_role;

create trigger community_artwork_likes_adjust_count
after insert or delete on public.community_artwork_likes
for each row execute function private.community_adjust_artwork_likes_count();

-- Withdrawal, suspension, adult-attestation removal, or stale rules acceptance
-- deletes that member's private hearts. The row-delete trigger decrements the
-- cached counts in the same transaction.
create or replace function private.community_remove_likes_for_ineligible_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_adult is distinct from true
    or new.adult_attested_at is null
    or new.opted_in_at is null
    or new.participation_revoked_at is not null
    or new.suspended_at is not null
    or new.rules_version is distinct from '2026-10-25-v1' then
    -- Profiling updates hold the profile row lock. Lock every affected artwork
    -- in one stable order before the like-delete trigger adjusts counters.
    perform artwork.id
    from public.community_artworks artwork
    join public.community_artwork_likes reaction on reaction.artwork_id = artwork.id
    where reaction.user_id = new.user_id
    order by artwork.id
    for update of artwork;
    delete from public.community_artwork_likes where user_id = new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function private.community_remove_likes_for_ineligible_profile() from public, anon, authenticated, service_role;

create trigger community_profiles_remove_likes_when_ineligible
after update of is_adult, adult_attested_at, opted_in_at, participation_revoked_at, suspended_at, rules_version
on public.community_profiles
for each row execute function private.community_remove_likes_for_ineligible_profile();

-- Idempotently set one member's reaction. The server supplies the actor UUID
-- from the verified session; the function independently rechecks eligibility.
create or replace function public.community_set_artwork_like(
  p_actor_user_id uuid,
  p_artwork_id uuid,
  p_liked boolean
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target_author_id uuid;
  v_profile public.community_profiles%rowtype;
  v_artwork public.community_artworks%rowtype;
  v_author_profile public.community_profiles%rowtype;
  v_product_status text;
  v_liked boolean;
  v_likes_count integer;
  v_author_verified boolean;
begin
  if p_actor_user_id is null or p_artwork_id is null or p_liked is null then
    raise exception using errcode = '22023', message = 'artwork reaction input required';
  end if;

  -- Discover the author without locking the artwork. Lock all Auth and profile
  -- rows before the artwork so concurrent withdrawal/suspension and auth
  -- deletion cannot form a profile/Auth -> artwork cycle with the counter
  -- cleanup triggers below.
  select author_id into v_target_author_id
  from public.community_artworks
  where id = p_artwork_id;
  if not found or v_target_author_id is null then
    return jsonb_build_object('available', false, 'liked', false, 'likesCount', 0);
  end if;

  if p_actor_user_id <= v_target_author_id then
    if not private.community_actor_is_verified(p_actor_user_id) then
      raise exception using errcode = '42501', message = 'verified account required';
    end if;
    v_author_verified := v_target_author_id = p_actor_user_id
      or private.community_actor_is_verified(v_target_author_id);
  else
    v_author_verified := private.community_actor_is_verified(v_target_author_id);
    if not private.community_actor_is_verified(p_actor_user_id) then
      raise exception using errcode = '42501', message = 'verified account required';
    end if;
  end if;
  if not v_author_verified then
    return jsonb_build_object('available', false, 'liked', false, 'likesCount', 0);
  end if;

  if p_actor_user_id <= v_target_author_id then
    select * into v_profile from public.community_profiles where user_id = p_actor_user_id for share;
    if v_target_author_id = p_actor_user_id then
      v_author_profile := v_profile;
    else
      select * into v_author_profile from public.community_profiles where user_id = v_target_author_id for share;
    end if;
  else
    select * into v_author_profile from public.community_profiles where user_id = v_target_author_id for share;
    if v_target_author_id = p_actor_user_id then
      v_profile := v_author_profile;
    else
      select * into v_profile from public.community_profiles where user_id = p_actor_user_id for share;
    end if;
  end if;

  if v_profile.user_id is null or v_profile.is_adult is distinct from true
    or v_profile.adult_attested_at is null
    or v_profile.opted_in_at is null
    or v_profile.participation_revoked_at is not null
    or v_profile.suspended_at is not null
    or v_profile.rules_version is distinct from '2026-10-25-v1' then
    raise exception using errcode = '42501', message = 'active community membership required';
  end if;
  if v_author_profile.user_id is null or v_author_profile.is_adult is distinct from true
    or v_author_profile.adult_attested_at is null
    or v_author_profile.opted_in_at is null
    or v_author_profile.participation_revoked_at is not null
    or v_author_profile.suspended_at is not null
    or v_author_profile.rules_version is distinct from '2026-10-25-v1' then
    return jsonb_build_object('available', false, 'liked', false, 'likesCount', 0);
  end if;

  select * into v_artwork
  from public.community_artworks
  where id = p_artwork_id
  for update;
  if not found or v_artwork.author_id is distinct from v_target_author_id
    or v_artwork.status <> 'approved' or v_artwork.deleted_at is not null
    or v_artwork.published_at is null or v_artwork.author_id is null then
    return jsonb_build_object('available', false, 'liked', false, 'likesCount', 0);
  end if;

  select p.status into v_product_status
  from public.products p
  where p.id = v_artwork.product_id
  for share;
  if v_product_status is distinct from 'published' then
    return jsonb_build_object('available', false, 'liked', false, 'likesCount', 0);
  end if;

  if p_liked then
    insert into public.community_artwork_likes (artwork_id, user_id)
    values (p_artwork_id, p_actor_user_id)
    on conflict (artwork_id, user_id) do nothing;
  else
    delete from public.community_artwork_likes
    where artwork_id = p_artwork_id and user_id = p_actor_user_id;
  end if;

  select exists (
    select 1 from public.community_artwork_likes
    where artwork_id = p_artwork_id and user_id = p_actor_user_id
  ) into v_liked;

  select likes_count into strict v_likes_count
  from public.community_artworks where id = p_artwork_id;

  return jsonb_build_object('available', true, 'liked', v_liked, 'likesCount', v_likes_count);
end;
$$;
revoke all on function public.community_set_artwork_like(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.community_set_artwork_like(uuid, uuid, boolean) to service_role;
