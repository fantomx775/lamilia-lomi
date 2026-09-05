-- Keep tag translations consistent with category translations and the admin editor.
alter table public.tag_translations
  add column if not exists description text;
