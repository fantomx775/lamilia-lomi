-- A deletion marker serializes product hard-delete cleanup with product edits
-- and community upload reservations. It is intentionally additive: the legacy
-- delete_product RPC remains compatible with pre-merge app versions.
create table public.community_product_deletion_markers (
  product_id uuid primary key references public.products(id) on delete cascade,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.community_product_deletion_markers enable row level security;
revoke all on public.community_product_deletion_markers from public, anon, authenticated;
grant select, insert, update, delete on public.community_product_deletion_markers to service_role;

create or replace function private.community_reject_marked_product_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.community_product_deletion_markers marker where marker.product_id = old.id) then
    raise exception using errcode = '55000', message = 'Product deletion is already in progress.';
  end if;
  return new;
end;
$$;
revoke all on function private.community_reject_marked_product_update() from public, anon, authenticated, service_role;
create trigger products_reject_update_while_community_deleting
before update on public.products
for each row execute function private.community_reject_marked_product_update();

create or replace function private.community_reject_reservation_for_marked_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.community_product_deletion_markers marker where marker.product_id = new.product_id) then
    raise exception using errcode = '55000', message = 'Product deletion is already in progress.';
  end if;
  return new;
end;
$$;
revoke all on function private.community_reject_reservation_for_marked_product() from public, anon, authenticated, service_role;
create trigger community_reservations_reject_marked_product
before insert or update of product_id on public.community_upload_reservations
for each row execute function private.community_reject_reservation_for_marked_product();

create or replace function public.community_begin_product_deletion(requested_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if requested_product_id is null then
    raise exception using errcode = '22023', message = 'Product identifier is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  select product.status into v_status from public.products product
  where product.id = requested_product_id for update;
  if not found then return jsonb_build_object('state', 'not_found'); end if;

  if exists (select 1 from public.community_artworks artwork where artwork.product_id = requested_product_id)
    or exists (select 1 from public.community_upload_reservations reservation where reservation.product_id = requested_product_id) then
    return jsonb_build_object('state', 'community_references');
  end if;

  insert into public.community_product_deletion_markers (product_id)
  values (requested_product_id) on conflict (product_id) do update set updated_at = now();
  return jsonb_build_object('state', 'deleting', 'status', v_status);
end;
$$;

create or replace function public.community_finalize_product_deletion(requested_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if requested_product_id is null then
    raise exception using errcode = '22023', message = 'Product identifier is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  perform 1 from public.products product where product.id = requested_product_id for update;
  if not found then return true; end if;
  if not exists (select 1 from public.community_product_deletion_markers marker where marker.product_id = requested_product_id) then
    raise exception using errcode = '55000', message = 'Product deletion has not been prepared.';
  end if;
  if exists (select 1 from public.community_artworks artwork where artwork.product_id = requested_product_id)
    or exists (select 1 from public.community_upload_reservations reservation where reservation.product_id = requested_product_id) then
    raise exception using errcode = '23503', message = 'Community artwork prevents product deletion.';
  end if;
  if exists (select 1 from public.product_assets asset where asset.product_id = requested_product_id
    and asset.storage_provider in ('r2_public_pending', 'r2_public_revoking', 'r2_public')) then
    raise exception using errcode = '55000', message = 'Public media must be revoked before deleting this product.';
  end if;
  return private.delete_product(requested_product_id);
end;
$$;

revoke all on function public.community_begin_product_deletion(uuid) from public, anon;
revoke all on function public.community_finalize_product_deletion(uuid) from public, anon;
grant execute on function public.community_begin_product_deletion(uuid) to authenticated;
grant execute on function public.community_finalize_product_deletion(uuid) to authenticated;
