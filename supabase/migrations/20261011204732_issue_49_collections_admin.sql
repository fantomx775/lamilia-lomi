-- Add admin-only collections and a private image bucket. Existing products stay
-- unassigned; collection deletion preserves products through ON DELETE SET NULL.
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  slug text not null unique check (length(btrim(slug)) > 0),
  image_path text unique,
  image_storage_provider text check (image_storage_provider in ('supabase', 'r2')),
  image_filename text,
  image_content_type text check (image_content_type in ('image/png', 'image/jpeg', 'image/webp')),
  image_size_bytes bigint check (image_size_bytes > 0),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_image_metadata_check check (
    (image_path is null and image_storage_provider is null and image_filename is null and image_content_type is null and image_size_bytes is null)
    or
    (image_path is not null and image_storage_provider is not null and image_filename is not null and image_content_type is not null and image_size_bytes is not null)
  ),
  constraint collections_image_path_check check (
    image_path is null or image_path ~* (
      '^collections/' || id::text || '/image/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[a-z0-9_-]+[.](png|jpe?g|webp)$'
    )
  )
);

create unique index collections_name_normalized_key
  on public.collections (lower(btrim(name)));

alter table public.products
  add column collection_id uuid references public.collections(id) on delete set null;

create index products_collection_id_idx on public.products (collection_id);
alter table public.collections enable row level security;
revoke all on public.collections from anon, authenticated;
grant select, insert, update, delete on public.collections to authenticated;
create policy collections_admin_all
  on public.collections for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'collection-media',
  'collection-media',
  false,
  20 * 1024 * 1024,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- The collection-media bucket is private. Application routes authorize admins
-- before using the service role to upload or issue short-lived image URLs.
create policy admins_manage_collection_images
  on storage.objects for all to authenticated
  using (bucket_id = 'collection-media' and (select private.is_admin()))
  with check (bucket_id = 'collection-media' and (select private.is_admin()));
create or replace function private.save_product(product_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_product_id uuid := nullif(product_state ->> 'id', '')::uuid;
  requested_collection_id uuid := nullif(product_state ->> 'collectionId', '')::uuid;
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

  if requested_collection_id is not null and not exists (
    select 1 from public.collections where id = requested_collection_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Collection does not exist.';
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
    collection_id,
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
    requested_collection_id,
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
        collection_id = case
          when product_state ? 'collectionId' then excluded.collection_id
          else products.collection_id
        end,
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
revoke all on function private.save_product(jsonb) from public;
grant execute on function private.save_product(jsonb) to authenticated;
