create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  marketing_consent boolean not null default false,
  terms_accepted_at timestamptz,
  preferred_locale text not null default 'en' check (preferred_locale in ('en', 'pl', 'de', 'es')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  audience text not null check (audience in ('kids', 'adults')),
  product_type text not null,
  cover_asset_id uuid,
  video_asset_id uuid,
  review_delay_days integer not null default 14 check (review_delay_days > 0),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_translations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  locale text not null check (locale in ('en', 'pl', 'de', 'es')),
  title text not null,
  short_description text not null,
  long_description text not null,
  seo_title text,
  seo_description text,
  unique (product_id, locale)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create table public.category_translations (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  locale text not null check (locale in ('en', 'pl', 'de', 'es')),
  name text not null,
  description text,
  unique (category_id, locale)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.tag_translations (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.tags(id) on delete cascade,
  locale text not null check (locale in ('en', 'pl', 'de', 'es')),
  name text not null,
  unique (tag_id, locale)
);

create table public.product_categories (
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (product_id, category_id)
);

create table public.product_tags (
  product_id uuid not null references public.products(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (product_id, tag_id)
);

create table public.product_assets (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  kind text not null check (kind in ('cover', 'gallery', 'video', 'public_download', 'premium_download')),
  bucket text not null,
  path text not null,
  filename text not null,
  content_type text not null,
  size_bytes bigint,
  locale text check (locale in ('en', 'pl', 'de', 'es')),
  title text,
  sort_order integer not null default 100,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.products
  add constraint products_cover_asset_fk foreign key (cover_asset_id) references public.product_assets(id) deferrable initially deferred,
  add constraint products_video_asset_fk foreign key (video_asset_id) references public.product_assets(id) deferrable initially deferred;

create table public.amazon_links (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  market text not null,
  url text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.premium_codes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  code text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_product_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  premium_code_id uuid references public.premium_codes(id),
  unlocked_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create table public.download_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  asset_id uuid not null references public.product_assets(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.review_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  sent_at timestamptz,
  last_error text,
  unique (user_id, product_id)
);

create table public.static_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  locale text not null check (locale in ('en', 'pl', 'de', 'es')),
  title text not null,
  body text not null,
  updated_at timestamptz not null default now(),
  unique (slug, locale)
);

create or replace function private.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    role,
    marketing_consent,
    terms_accepted_at,
    preferred_locale
  )
  values (
    new.id,
    new.email,
    case when new.email = current_setting('app.admin_seed_email', true) then 'admin' else 'user' end,
    coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false),
    now(),
    coalesce(new.raw_user_meta_data ->> 'preferred_locale', 'en')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

grant execute on function private.is_admin() to anon, authenticated, service_role;
grant execute on function private.handle_new_user() to service_role;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create index products_public_idx on public.products (status, audience, sort_order);
create index product_translations_search_idx on public.product_translations using gin (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(short_description, '') || ' ' || coalesce(long_description, ''))
);
create index product_assets_product_kind_idx on public.product_assets (product_id, kind);
create index unlocks_user_product_idx on public.user_product_unlocks (user_id, product_id);
create index reminders_due_idx on public.review_reminders (status, scheduled_for);

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_translations enable row level security;
alter table public.categories enable row level security;
alter table public.category_translations enable row level security;
alter table public.tags enable row level security;
alter table public.tag_translations enable row level security;
alter table public.product_categories enable row level security;
alter table public.product_tags enable row level security;
alter table public.product_assets enable row level security;
alter table public.amazon_links enable row level security;
alter table public.premium_codes enable row level security;
alter table public.user_product_unlocks enable row level security;
alter table public.download_events enable row level security;
alter table public.review_reminders enable row level security;
alter table public.static_pages enable row level security;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or private.is_admin());

create policy "profiles_update_own_or_admin"
  on public.profiles for update
  using (id = auth.uid() or private.is_admin())
  with check (id = auth.uid() or private.is_admin());

create policy "products_public_published_select"
  on public.products for select
  using (status = 'published' or private.is_admin());

create policy "products_admin_all"
  on public.products for all
  using (private.is_admin())
  with check (private.is_admin());

create policy "product_translations_public_published_select"
  on public.product_translations for select
  using (
    exists (
      select 1 from public.products p
      where p.id = product_id and (p.status = 'published' or private.is_admin())
    )
  );

create policy "product_translations_admin_all"
  on public.product_translations for all
  using (private.is_admin())
  with check (private.is_admin());

create policy "taxonomy_public_select"
  on public.categories for select
  using (true);

create policy "category_translations_public_select"
  on public.category_translations for select
  using (true);

create policy "tags_public_select"
  on public.tags for select
  using (true);

create policy "tag_translations_public_select"
  on public.tag_translations for select
  using (true);

create policy "taxonomy_admin_all_categories"
  on public.categories for all
  using (private.is_admin())
  with check (private.is_admin());

create policy "taxonomy_admin_all_category_translations"
  on public.category_translations for all
  using (private.is_admin())
  with check (private.is_admin());

create policy "taxonomy_admin_all_tags"
  on public.tags for all
  using (private.is_admin())
  with check (private.is_admin());

create policy "taxonomy_admin_all_tag_translations"
  on public.tag_translations for all
  using (private.is_admin())
  with check (private.is_admin());

create policy "product_categories_public_published_select"
  on public.product_categories for select
  using (
    exists (
      select 1 from public.products p
      where p.id = product_id and (p.status = 'published' or private.is_admin())
    )
  );

create policy "product_tags_public_published_select"
  on public.product_tags for select
  using (
    exists (
      select 1 from public.products p
      where p.id = product_id and (p.status = 'published' or private.is_admin())
    )
  );

create policy "product_join_admin_all_categories"
  on public.product_categories for all
  using (private.is_admin())
  with check (private.is_admin());

create policy "product_join_admin_all_tags"
  on public.product_tags for all
  using (private.is_admin())
  with check (private.is_admin());

create policy "assets_public_metadata_select"
  on public.product_assets for select
  using (
    is_public = true
    or private.is_admin()
    or (
      kind = 'premium_download'
      and auth.uid() is not null
      and exists (
        select 1 from public.user_product_unlocks u
        where u.product_id = product_assets.product_id
          and u.user_id = auth.uid()
      )
    )
  );

create policy "assets_admin_all"
  on public.product_assets for all
  using (private.is_admin())
  with check (private.is_admin());

create policy "amazon_links_public_published_select"
  on public.amazon_links for select
  using (
    exists (
      select 1 from public.products p
      where p.id = product_id and (p.status = 'published' or private.is_admin())
    )
  );

create policy "amazon_links_admin_all"
  on public.amazon_links for all
  using (private.is_admin())
  with check (private.is_admin());

create policy "premium_codes_admin_select"
  on public.premium_codes for select
  using (private.is_admin());

create policy "premium_codes_admin_all"
  on public.premium_codes for all
  using (private.is_admin())
  with check (private.is_admin());

create policy "unlocks_select_own_or_admin"
  on public.user_product_unlocks for select
  using (user_id = auth.uid() or private.is_admin());

create policy "unlocks_insert_own"
  on public.user_product_unlocks for insert
  with check (user_id = auth.uid());

create policy "download_events_select_own_or_admin"
  on public.download_events for select
  using (user_id = auth.uid() or private.is_admin());

create policy "download_events_insert_own"
  on public.download_events for insert
  with check (user_id = auth.uid());

create policy "review_reminders_select_own_or_admin"
  on public.review_reminders for select
  using (user_id = auth.uid() or private.is_admin());

create policy "review_reminders_admin_all"
  on public.review_reminders for all
  using (private.is_admin())
  with check (private.is_admin());

create policy "static_pages_public_select"
  on public.static_pages for select
  using (true);

create policy "static_pages_admin_all"
  on public.static_pages for all
  using (private.is_admin())
  with check (private.is_admin());

insert into public.categories (id, slug, sort_order)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'coloring-books', 1),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'picture-books', 2),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'mindfulness', 3)
on conflict (id) do nothing;

insert into public.category_translations (category_id, locale, name, description)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'en', 'Coloring books', 'Gentle coloring books for creative pauses.'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pl', 'Kolorowanki', 'Spokojne kolorowanki na kreatywne chwile.'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'en', 'Picture books', null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'pl', 'Książki obrazkowe', null),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'en', 'Mindfulness', null),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'pl', 'Uważność', null)
on conflict (category_id, locale) do nothing;

insert into public.tags (id, slug)
values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'printable-bonus'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'amazon-kdp'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'calm-evening')
on conflict (id) do nothing;

insert into public.tag_translations (tag_id, locale, name)
values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'en', 'Printable bonus'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'pl', 'Bonus do druku'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'en', 'Amazon KDP'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'pl', 'Amazon KDP'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'en', 'Calm evening'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'pl', 'Spokojny wieczór')
on conflict (tag_id, locale) do nothing;

insert into public.products (
  id,
  slug,
  status,
  audience,
  product_type,
  review_delay_days,
  sort_order
)
values
  ('11111111-1111-4111-8111-111111111111', 'moon-garden-coloring-book', 'published', 'kids', 'coloring-book', 14, 1),
  ('22222222-2222-4222-8222-222222222222', 'mindful-mandalas-for-adults', 'published', 'adults', 'coloring-book', 21, 2)
on conflict (id) do nothing;

insert into public.product_translations (
  product_id,
  locale,
  title,
  short_description,
  long_description,
  seo_title,
  seo_description
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'en',
    'Moon Garden Coloring Book',
    'A gentle nighttime coloring book for young dreamers and quiet family evenings.',
    'Moon Garden invites children into a soft world of stars, little houses, sleepy flowers, and friendly night skies.',
    'Moon Garden Coloring Book by LamiliaLomi',
    'Browse Moon Garden, a calm kids coloring book with printable premium bonuses unlocked by QR code.'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'pl',
    'Księżycowy Ogród. Kolorowanka',
    'Delikatna nocna kolorowanka dla dzieci i spokojnych rodzinnych wieczorów.',
    'Księżycowy Ogród prowadzi dzieci przez świat gwiazd, małych domków, sennych kwiatów i łagodnego nieba.',
    'Księżycowy Ogród LamiliaLomi',
    'Sprawdź spokojną kolorowankę dla dzieci z materiałami premium odblokowywanymi kodem QR.'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'en',
    'Mindful Mandalas for Adults',
    'A slower coloring ritual for grown-ups who want a beautiful pause.',
    'A premium-feeling adult coloring book with flowing mandalas, journaling prompts, and soft visual rhythm.',
    null,
    null
  )
on conflict (product_id, locale) do nothing;

insert into public.product_categories (product_id, category_id)
values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('22222222-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
on conflict do nothing;

insert into public.product_tags (product_id, tag_id)
values
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  ('11111111-1111-4111-8111-111111111111', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
  ('22222222-2222-4222-8222-222222222222', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  ('22222222-2222-4222-8222-222222222222', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
on conflict do nothing;

insert into public.premium_codes (id, product_id, code, active)
values
  ('99999999-9999-4999-8999-999999999991', '11111111-1111-4111-8111-111111111111', 'LOMI-BOOK-2026', true),
  ('99999999-9999-4999-8999-999999999992', '22222222-2222-4222-8222-222222222222', 'LOMI-CALM-2026', true)
on conflict (id) do nothing;

insert into public.static_pages (slug, locale, title, body)
values
  ('privacy', 'en', 'Privacy Policy', 'Replace with final owner-approved policy before production.'),
  ('privacy', 'de', 'Datenschutzerklaerung', 'Replace with final owner-approved German policy before production.'),
  ('privacy', 'es', 'Politica de privacidad', 'Replace with final owner-approved Spanish policy before production.'),
  ('privacy', 'pl', 'Polityka prywatności', 'Zastąp finalną polityką przed produkcją.'),
  ('terms', 'en', 'Terms', 'Replace with final owner-approved terms before production.'),
  ('terms', 'de', 'Nutzungsbedingungen', 'Replace with final owner-approved German terms before production.'),
  ('terms', 'es', 'Terminos', 'Replace with final owner-approved Spanish terms before production.'),
  ('terms', 'pl', 'Regulamin', 'Zastąp finalnym regulaminem przed produkcją.')
on conflict (slug, locale) do nothing;
