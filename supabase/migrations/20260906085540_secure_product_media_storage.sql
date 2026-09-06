-- Uploaded public media is authorized by the application route before a short-lived
-- signed URL is issued. Keep the buckets private so direct object URLs cannot bypass
-- published/active/public checks.
-- Hosted Supabase projects do not read the local storage.buckets config, so
-- provision the buckets explicitly when this migration is applied remotely.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'public-media',
    'public-media',
    false,
    20 * 1024 * 1024,
    array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']::text[]
  ),
  (
    'public-videos',
    'public-videos',
    false,
    50 * 1024 * 1024,
    array['video/mp4', 'video/webm']::text[]
  ),
  (
    'premium-files',
    'premium-files',
    false,
    50 * 1024 * 1024,
    array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']::text[]
  )
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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
