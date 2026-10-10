alter table public.categories
  add column image_asset_id uuid,
  add column image_storage_path text,
  add column image_storage_provider text,
  add column image_filename text,
  add column image_content_type text,
  add column image_size_bytes bigint,
  add constraint categories_image_storage_provider_check
    check (image_storage_provider is null or image_storage_provider in ('supabase', 'r2_public')),
  add constraint categories_image_size_check
    check (image_size_bytes is null or image_size_bytes > 0),
  add constraint categories_image_metadata_check
    check (
      (image_asset_id is null and image_storage_path is null and image_storage_provider is null
        and image_filename is null and image_content_type is null and image_size_bytes is null)
      or
      (image_asset_id is not null and image_storage_path is not null and image_storage_path <> ''
        and image_storage_provider is not null and image_filename is not null and image_filename <> ''
        and image_content_type is not null and image_content_type in ('image/png', 'image/jpeg', 'image/webp')
        and image_size_bytes is not null)
    );
