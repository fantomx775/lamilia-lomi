alter table public.community_artworks
  add column image_width integer,
  add column image_height integer,
  add constraint community_artworks_image_dimensions_valid check (
    (image_width is null and image_height is null)
    or (
      image_width is not null
      and image_height is not null
      and image_width between 1 and 2048
      and image_height between 1 and 2048
      and image_width::bigint * image_height::bigint <= 40000000
    )
  );

-- Keep the three-argument overload for already-deployed callers. It leaves
-- dimensions NULL, which intentionally omits srcset and keeps the media URL fallback.
create function public.community_finalize_upload(
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_lease_token uuid,
  p_image_width integer,
  p_image_height integer
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
  if p_image_width is null or p_image_height is null
    or p_image_width not between 1 and 2048 or p_image_height not between 1 and 2048
    or p_image_width::bigint * p_image_height::bigint > 40000000 then
    raise exception using errcode = '22023', message = 'invalid image dimensions';
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
    image_width, image_height, description, status, revision, idempotency_key, upload_fingerprint
  ) values (
    p_actor_user_id, v_reservation.product_id, v_reservation.storage_path,
    v_reservation.storage_provider, v_reservation.content_type, v_reservation.size_bytes,
    p_image_width, p_image_height, v_reservation.description, 'pending', 1,
    v_reservation.idempotency_key, v_reservation.upload_fingerprint
  ) returning id into v_artwork_id;
  update public.community_upload_reservations set
    state = 'finalized', artwork_id = v_artwork_id, updated_at = now()
  where author_id = p_actor_user_id and idempotency_key = p_idempotency_key;
  return v_artwork_id;
end;
$$;

revoke all on function public.community_finalize_upload(uuid, uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.community_finalize_upload(uuid, uuid, uuid, integer, integer) to service_role;
