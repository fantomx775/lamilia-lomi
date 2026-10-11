alter table public.catalog_settings
  add column about_intro text not null default '',
  add column favorite_coloring_book_ids text[] not null default array['', '', '']::text[],
  add column favorite_picture_book_ids text[] not null default array['', '', '']::text[],
  add constraint catalog_settings_favorite_coloring_book_ids_length_check
    check (cardinality(favorite_coloring_book_ids) = 3),
  add constraint catalog_settings_favorite_picture_book_ids_length_check
    check (cardinality(favorite_picture_book_ids) = 3);
