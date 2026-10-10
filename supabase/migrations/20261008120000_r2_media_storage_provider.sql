-- Additive media-provider metadata. Existing assets remain on private Supabase
-- Storage unless an administrator explicitly promotes a verified R2 object.
alter table public.product_assets
  add column if not exists storage_provider text not null default 'supabase';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_assets_storage_provider_check'
      and conrelid = 'public.product_assets'::regclass
  ) then
    alter table public.product_assets
      add constraint product_assets_storage_provider_check
      check (
        storage_provider in ('supabase', 'r2_private', 'r2_public')
        and (
          storage_provider = 'supabase'
          or (kind in ('cover', 'gallery') and is_public)
        )
      );
  end if;
end;
$$;

-- Keep the existing atomic product-save implementation as the source of truth
-- for product edits. This private helper adds provider metadata in the same
-- transaction and retains the existing admin check.
create or replace function private.save_product_with_storage_provider(product_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_product_id uuid := nullif(product_state ->> 'id', '')::uuid;
  result jsonb;
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  result := private.save_product(product_state);

  update public.product_assets current_row
  set storage_provider = coalesce(nullif(item ->> 'storageProvider', ''), 'supabase')
  from jsonb_array_elements(coalesce(product_state -> 'assets', '[]'::jsonb)) item
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

-- Publication state marks an eligible image r2_public before copying so any
-- partial public object stays discoverable for cleanup and retry. Public rows
-- are limited to active, public cover and gallery assets on published products.
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
begin
  if coalesce((select auth.role()), '') <> 'service_role'
    and (current_user_id is null or not private.is_admin()) then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  if requested_provider not in ('supabase', 'r2_private', 'r2_public') then
    raise exception using
      errcode = '22023',
      message = 'Unsupported media storage provider.';
  end if;

  if requested_provider = 'r2_public' and not exists (
    select 1
    from public.product_assets asset
    join public.products product on product.id = asset.product_id
    where asset.id = requested_asset_id
      and asset.kind in ('cover', 'gallery')
      and asset.is_public
      and asset.is_active
      and asset.path like ('products/' || asset.product_id::text || '/' || asset.kind || '/%')
      and product.status = 'published'
  ) then
    raise exception using
      errcode = '42501',
      message = 'Only published public product images can use R2 public storage.';
  end if;

  if requested_provider = 'r2_private' and not exists (
    select 1
    from public.product_assets asset
    where asset.id = requested_asset_id
      and asset.kind in ('cover', 'gallery')
      and asset.is_public
      and asset.path like ('products/' || asset.product_id::text || '/' || asset.kind || '/%')
  ) then
    raise exception using
      errcode = '42501',
      message = 'Only public product images can use R2 private storage.';
  end if;

  update public.product_assets
  set storage_provider = requested_provider
  where id = requested_asset_id;

  return found;
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

revoke all on function private.save_product_with_storage_provider(jsonb) from public;
grant execute on function private.save_product_with_storage_provider(jsonb) to authenticated;
revoke all on function private.set_product_asset_storage_provider(uuid, text) from public;
grant execute on function private.set_product_asset_storage_provider(uuid, text) to authenticated, service_role;
revoke all on function public.save_product_with_storage_provider(jsonb) from public;
grant execute on function public.save_product_with_storage_provider(jsonb) to authenticated;
revoke all on function public.set_product_asset_storage_provider(uuid, text) from public;
grant execute on function public.set_product_asset_storage_provider(uuid, text) to authenticated, service_role;
