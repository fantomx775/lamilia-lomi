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
-- Wrap the existing Issue 31 serializer so collection assignment does not replace its batch-merge behavior.
alter function private.save_product(jsonb)
  rename to save_product_with_premium_code_batch_merge;

revoke all on function private.save_product_with_premium_code_batch_merge(jsonb) from public;
revoke all on function private.save_product_with_premium_code_batch_merge(jsonb) from anon;
revoke all on function private.save_product_with_premium_code_batch_merge(jsonb) from authenticated;

create function private.save_product(product_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_product_id uuid := nullif(product_state ->> 'id', '')::uuid;
  requested_collection_id uuid := nullif(product_state ->> 'collectionId', '')::uuid;
  has_collection_assignment boolean := product_state ? 'collectionId';
  saved_product jsonb;
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

  saved_product := private.save_product_with_premium_code_batch_merge(product_state - 'collectionId');

  if has_collection_assignment then
    update public.products
    set collection_id = requested_collection_id
    where id = requested_product_id;
  end if;

  return saved_product;
end;
$$;

revoke all on function private.save_product(jsonb) from public;
revoke all on function private.save_product(jsonb) from anon;
grant execute on function private.save_product(jsonb) to authenticated;
