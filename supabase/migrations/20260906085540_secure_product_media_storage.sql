-- Uploaded public media is authorized by the application route before a short-lived
-- signed URL is issued. Keep the buckets private so direct object URLs cannot bypass
-- published/active/public checks.
update storage.buckets
set
  public = false,
  file_size_limit = case id when 'public-media' then 20 * 1024 * 1024 else 50 * 1024 * 1024 end,
  allowed_mime_types = case id
    when 'public-media' then array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']::text[]
    else array['video/mp4', 'video/webm']::text[]
  end
where id in ('public-media', 'public-videos');

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
