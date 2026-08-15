-- Deterministic local/demo import for the current LamiliaLomi content.
-- It is run by `supabase db reset`, never by a request handler.

insert into public.categories (id, slug, sort_order) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'coloring-books', 1),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'picture-books', 2),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'mindfulness', 3)
on conflict (id) do update set slug = excluded.slug, sort_order = excluded.sort_order;

insert into public.category_translations (category_id, locale, name, description) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'en', 'Coloring books', 'Gentle coloring books for creative pauses.'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pl', 'Kolorowanki', 'Spokojne kolorowanki na kreatywne chwile.'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'en', 'Picture books', null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'pl', 'Książki obrazkowe', null),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'en', 'Mindfulness', null),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'pl', 'Uważność', null)
on conflict (category_id, locale) do update
set name = excluded.name, description = excluded.description;

insert into public.tags (id, slug) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'printable-bonus'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'amazon-kdp'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'calm-evening')
on conflict (id) do update set slug = excluded.slug;

insert into public.tag_translations (tag_id, locale, name) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'en', 'Printable bonus'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'pl', 'Bonus do druku'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'en', 'Amazon KDP'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'pl', 'Amazon KDP'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'en', 'Calm evening'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'pl', 'Spokojny wieczór')
on conflict (tag_id, locale) do update set name = excluded.name;

insert into public.products (id, slug, status, audience, product_type, review_delay_days, sort_order) values
  ('11111111-1111-4111-8111-111111111111', 'moon-garden-coloring-book', 'published', 'kids', 'coloring-book', 14, 1),
  ('22222222-2222-4222-8222-222222222222', 'mindful-mandalas-for-adults', 'published', 'adults', 'coloring-book', 21, 2),
  ('33333333-3333-4333-8333-333333333333', 'bedtime-forest-picture-book', 'published', 'kids', 'picture-book', 14, 3),
  ('44444444-4444-4444-8444-444444444444', 'secret-draft-product', 'draft', 'adults', 'audiobook', 14, 99)
on conflict (id) do update set
  slug = excluded.slug,
  status = excluded.status,
  audience = excluded.audience,
  product_type = excluded.product_type,
  review_delay_days = excluded.review_delay_days,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.product_translations (product_id, locale, title, short_description, long_description, seo_title, seo_description) values
  ('11111111-1111-4111-8111-111111111111', 'en', 'Moon Garden Coloring Book', 'A gentle nighttime coloring book for young dreamers and quiet family evenings.', 'Moon Garden invites children into a soft world of stars, little houses, sleepy flowers, and friendly night skies. The physical book unlocks premium printable pages and a calm bonus PDF for returning families.', 'Moon Garden Coloring Book by LamiliaLomi', 'Browse Moon Garden, a calm kids coloring book with printable premium bonuses unlocked by QR code.'),
  ('11111111-1111-4111-8111-111111111111', 'pl', 'Księżycowy Ogród. Kolorowanka', 'Delikatna nocna kolorowanka dla dzieci i spokojnych rodzinnych wieczorów.', 'Księżycowy Ogród prowadzi dzieci przez świat gwiazd, małych domków, sennych kwiatów i łagodnego nieba. Książka papierowa odblokowuje dodatkowe strony do druku oraz bonusowy PDF.', 'Księżycowy Ogród LamiliaLomi', 'Sprawdź spokojną kolorowankę dla dzieci z materiałami premium odblokowywanymi kodem QR.'),
  ('22222222-2222-4222-8222-222222222222', 'en', 'Mindful Mandalas for Adults', 'A slower coloring ritual for grown-ups who want a beautiful pause.', 'A premium-feeling adult coloring book with flowing mandalas, journaling prompts, and soft visual rhythm. Designed for calm evenings, gifting, and screen-free focus.', null, null),
  ('22222222-2222-4222-8222-222222222222', 'pl', 'Mandale uważności dla dorosłych', 'Spokojny rytuał kolorowania dla dorosłych, którzy potrzebują pięknej przerwy.', 'Pełna spokoju kolorowanka dla dorosłych z mandalami, pytaniami do dziennika i łagodnym rytmem wizualnym.', null, null),
  ('33333333-3333-4333-8333-333333333333', 'en', 'Bedtime Forest Picture Book', 'A soft illustrated story for children who like gentle bedtime worlds.', 'Bedtime Forest is a quiet picture story with woodland paths, moonlit windows, and a friendly rhythm for nightly reading.', null, null),
  ('33333333-3333-4333-8333-333333333333', 'pl', 'Dobranoc, Leśny Świecie', 'Łagodna ilustrowana opowieść dla dzieci lubiących spokojne wieczory.', 'Dobranoc, Leśny Świecie to cicha opowieść obrazkowa z leśnymi ścieżkami, światłem w oknach i rytmem dobrym do wieczornego czytania.', null, null),
  ('44444444-4444-4444-8444-444444444444', 'en', 'Secret Draft Product', 'Not public.', 'This seed exists to prove draft products stay hidden.', null, null)
on conflict (product_id, locale) do update set
  title = excluded.title,
  short_description = excluded.short_description,
  long_description = excluded.long_description,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description;

insert into public.product_assets (id, product_id, kind, bucket, path, filename, content_type, size_bytes, title, sort_order, is_public) values
  ('11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', 'cover', 'public-media', 'assets/covers/moon-garden.svg', 'moon-garden.svg', 'image/svg+xml', 72000, 'Moon Garden cover', 1, true),
  ('11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111', 'gallery', 'public-media', 'assets/gallery/moon-garden-page-1.svg', 'moon-garden-page-1.svg', 'image/svg+xml', 72000, 'Stars and little houses', 1, true),
  ('11111111-1111-4111-8111-111111111103', '11111111-1111-4111-8111-111111111111', 'gallery', 'public-media', 'assets/gallery/moon-garden-page-2.svg', 'moon-garden-page-2.svg', 'image/svg+xml', 72000, 'Sleepy flower page', 2, true),
  ('11111111-1111-4111-8111-111111111104', '11111111-1111-4111-8111-111111111111', 'video', 'public-videos', 'assets/video/flipthrough-placeholder.svg', 'flipthrough-placeholder.svg', 'image/svg+xml', 72000, 'Flipthrough preview', 1, true),
  ('11111111-1111-4111-8111-111111111105', '11111111-1111-4111-8111-111111111111', 'premium_download', 'premium-files', 'moon-garden/bonus.pdf', 'moon-garden-bonus.pdf', 'application/pdf', 72000, 'Premium printable PDF', 1, false),
  ('22222222-2222-4222-8222-222222222201', '22222222-2222-4222-8222-222222222222', 'cover', 'public-media', 'assets/covers/mindful-mandalas.svg', 'mindful-mandalas.svg', 'image/svg+xml', 72000, 'Mindful Mandalas cover', 1, true),
  ('22222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222222', 'gallery', 'public-media', 'assets/gallery/mandala-page-1.svg', 'mandala-page-1.svg', 'image/svg+xml', 72000, 'Mandala interior', 1, true),
  ('33333333-3333-4333-8333-333333333301', '33333333-3333-4333-8333-333333333333', 'cover', 'public-media', 'assets/covers/bedtime-forest.svg', 'bedtime-forest.svg', 'image/svg+xml', 72000, 'Bedtime Forest cover', 1, true),
  ('44444444-4444-4444-8444-444444444401', '44444444-4444-4444-8444-444444444444', 'cover', 'public-media', 'assets/covers/mindful-mandalas.svg', 'mindful-mandalas.svg', 'image/svg+xml', 72000, 'Draft cover', 1, true)
on conflict (id) do update set
  product_id = excluded.product_id,
  kind = excluded.kind,
  bucket = excluded.bucket,
  path = excluded.path,
  filename = excluded.filename,
  content_type = excluded.content_type,
  size_bytes = excluded.size_bytes,
  title = excluded.title,
  sort_order = excluded.sort_order,
  is_public = excluded.is_public;

update public.products set cover_asset_id = '11111111-1111-4111-8111-111111111101', video_asset_id = '11111111-1111-4111-8111-111111111104' where id = '11111111-1111-4111-8111-111111111111';
update public.products set cover_asset_id = '22222222-2222-4222-8222-222222222201', video_asset_id = null where id = '22222222-2222-4222-8222-222222222222';
update public.products set cover_asset_id = '33333333-3333-4333-8333-333333333301', video_asset_id = null where id = '33333333-3333-4333-8333-333333333333';
update public.products set cover_asset_id = '44444444-4444-4444-8444-444444444401', video_asset_id = null where id = '44444444-4444-4444-8444-444444444444';

insert into public.product_categories (product_id, category_id) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('22222222-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('33333333-3333-4333-8333-333333333333', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('44444444-4444-4444-8444-444444444444', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
on conflict do nothing;

insert into public.product_tags (product_id, tag_id) values
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  ('11111111-1111-4111-8111-111111111111', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
  ('22222222-2222-4222-8222-222222222222', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  ('22222222-2222-4222-8222-222222222222', 'ffffffff-ffff-4fff-8fff-ffffffffffff'),
  ('33333333-3333-4333-8333-333333333333', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
on conflict do nothing;

insert into public.amazon_links (id, product_id, market, url, is_primary) values
  ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'amazon.com', 'https://www.amazon.com/dp/B0LAMIALOMI?tag=lamilialomi-20', true),
  ('11111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', 'amazon.de', 'https://www.amazon.de/dp/B0LAMIALOMI?tag=lamilialomi-21', false),
  ('22222222-2222-4222-8222-222222222201', '22222222-2222-4222-8222-222222222222', 'amazon.com', 'https://www.amazon.com/dp/B0LAMIALOMI?tag=lamilialomi-20', true),
  ('33333333-3333-4333-8333-333333333301', '33333333-3333-4333-8333-333333333333', 'amazon.com', 'https://www.amazon.com/dp/B0LAMIALOMI?tag=lamilialomi-20', true)
on conflict (id) do update set
  product_id = excluded.product_id,
  market = excluded.market,
  url = excluded.url,
  is_primary = excluded.is_primary;

insert into public.premium_codes (id, product_id, code, active) values
  ('99999999-9999-4999-8999-999999999991', '11111111-1111-4111-8111-111111111111', 'LOMI-BOOK-2026', true),
  ('99999999-9999-4999-8999-999999999992', '22222222-2222-4222-8222-222222222222', 'LOMI-CALM-2026', true),
  ('99999999-9999-4999-8999-999999999993', '33333333-3333-4333-8333-333333333333', 'LOMI-FOREST-2026', true)
on conflict (id) do update set
  product_id = excluded.product_id,
  code = excluded.code,
  active = excluded.active;

insert into public.static_pages (slug, locale, title, body) values
  ('privacy', 'en', 'Privacy Policy', 'Replace with final owner-approved policy before production.'),
  ('privacy', 'de', 'Datenschutzerklaerung', 'Replace with final owner-approved German policy before production.'),
  ('privacy', 'es', 'Politica de privacidad', 'Replace with final owner-approved Spanish policy before production.'),
  ('privacy', 'pl', 'Polityka prywatności', 'Zastąp finalną polityką przed produkcją.'),
  ('terms', 'en', 'Terms', 'Replace with final owner-approved terms before production.'),
  ('terms', 'de', 'Nutzungsbedingungen', 'Replace with final owner-approved German terms before production.'),
  ('terms', 'es', 'Terminos', 'Replace with final owner-approved Spanish terms before production.'),
  ('terms', 'pl', 'Regulamin', 'Zastąp finalnym regulaminem przed produkcją.')
on conflict (slug, locale) do update set title = excluded.title, body = excluded.body, updated_at = now();
