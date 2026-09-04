-- Forward-only follow-up for the premium download authorization contract.
-- This does not rewrite the PR #6 foundation or atomic product-save migrations.

create or replace function private.is_email_verified()
returns boolean
language sql
stable
security definer
set search_path = auth, pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from auth.users
    where id = (select auth.uid())
      and email_confirmed_at is not null
  );
$$;

revoke all on function private.is_email_verified() from public;
grant execute on function private.is_email_verified() to anon, authenticated, service_role;

drop policy if exists "assets_public_metadata_select" on public.product_assets;
create policy "assets_public_metadata_select"
  on public.product_assets for select
  to anon, authenticated
  using (
    (
      is_active
      and is_public = true
      and exists (
        select 1 from public.products p
        where p.id = product_id and p.status = 'published'
      )
    )
    or (select private.is_admin())
    or (
      is_active
      and kind = 'premium_download'
      and is_public = false
      and (select private.is_email_verified())
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.user_product_unlocks u
        join public.products p on p.id = u.product_id
        where u.product_id = product_assets.product_id
          and u.user_id = (select auth.uid())
          and p.status = 'published'
      )
    )
  );

drop policy if exists "premium objects are readable after unlock" on storage.objects;
create policy "premium objects are readable after unlock"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'premium-files'
    and (select private.is_email_verified())
    and exists (
      select 1
      from public.product_assets a
      join public.user_product_unlocks u on u.product_id = a.product_id
      join public.products p on p.id = a.product_id
      where a.bucket = bucket_id
        and a.path = name
        and a.kind = 'premium_download'
        and a.is_public = false
        and a.is_active
        and p.status = 'published'
        and u.user_id = (select auth.uid())
    )
  );

create or replace function private.record_download_event(requested_asset_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := (select auth.uid());
  event_id uuid;
  asset_row public.product_assets%rowtype;
begin
  if current_user_id is null or not private.is_email_verified() then
    return null;
  end if;

  select product_assets.* into asset_row
  from public.product_assets
  join public.products p on p.id = product_assets.product_id
  where product_assets.id = requested_asset_id
    and product_assets.kind = 'premium_download'
    and product_assets.is_public = false
    and product_assets.is_active
    and p.status = 'published'
    and exists (
      select 1
      from public.user_product_unlocks u
      where u.user_id = current_user_id
        and u.product_id = product_assets.product_id
    );

  if not found then
    return null;
  end if;

  insert into public.download_events (user_id, product_id, asset_id)
  values (current_user_id, asset_row.product_id, asset_row.id)
  returning id into event_id;

  return event_id;
end;
$$;

revoke all on function private.record_download_event(uuid) from public;
grant execute on function private.record_download_event(uuid) to authenticated;
