-- Keep the Storage read policy and product-asset bucket contract aligned with
-- the private buckets provisioned by secure_product_media_storage.
drop policy if exists "public media objects are readable" on storage.objects;

alter table public.product_assets
  drop constraint if exists product_assets_visibility_check;

alter table public.product_assets
  add constraint product_assets_visibility_check
  check (
    (
      kind = 'premium_download'
      and is_public = false
      and bucket = 'premium-files'
    )
    or (
      kind in ('cover', 'gallery', 'public_download')
      and is_public = true
      and bucket = 'public-media'
    )
    or (
      kind = 'video'
      and is_public = true
      and bucket = 'public-videos'
    )
  );
