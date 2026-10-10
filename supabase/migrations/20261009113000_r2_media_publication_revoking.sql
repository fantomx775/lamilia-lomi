-- Fence public-object deletion from concurrent product publication. While an
-- asset is revoking, reads stay on private R2 and new public promotions wait.
alter table public.product_assets
  drop constraint if exists product_assets_storage_provider_check;

alter table public.product_assets
  add constraint product_assets_storage_provider_check
  check (
    storage_provider in (
      'supabase',
      'r2_private',
      'r2_public_pending',
      'r2_public_revoking',
      'r2_public'
    )
    and (
      storage_provider = 'supabase'
      or (kind in ('cover', 'gallery') and is_public)
    )
  );

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

  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  perform 1 from public.products where id = requested_product_id for update;
  perform 1 from public.product_assets where product_id = requested_product_id for update;
  if exists (
    select 1
    from public.product_assets previous_asset
    left join jsonb_to_recordset(coalesce(product_state -> 'assets', '[]'::jsonb))
      as next_asset(id uuid, path text, kind text)
      on next_asset.id = previous_asset.id
    where previous_asset.product_id = requested_product_id
      and previous_asset.storage_provider in ('r2_public_pending', 'r2_public_revoking', 'r2_public')
      and (
        previous_asset.storage_provider = 'r2_public_revoking'
        or requested_product_status is distinct from 'published'
        or next_asset.id is null
        or next_asset.path is distinct from previous_asset.path
        or coalesce(next_asset.kind, '') not in ('cover', 'gallery')
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'Public media must be revoked before changing product media or publication state.';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('id', id, 'path', path, 'storage_provider', storage_provider)),
    '[]'::jsonb
  ) into previous_assets
  from public.product_assets
  where product_id = requested_product_id;

  result := private.save_product(product_state);

  update public.product_assets current_row
  set storage_provider = case
    when previous_asset.storage_provider = 'r2_public_revoking'
      and previous_asset.path = nullif(item ->> 'path', '')
      and current_row.kind in ('cover', 'gallery')
      and current_row.is_public
      and current_row.path like ('products/' || current_row.product_id::text || '/' || current_row.kind || '/%')
    then 'r2_public_revoking'
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
    else case
      when nullif(item ->> 'storageProvider', '') in ('r2_public_pending', 'r2_public_revoking', 'r2_public')
        then 'r2_private'
      else coalesce(nullif(item ->> 'storageProvider', ''), 'supabase')
    end
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

-- Older app instances still call save_product(jsonb). Apply the same public
-- media mutation fence there so an old or rolled-back server cannot archive a
-- product or remove an R2 public asset without revoking its public object.
create or replace function private.assert_legacy_product_save_safe(product_state jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_product_id uuid := nullif(product_state ->> 'id', '')::uuid;
  requested_product_status text := nullif(product_state ->> 'status', '');
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  if requested_product_id is null then
    raise exception using
      errcode = '22023',
      message = 'Product identifier is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  perform 1 from public.products where id = requested_product_id for update;
  perform 1 from public.product_assets where product_id = requested_product_id for update;

  if exists (
    select 1
    from public.product_assets previous_asset
    left join jsonb_to_recordset(coalesce(product_state -> 'assets', '[]'::jsonb))
      as next_asset(id uuid, path text, kind text)
      on next_asset.id = previous_asset.id
    where previous_asset.product_id = requested_product_id
      and previous_asset.storage_provider in ('r2_public_pending', 'r2_public_revoking', 'r2_public')
      and (
        previous_asset.storage_provider = 'r2_public_revoking'
        or requested_product_status is distinct from 'published'
        or next_asset.id is null
        or next_asset.path is distinct from previous_asset.path
        or coalesce(next_asset.kind, '') not in ('cover', 'gallery')
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'Public media must be revoked before changing product media or publication state.';
  end if;
end;
$$;

create or replace function public.save_product(product_state jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.assert_legacy_product_save_safe(product_state);
  return private.save_product(product_state);
end;
$$;

revoke all on function private.assert_legacy_product_save_safe(jsonb) from public;
grant execute on function private.assert_legacy_product_save_safe(jsonb) to authenticated;
revoke all on function public.save_product(jsonb) from public;
grant execute on function public.save_product(jsonb) to authenticated;

-- Keep authenticated admins from bypassing the lifecycle RPCs with direct
-- Data API writes to product state or asset provider/path metadata.
revoke insert, update, delete, truncate, references, trigger
  on public.products, public.product_assets from authenticated;
drop policy if exists "products_admin_all" on public.products;
drop policy if exists "assets_admin_all" on public.product_assets;

-- Archiving changes only the status. An update-only RPC avoids recreating a
-- product if it was deleted after the admin snapshot was read.
create or replace function private.archive_product(requested_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  if requested_product_id is null then
    raise exception using
      errcode = '22023',
      message = 'Product identifier is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  perform 1 from public.products where id = requested_product_id for update;
  if not found then return false; end if;
  perform 1 from public.product_assets where product_id = requested_product_id for update;

  if exists (
    select 1
    from public.product_assets asset
    where asset.product_id = requested_product_id
      and asset.storage_provider in ('r2_public_pending', 'r2_public_revoking', 'r2_public')
  ) then
    raise exception using
      errcode = '55000',
      message = 'Public media must be revoked before archiving this product.';
  end if;

  update public.products
  set status = 'archived', updated_at = now()
  where id = requested_product_id;
  return found;
end;
$$;

create or replace function public.archive_product(requested_product_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.archive_product(requested_product_id);
$$;

revoke all on function private.archive_product(uuid) from public;
grant execute on function private.archive_product(uuid) to authenticated;
revoke all on function public.archive_product(uuid) from public;
grant execute on function public.archive_product(uuid) to authenticated;

create or replace function private.delete_product(requested_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  if requested_product_id is null then
    raise exception using
      errcode = '22023',
      message = 'Product identifier is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  perform 1 from public.products where id = requested_product_id for update;
  if not found then return false; end if;
  perform 1 from public.product_assets where product_id = requested_product_id for update;

  if exists (
    select 1
    from public.product_assets asset
    where asset.product_id = requested_product_id
      and asset.storage_provider in ('r2_public_pending', 'r2_public_revoking', 'r2_public')
  ) then
    raise exception using
      errcode = '55000',
      message = 'Public media must be revoked before deleting this product.';
  end if;

  delete from public.products where id = requested_product_id;
  return found;
end;
$$;

create or replace function public.delete_product(requested_product_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.delete_product(requested_product_id);
$$;

revoke all on function private.delete_product(uuid) from public;
grant execute on function private.delete_product(uuid) to authenticated;
revoke all on function public.delete_product(uuid) from public;
grant execute on function public.delete_product(uuid) to authenticated;

create or replace function private.begin_product_asset_public_revocation(
  requested_asset_id uuid,
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
  current_provider text;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
    and (current_user_id is null or not private.is_admin()) then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  select asset.product_id into requested_product_id
  from public.product_assets asset
  where asset.id = requested_asset_id;
  if not found then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  perform 1 from public.products where id = requested_product_id for update;
  select asset.storage_provider into current_provider
  from public.product_assets asset
  where asset.id = requested_asset_id
    and asset.product_id = requested_product_id
    and asset.path = requested_path
    and asset.kind in ('cover', 'gallery')
    and asset.is_public
    and asset.path like ('products/' || asset.product_id::text || '/' || asset.kind || '/%')
  for update;
  if not found then return false; end if;

  -- A revoking sibling owns the object-level fence for this path. Do not let
  -- two cleanup workers race their demote/delete operations.
  if current_provider = 'r2_public_revoking' or exists (
    select 1
    from public.product_assets sibling
    where sibling.product_id = requested_product_id
      and sibling.path = requested_path
      and sibling.id <> requested_asset_id
      and sibling.storage_provider = 'r2_public_revoking'
  ) then
    return false;
  end if;

  update public.product_assets
  set storage_provider = 'r2_public_revoking'
  where id = requested_asset_id
    and path = requested_path
    and storage_provider in ('r2_private', 'r2_public_pending', 'r2_public');

  return found;
end;
$$;

create or replace function public.begin_product_asset_public_revocation(
  requested_asset_id uuid,
  requested_path text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.begin_product_asset_public_revocation(requested_asset_id, requested_path);
$$;

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
  current_provider text;
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

  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  perform 1 from public.products where id = requested_product_id for update;
  select asset.storage_provider into current_provider
  from public.product_assets asset
  where asset.id = requested_asset_id
    and asset.product_id = requested_product_id
    and asset.path = requested_path
  for update;
  if not found then return false; end if;

  if current_provider = 'r2_public_revoking'
    and requested_provider in ('r2_public_pending', 'r2_public') then
    return false;
  end if;
  if requested_provider = 'r2_public_revoking' then return false; end if;
  if requested_provider = 'r2_public'
    and current_provider not in ('r2_public_pending', 'r2_public') then
    return false;
  end if;
  if requested_provider = 'r2_public'
    and current_provider = 'r2_public_pending'
    and coalesce((select auth.role()), '') <> 'service_role' then
    return false;
  end if;
  if requested_provider = 'r2_public_pending'
    and current_provider not in ('r2_private', 'r2_public_pending') then
    return false;
  end if;
  if requested_provider = 'r2_private'
    and current_provider not in ('supabase', 'r2_private', 'r2_public_pending', 'r2_public_revoking') then
    return false;
  end if;
  -- Clearing the revocation marker carries an external R2 cleanup obligation.
  -- Only the server-side cleanup flow may finalize it after confirming deletion.
  if requested_provider = 'r2_private'
    and current_provider = 'r2_public_revoking'
    and coalesce((select auth.role()), '') <> 'service_role' then
    return false;
  end if;
  if requested_provider = 'r2_private' and current_provider = 'r2_public_pending' then
    return false;
  end if;
  if requested_provider = 'supabase'
    and current_provider in ('r2_public_pending', 'r2_public_revoking', 'r2_public') then
    return false;
  end if;

  -- Publication uses an external R2 copy after this transaction commits. A
  -- same-path revocation marker must therefore block both pending and final
  -- public transitions until its object cleanup is complete.
  if requested_provider in ('r2_public_pending', 'r2_public') and exists (
    select 1
    from public.product_assets sibling
    where sibling.product_id = requested_product_id
      and sibling.path = requested_path
      and sibling.id <> requested_asset_id
      and sibling.storage_provider = 'r2_public_revoking'
  ) then
    return false;
  end if;

  if requested_provider in ('r2_public_pending', 'r2_public') and not exists (
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

-- Maintenance reconciliation must recheck eligibility while holding the same
-- product lock used by saves, then fence an ineligible row before deleting its
-- public object. An already-revoking row is an idempotent recovery candidate.
create or replace function private.begin_stale_product_asset_public_revocation(
  requested_asset_id uuid,
  requested_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_product_id uuid;
  current_provider text;
  current_product_status text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'Service role access is required.';
  end if;

  select asset.product_id into requested_product_id
  from public.product_assets asset
  where asset.id = requested_asset_id
    and asset.path = requested_path;
  if not found then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  perform 1 from public.products where id = requested_product_id for update;
  select asset.storage_provider
  into current_provider
  from public.product_assets asset
  where asset.id = requested_asset_id
    and asset.product_id = requested_product_id
    and asset.path = requested_path
    and asset.kind in ('cover', 'gallery')
    and asset.path like ('products/' || asset.product_id::text || '/' || asset.kind || '/%')
  for update;
  if not found then return false; end if;

  select product.status into current_product_status
  from public.products product
  where product.id = requested_product_id;

  -- A key is stale only when no active, public image for a published product
  -- still points to it. The product lock serializes this check with saves and
  -- provider transitions, including a promotion that committed after the
  -- backfill's earlier read.
  if current_product_status = 'published' and exists (
    select 1
    from public.product_assets sibling
    where sibling.product_id = requested_product_id
      and sibling.path = requested_path
      and sibling.kind in ('cover', 'gallery')
      and sibling.storage_provider in ('r2_public_pending', 'r2_public')
      and sibling.is_active
      and sibling.is_public
  ) then
    return false;
  end if;

  -- A revoking marker fences the object path. Duplicate asset rows that share
  -- this key must join the same fence or reconciliation can never finish.
  if current_provider = 'r2_public_revoking' then return true; end if;
  if current_provider not in ('r2_private', 'r2_public_pending', 'r2_public') then
    return false;
  end if;

  update public.product_assets
  set storage_provider = 'r2_public_revoking'
  where id = requested_asset_id
    and path = requested_path
    and storage_provider in ('r2_private', 'r2_public_pending', 'r2_public');

  return found;
end;
$$;

create or replace function public.begin_stale_product_asset_public_revocation(
  requested_asset_id uuid,
  requested_path text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.begin_stale_product_asset_public_revocation(requested_asset_id, requested_path);
$$;

revoke all on function private.begin_product_asset_public_revocation(uuid, text) from public;
grant execute on function private.begin_product_asset_public_revocation(uuid, text) to authenticated, service_role;
revoke all on function public.begin_product_asset_public_revocation(uuid, text) from public;
grant execute on function public.begin_product_asset_public_revocation(uuid, text) to authenticated, service_role;
revoke all on function private.begin_stale_product_asset_public_revocation(uuid, text) from public, authenticated;
grant execute on function private.begin_stale_product_asset_public_revocation(uuid, text) to service_role;
revoke all on function public.begin_stale_product_asset_public_revocation(uuid, text) from public, authenticated;
grant execute on function public.begin_stale_product_asset_public_revocation(uuid, text) to service_role;
revoke all on function private.set_product_asset_storage_provider(uuid, text, text) from public;
grant execute on function private.set_product_asset_storage_provider(uuid, text, text) to authenticated, service_role;
revoke all on function public.set_product_asset_storage_provider(uuid, text, text) from public;
grant execute on function public.set_product_asset_storage_provider(uuid, text, text) to authenticated, service_role;
