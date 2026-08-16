-- Atomic, history-safe product editing.
-- The RPC accepts the complete desired product state and applies it in one
-- transaction. Removed assets remain inactive so download history keeps its
-- stable asset identity; removed premium codes remain inactive when used.

alter table public.product_assets
  add column if not exists is_active boolean not null default true;

create index if not exists product_assets_active_product_idx
  on public.product_assets (product_id, is_active, kind);

create or replace function private.save_product(product_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_product_id uuid := nullif(product_state ->> 'id', '')::uuid;
  requested_cover_asset_id uuid := nullif(product_state ->> 'coverAssetId', '')::uuid;
  requested_video_asset_id uuid := nullif(product_state ->> 'videoAssetId', '')::uuid;
  requested_updated_at timestamptz := coalesce(
    nullif(product_state ->> 'updatedAt', '')::timestamptz,
    now()
  );
begin
  if current_user_id is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  if requested_product_id is null then
    raise exception using
      errcode = '22023',
      message = 'Product identifier is required.';
  end if;

  -- Serialize saves for the same product, including two first saves for a
  -- newly-created UUID where there is not yet a row to lock.
  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));

  perform 1
  from public.products
  where id = requested_product_id
  for update;

  if nullif(product_state ->> 'slug', '') is null
    or nullif(product_state ->> 'status', '') is null
    or nullif(product_state ->> 'audience', '') is null
    or nullif(product_state ->> 'productType', '') is null then
    raise exception using
      errcode = '22023',
      message = 'Product fields are incomplete.';
  end if;

  -- Existing stable child IDs must belong to this product. This prevents a
  -- client from moving another product's historical row by supplying its ID.
  if exists (
    select 1
    from public.product_assets a
    join jsonb_array_elements(coalesce(product_state -> 'assets', '[]'::jsonb)) item
      on a.id = nullif(item ->> 'id', '')::uuid
    where a.product_id <> requested_product_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Asset does not belong to the product.';
  end if;

  if exists (
    select 1
    from public.amazon_links l
    join jsonb_array_elements(coalesce(product_state -> 'amazonLinks', '[]'::jsonb)) item
      on l.id = nullif(item ->> 'id', '')::uuid
    where l.product_id <> requested_product_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Amazon link does not belong to the product.';
  end if;

  if exists (
    select 1
    from public.premium_codes c
    join jsonb_array_elements(coalesce(product_state -> 'premiumCodes', '[]'::jsonb)) item
      on c.id = nullif(item ->> 'id', '')::uuid
    where c.product_id <> requested_product_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Premium code does not belong to the product.';
  end if;

  insert into public.products (
    id,
    slug,
    status,
    audience,
    product_type,
    cover_asset_id,
    video_asset_id,
    review_delay_days,
    sort_order,
    updated_at
  )
  values (
    requested_product_id,
    product_state ->> 'slug',
    product_state ->> 'status',
    product_state ->> 'audience',
    product_state ->> 'productType',
    null,
    null,
    coalesce(nullif(product_state ->> 'reviewDelayDays', '')::integer, 14),
    coalesce(nullif(product_state ->> 'sortOrder', '')::integer, 100),
    requested_updated_at
  )
  on conflict (id) do update
    set slug = excluded.slug,
        status = excluded.status,
        audience = excluded.audience,
        product_type = excluded.product_type,
        review_delay_days = excluded.review_delay_days,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at;

  -- Translation rows are replaceable presentation data, but their complete
  -- desired set is still reconciled inside this same transaction.
  delete from public.product_translations current_row
  where current_row.product_id = requested_product_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(product_state -> 'translations', '[]'::jsonb)) item
      where item ->> 'locale' = current_row.locale
    );

  insert into public.product_translations (
    product_id,
    locale,
    title,
    short_description,
    long_description,
    seo_title,
    seo_description
  )
  select
    requested_product_id,
    item ->> 'locale',
    item ->> 'title',
    item ->> 'shortDescription',
    item ->> 'longDescription',
    nullif(item ->> 'seoTitle', ''),
    nullif(item ->> 'seoDescription', '')
  from jsonb_array_elements(coalesce(product_state -> 'translations', '[]'::jsonb)) item
  on conflict (product_id, locale) do update
    set title = excluded.title,
        short_description = excluded.short_description,
        long_description = excluded.long_description,
        seo_title = excluded.seo_title,
        seo_description = excluded.seo_description;

  delete from public.product_categories current_row
  where current_row.product_id = requested_product_id
    and not exists (
      select 1
      from jsonb_array_elements_text(coalesce(product_state -> 'categoryIds', '[]'::jsonb)) item
      where item::uuid = current_row.category_id
    );

  insert into public.product_categories (product_id, category_id)
  select requested_product_id, item::uuid
  from jsonb_array_elements_text(coalesce(product_state -> 'categoryIds', '[]'::jsonb)) item
  on conflict do nothing;

  delete from public.product_tags current_row
  where current_row.product_id = requested_product_id
    and not exists (
      select 1
      from jsonb_array_elements_text(coalesce(product_state -> 'tagIds', '[]'::jsonb)) item
      where item::uuid = current_row.tag_id
    );

  insert into public.product_tags (product_id, tag_id)
  select requested_product_id, item::uuid
  from jsonb_array_elements_text(coalesce(product_state -> 'tagIds', '[]'::jsonb)) item
  on conflict do nothing;

  -- A partial unique index protects one primary link. Clear the old primary
  -- before applying the desired set so a primary switch is atomic to callers.
  update public.amazon_links
  set is_primary = false
  where product_id = requested_product_id;

  delete from public.amazon_links current_row
  where current_row.product_id = requested_product_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(product_state -> 'amazonLinks', '[]'::jsonb)) item
      where nullif(item ->> 'id', '')::uuid = current_row.id
    );

  insert into public.amazon_links (id, product_id, market, url, is_primary)
  select
    coalesce(nullif(item ->> 'id', '')::uuid, gen_random_uuid()),
    requested_product_id,
    item ->> 'market',
    item ->> 'url',
    coalesce((item ->> 'isPrimary')::boolean, false)
  from jsonb_array_elements(coalesce(product_state -> 'amazonLinks', '[]'::jsonb)) item
  on conflict (id) do update
    set product_id = excluded.product_id,
        market = excluded.market,
        url = excluded.url,
        is_primary = excluded.is_primary;

  -- Unused removed codes may be deleted. A code referenced by an unlock is
  -- retained with active=false, preserving the historical FK identity.
  update public.premium_codes current_row
  set active = false
  where current_row.product_id = requested_product_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(product_state -> 'premiumCodes', '[]'::jsonb)) item
      where nullif(item ->> 'id', '')::uuid = current_row.id
    )
    and exists (
      select 1
      from public.user_product_unlocks unlock_row
      where unlock_row.premium_code_id = current_row.id
    );

  delete from public.premium_codes current_row
  where current_row.product_id = requested_product_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(product_state -> 'premiumCodes', '[]'::jsonb)) item
      where nullif(item ->> 'id', '')::uuid = current_row.id
    )
    and not exists (
      select 1
      from public.user_product_unlocks unlock_row
      where unlock_row.premium_code_id = current_row.id
    );

  insert into public.premium_codes (id, product_id, code, active)
  select
    coalesce(nullif(item ->> 'id', '')::uuid, gen_random_uuid()),
    requested_product_id,
    item ->> 'code',
    coalesce((item ->> 'active')::boolean, false)
  from jsonb_array_elements(coalesce(product_state -> 'premiumCodes', '[]'::jsonb)) item
  on conflict (id) do update
    set product_id = excluded.product_id,
        code = excluded.code,
        active = excluded.active;

  -- Keep every historical asset row, but make removed rows unavailable to
  -- public reads, premium authorization, and new downloads. Desired rows are
  -- reactivated in place, preserving their IDs and created_at values.
  update public.product_assets current_row
  set is_active = false
  where current_row.product_id = requested_product_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(product_state -> 'assets', '[]'::jsonb)) item
      where nullif(item ->> 'id', '')::uuid = current_row.id
    );

  insert into public.product_assets (
    id,
    product_id,
    kind,
    bucket,
    path,
    filename,
    content_type,
    size_bytes,
    locale,
    title,
    sort_order,
    is_public,
    is_active
  )
  select
    coalesce(nullif(item ->> 'id', '')::uuid, gen_random_uuid()),
    requested_product_id,
    item ->> 'kind',
    item ->> 'bucket',
    item ->> 'path',
    item ->> 'filename',
    item ->> 'contentType',
    nullif(item ->> 'sizeBytes', '')::bigint,
    nullif(item ->> 'locale', ''),
    nullif(item ->> 'title', ''),
    coalesce(nullif(item ->> 'sortOrder', '')::integer, 100),
    (item ->> 'kind') <> 'premium_download',
    true
  from jsonb_array_elements(coalesce(product_state -> 'assets', '[]'::jsonb)) item
  on conflict (id) do update
    set product_id = excluded.product_id,
        kind = excluded.kind,
        bucket = excluded.bucket,
        path = excluded.path,
        filename = excluded.filename,
        content_type = excluded.content_type,
        size_bytes = excluded.size_bytes,
        locale = excluded.locale,
        title = excluded.title,
        sort_order = excluded.sort_order,
        is_public = excluded.is_public,
        is_active = true;

  if requested_cover_asset_id is not null and not exists (
    select 1
    from public.product_assets
    where id = requested_cover_asset_id
      and product_id = requested_product_id
      and kind = 'cover'
      and is_active
  ) then
    raise exception using
      errcode = '23503',
      message = 'Cover asset does not belong to the active product asset set.';
  end if;

  if requested_video_asset_id is not null and not exists (
    select 1
    from public.product_assets
    where id = requested_video_asset_id
      and product_id = requested_product_id
      and kind = 'video'
      and is_active
  ) then
    raise exception using
      errcode = '23503',
      message = 'Video asset does not belong to the active product asset set.';
  end if;

  update public.products
  set cover_asset_id = requested_cover_asset_id,
      video_asset_id = requested_video_asset_id
  where id = requested_product_id;

  return jsonb_build_object('status', 'success', 'product_id', requested_product_id);
end;
$$;

create or replace function public.save_product(product_state jsonb)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$
  select private.save_product(product_state);
$$;

revoke all on function private.save_product(jsonb) from public;
grant execute on function private.save_product(jsonb) to authenticated;
revoke all on function public.save_product(jsonb) from public;
grant execute on function public.save_product(jsonb) to authenticated;

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
  if current_user_id is null then
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

create or replace function public.record_download_event(requested_asset_id uuid)
returns uuid
language sql
security invoker
set search_path = public, pg_temp
as $$
  select private.record_download_event(requested_asset_id);
$$;

revoke all on function private.record_download_event(uuid) from public;
grant execute on function private.record_download_event(uuid) to authenticated;
revoke all on function public.record_download_event(uuid) from public;
grant execute on function public.record_download_event(uuid) to authenticated;

-- Keep the pre-existing redemption implementation private as well. The public
-- wrapper is the only RPC surface intended for authenticated callers.
revoke all on function private.redeem_premium_code(uuid, text) from public;
grant execute on function private.redeem_premium_code(uuid, text) to authenticated;
revoke all on function public.redeem_premium_code(uuid, text) from public;
grant execute on function public.redeem_premium_code(uuid, text) to authenticated;
