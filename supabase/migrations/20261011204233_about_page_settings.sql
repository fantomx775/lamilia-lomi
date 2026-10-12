create function private.about_product_ids_are_unique(
  coloring_book_ids text[],
  picture_book_ids text[]
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select not exists (
    select selected.product_id
    from pg_catalog.unnest(
      pg_catalog.array_cat(coloring_book_ids, picture_book_ids)
    ) as selected(product_id)
    group by selected.product_id
    having selected.product_id is null
      or (selected.product_id <> '' and pg_catalog.count(*) > 1)
  );
$$;

revoke all on function private.about_product_ids_are_unique(text[], text[])
  from public, anon;
grant execute on function private.about_product_ids_are_unique(text[], text[])
  to authenticated, service_role;

alter table public.catalog_settings
  add column about_intro text not null default '',
  add column favorite_coloring_book_ids text[] not null default array['', '', '']::text[],
  add column favorite_picture_book_ids text[] not null default array['', '', '']::text[],
  add constraint catalog_settings_favorite_coloring_book_ids_length_check
    check (array_ndims(favorite_coloring_book_ids) = 1 and cardinality(favorite_coloring_book_ids) = 3),
  add constraint catalog_settings_favorite_picture_book_ids_length_check
    check (array_ndims(favorite_picture_book_ids) = 1 and cardinality(favorite_picture_book_ids) = 3),
  add constraint catalog_settings_about_product_ids_unique_check
    check (
      private.about_product_ids_are_unique(
        favorite_coloring_book_ids,
        favorite_picture_book_ids
      )
    );
