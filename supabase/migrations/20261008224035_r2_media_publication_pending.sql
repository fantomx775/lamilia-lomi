
-- Keep public URLs disabled while a private R2 object is being copied to the
-- public bucket. Only a verified copy may transition to r2_public.
alter table public.product_assets
  drop constraint if exists product_assets_storage_provider_check;

alter table public.product_assets
  add constraint product_assets_storage_provider_check
  check (
    storage_provider in ('supabase', 'r2_private', 'r2_public_pending', 'r2_public')
    and (
      storage_provider = 'supabase'
      or (kind in ('cover', 'gallery') and is_public)
    )
  );

-- Serialize admin product saves with provider transitions. Preserve a
-- concurrent R2 publication state for unchanged paths, and force it back to
-- private-serving pending when the same save unpublishes or disables an image.
create or replace function private.save_product_with_storage_provider(product_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_product_id uuid := nullif(product_state ->> 'id', '')::uuid;
  requested_product_status text := nullif(product_state ->> 'status', '');
  previous_assets jsonb;
  result jsonb;
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  -- Keep the lock order used by private.save_product, then lock asset rows so
  -- a publication marker cannot race the provider snapshot used by this save.
  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  perform 1 from public.products where id = requested_product_id for update;
  perform 1 from public.product_assets where product_id = requested_product_id for update;
  select coalesce(
    jsonb_agg(jsonb_build_object('id', id, 'path', path, 'storage_provider', storage_provider)),
    '[]'::jsonb
  ) into previous_assets
  from public.product_assets
  where product_id = requested_product_id;

  result := private.save_product(product_state);

  update public.product_assets current_row
  set storage_provider = case
    when previous_asset.storage_provider in ('r2_public_pending', 'r2_public')
      and previous_asset.path = nullif(item ->> 'path', '')
      and current_row.kind in ('cover', 'gallery')
      and current_row.is_public
      and current_row.path like ('products/' || current_row.product_id::text || '/' || current_row.kind || '/%')
    then case
      when requested_product_status = 'published' and current_row.is_active
        then previous_asset.storage_provider
      else 'r2_public_pending'
    end
    else coalesce(nullif(item ->> 'storageProvider', ''), 'supabase')
  end
  from jsonb_array_elements(coalesce(product_state -> 'assets', '[]'::jsonb)) item
  left join jsonb_to_recordset(previous_assets)
    as previous_asset(id uuid, path text, storage_provider text)
    on previous_asset.id = nullif(item ->> 'id', '')::uuid
  where current_row.id = nullif(item ->> 'id', '')::uuid
    and current_row.product_id = requested_product_id;

  return result;
end;
$$;

create or replace function public.save_product_with_storage_provider(product_state jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.save_product_with_storage_provider(product_state);
$$;

-- The path-bound RPC ties every transition to the exact object path whose
-- bytes were inspected or copied.
create or replace function private.set_product_asset_storage_provider(
  requested_asset_id uuid,
  requested_provider text,
  requested_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_product_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
    and (current_user_id is null or not private.is_admin()) then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  if requested_provider not in ('supabase', 'r2_private', 'r2_public_pending', 'r2_public') then
    raise exception using
      errcode = '22023',
      message = 'Unsupported media storage provider.';
  end if;

  select asset.product_id into requested_product_id
  from public.product_assets asset
  where asset.id = requested_asset_id;
  if not found then return false; end if;

  -- Use the same product -> asset lock order as product saves. The eligibility
  -- check below then sees a committed product state after any concurrent save.
  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  perform 1 from public.products where id = requested_product_id for update;
  perform 1
  from public.product_assets asset
  where asset.id = requested_asset_id
    and asset.product_id = requested_product_id
    and asset.path = requested_path
  for update;
  if not found then return false; end if;

  if requested_provider in ('r2_public_pending', 'r2_public') and not exists (
    select 1
    from public.product_assets asset
    where asset.id = requested_asset_id
      and asset.path = requested_path
      and asset.kind in ('cover', 'gallery')
      and asset.is_public
      and asset.path like ('products/' || asset.product_id::text || '/' || asset.kind || '/%')
  ) then
    raise exception using
      errcode = '42501',
      message = 'Only public product images on the requested path can use R2 storage.';
  end if;

  if requested_provider = 'r2_public' and not exists (
    select 1
    from public.product_assets asset
    join public.products product on product.id = asset.product_id
    where asset.id = requested_asset_id
      and asset.path = requested_path
      and asset.kind in ('cover', 'gallery')
      and asset.is_public
      and asset.is_active
      and asset.path like ('products/' || asset.product_id::text || '/' || asset.kind || '/%')
      and product.status = 'published'
  ) then
    raise exception using
      errcode = '42501',
      message = 'Only verified, active images on published products can use R2 public storage.';
  end if;

  if requested_provider in ('supabase', 'r2_private') and not exists (
    select 1
    from public.product_assets asset
    where asset.id = requested_asset_id
      and asset.path = requested_path
      and asset.kind in ('cover', 'gallery')
      and asset.is_public
      and asset.path like ('products/' || asset.product_id::text || '/' || asset.kind || '/%')
  ) then
    raise exception using
      errcode = '42501',
      message = 'Only public product images on the requested path can use this storage provider.';
  end if;

  update public.product_assets
  set storage_provider = requested_provider
  where id = requested_asset_id
    and path = requested_path;

  return found;
end;
$$;

create or replace function public.set_product_asset_storage_provider(
  requested_asset_id uuid,
  requested_provider text,
  requested_path text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.set_product_asset_storage_provider(requested_asset_id, requested_provider, requested_path);
$$;

-- Keep the old RPC signature available during rolling deploys. Its old
-- pre-copy r2_public transition is rejected so older code cannot expose a
-- missing object. Private and Supabase transitions remain compatible.
create or replace function private.set_product_asset_storage_provider(
  requested_asset_id uuid,
  requested_provider text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_path text;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
    and (current_user_id is null or not private.is_admin()) then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  if requested_provider = 'r2_public' then
    return false;
  end if;

  select asset.path into requested_path
  from public.product_assets asset
  where asset.id = requested_asset_id;
  if not found then return false; end if;

  return private.set_product_asset_storage_provider(
    requested_asset_id,
    requested_provider,
    requested_path
  );
end;
$$;

create or replace function public.set_product_asset_storage_provider(
  requested_asset_id uuid,
  requested_provider text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.set_product_asset_storage_provider(requested_asset_id, requested_provider);
$$;

revoke all on function private.set_product_asset_storage_provider(uuid, text, text) from public;
grant execute on function private.set_product_asset_storage_provider(uuid, text, text) to authenticated, service_role;
revoke all on function public.set_product_asset_storage_provider(uuid, text, text) from public;
grant execute on function public.set_product_asset_storage_provider(uuid, text, text) to authenticated, service_role;
revoke all on function private.set_product_asset_storage_provider(uuid, text) from public;
grant execute on function private.set_product_asset_storage_provider(uuid, text) to authenticated, service_role;
revoke all on function public.set_product_asset_storage_provider(uuid, text) from public;
grant execute on function public.set_product_asset_storage_provider(uuid, text) to authenticated, service_role;
