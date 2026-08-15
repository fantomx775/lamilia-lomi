-- LamiliaLomi production foundation.
-- This migration is forward-only. It tightens the existing foundation without
-- rewriting 20260531093244_lamilialomi_foundation.sql.

create or replace function private.normalize_premium_code(input text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select upper(
    regexp_replace(
      replace(replace(btrim(input), chr(8211), '-'), chr(8212), '-'),
      E'\\s+',
      '',
      'g'
    )
  );
$$;

alter table public.premium_codes
  add column if not exists normalized_code text;

update public.premium_codes
set normalized_code = private.normalize_premium_code(code)
where normalized_code is null;

alter table public.premium_codes
  alter column normalized_code set not null;

create unique index if not exists premium_codes_normalized_code_key
  on public.premium_codes (normalized_code);

create or replace function private.sync_premium_code_normalized()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.normalized_code := private.normalize_premium_code(new.code);
  return new;
end;
$$;

drop trigger if exists premium_codes_normalize_code on public.premium_codes;
create trigger premium_codes_normalize_code
  before insert or update of code on public.premium_codes
  for each row execute function private.sync_premium_code_normalized();

create unique index if not exists amazon_links_one_primary_per_product_key
  on public.amazon_links (product_id)
  where is_primary;

create unique index if not exists product_assets_id_product_id_key
  on public.product_assets (id, product_id);

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
      kind <> 'premium_download'
      and is_public = true
    )
  );

alter table public.amazon_links
  drop constraint if exists amazon_links_market_check;

alter table public.amazon_links
  add constraint amazon_links_market_check
  check (market in ('amazon.com', 'amazon.de'));

alter table public.static_pages
  drop constraint if exists static_pages_slug_check;

alter table public.static_pages
  add constraint static_pages_slug_check
  check (slug in ('privacy', 'terms'));

alter table public.download_events
  drop constraint if exists download_events_asset_product_fkey;

alter table public.download_events
  add constraint download_events_asset_product_fkey
  foreign key (asset_id, product_id)
  references public.product_assets (id, product_id)
  on delete cascade;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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
    coalesce(new.email, ''),
    case when new.raw_app_meta_data ->> 'role' = 'admin' then 'admin' else 'user' end,
    coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false),
    case
      when coalesce((new.raw_user_meta_data ->> 'terms_accepted')::boolean, false)
        then now()
      else null
    end,
    case
      when new.raw_user_meta_data ->> 'preferred_locale' in ('en', 'pl', 'de', 'es')
        then new.raw_user_meta_data ->> 'preferred_locale'
      else 'en'
    end
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  return new;
end;
$$;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_update_own_or_admin" on public.profiles;
drop policy if exists "products_public_published_select" on public.products;
drop policy if exists "products_admin_all" on public.products;
drop policy if exists "product_translations_public_published_select" on public.product_translations;
drop policy if exists "product_translations_admin_all" on public.product_translations;
drop policy if exists "taxonomy_public_select" on public.categories;
drop policy if exists "category_translations_public_select" on public.category_translations;
drop policy if exists "tags_public_select" on public.tags;
drop policy if exists "tag_translations_public_select" on public.tag_translations;
drop policy if exists "taxonomy_admin_all_categories" on public.categories;
drop policy if exists "taxonomy_admin_all_category_translations" on public.category_translations;
drop policy if exists "taxonomy_admin_all_tags" on public.tags;
drop policy if exists "taxonomy_admin_all_tag_translations" on public.tag_translations;
drop policy if exists "product_categories_public_published_select" on public.product_categories;
drop policy if exists "product_tags_public_published_select" on public.product_tags;
drop policy if exists "product_join_admin_all_categories" on public.product_categories;
drop policy if exists "product_join_admin_all_tags" on public.product_tags;
drop policy if exists "assets_public_metadata_select" on public.product_assets;
drop policy if exists "assets_admin_all" on public.product_assets;
drop policy if exists "amazon_links_public_published_select" on public.amazon_links;
drop policy if exists "amazon_links_admin_all" on public.amazon_links;
drop policy if exists "premium_codes_admin_select" on public.premium_codes;
drop policy if exists "premium_codes_admin_all" on public.premium_codes;
drop policy if exists "unlocks_select_own_or_admin" on public.user_product_unlocks;
drop policy if exists "unlocks_insert_own" on public.user_product_unlocks;
drop policy if exists "download_events_select_own_or_admin" on public.download_events;
drop policy if exists "download_events_insert_own" on public.download_events;
drop policy if exists "review_reminders_select_own_or_admin" on public.review_reminders;
drop policy if exists "review_reminders_admin_all" on public.review_reminders;
drop policy if exists "static_pages_public_select" on public.static_pages;
drop policy if exists "static_pages_admin_all" on public.static_pages;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

create policy "products_public_published_select"
  on public.products for select
  to anon, authenticated
  using (status = 'published' or (select private.is_admin()));

create policy "products_admin_all"
  on public.products for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "product_translations_public_published_select"
  on public.product_translations for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_id
        and (p.status = 'published' or (select private.is_admin()))
    )
  );

create policy "product_translations_admin_all"
  on public.product_translations for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "taxonomy_public_select"
  on public.categories for select
  to anon, authenticated
  using (true);

create policy "category_translations_public_select"
  on public.category_translations for select
  to anon, authenticated
  using (true);

create policy "tags_public_select"
  on public.tags for select
  to anon, authenticated
  using (true);

create policy "tag_translations_public_select"
  on public.tag_translations for select
  to anon, authenticated
  using (true);

create policy "taxonomy_admin_all_categories"
  on public.categories for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "taxonomy_admin_all_category_translations"
  on public.category_translations for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "taxonomy_admin_all_tags"
  on public.tags for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "taxonomy_admin_all_tag_translations"
  on public.tag_translations for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "product_categories_public_published_select"
  on public.product_categories for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_id
        and (p.status = 'published' or (select private.is_admin()))
    )
  );

create policy "product_tags_public_published_select"
  on public.product_tags for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_id
        and (p.status = 'published' or (select private.is_admin()))
    )
  );

create policy "product_join_admin_all_categories"
  on public.product_categories for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "product_join_admin_all_tags"
  on public.product_tags for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "assets_public_metadata_select"
  on public.product_assets for select
  to anon, authenticated
  using (
    (
      is_public = true
      and exists (
        select 1 from public.products p
        where p.id = product_id and p.status = 'published'
      )
    )
    or (select private.is_admin())
    or (
      kind = 'premium_download'
      and is_public = false
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.user_product_unlocks u
        join public.products p on p.id = u.product_id
        where u.product_id = product_assets.product_id
          and u.user_id = (select auth.uid())
          and p.status = 'published'
      )
    )
  );

create policy "assets_admin_all"
  on public.product_assets for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "amazon_links_public_published_select"
  on public.amazon_links for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_id
        and (p.status = 'published' or (select private.is_admin()))
    )
  );

create policy "amazon_links_admin_all"
  on public.amazon_links for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "premium_codes_admin_select"
  on public.premium_codes for select
  to authenticated
  using ((select private.is_admin()));

create policy "premium_codes_admin_all"
  on public.premium_codes for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "unlocks_select_own"
  on public.user_product_unlocks for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "unlocks_select_admin"
  on public.user_product_unlocks for select
  to authenticated
  using ((select private.is_admin()));

create policy "download_events_select_own"
  on public.download_events for select
  to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy "review_reminders_select_own"
  on public.review_reminders for select
  to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy "review_reminders_admin_all"
  on public.review_reminders for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "static_pages_public_select"
  on public.static_pages for select
  to anon, authenticated
  using (true);

create policy "static_pages_admin_all"
  on public.static_pages for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on schema private from anon;
grant usage on schema private to anon, authenticated, service_role;
grant execute on function private.is_admin() to anon, authenticated, service_role;
grant execute on function private.normalize_premium_code(text) to authenticated, service_role;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
revoke all on public.premium_codes from anon;
revoke all on public.user_product_unlocks from anon, authenticated;
grant select on public.user_product_unlocks to authenticated;
revoke all on public.download_events from anon, authenticated;
grant select on public.download_events to authenticated;
revoke all on public.review_reminders from anon, authenticated;
grant select on public.review_reminders to authenticated;

grant usage on schema public to anon, authenticated;
grant select on
  public.products,
  public.product_translations,
  public.categories,
  public.category_translations,
  public.tags,
  public.tag_translations,
  public.product_categories,
  public.product_tags,
  public.product_assets,
  public.amazon_links,
  public.static_pages
to anon, authenticated;

grant insert, update, delete on
  public.products,
  public.product_translations,
  public.categories,
  public.category_translations,
  public.tags,
  public.tag_translations,
  public.product_categories,
  public.product_tags,
  public.product_assets,
  public.amazon_links,
  public.static_pages
to authenticated;

grant select, insert, update, delete on public.premium_codes to authenticated;

create or replace function private.redeem_premium_code(
  requested_product_id uuid,
  requested_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := (select auth.uid());
  matching_code public.premium_codes%rowtype;
  inserted_unlock_id uuid;
  normalized_requested_code text := private.normalize_premium_code(requested_code);
begin
  if current_user_id is null then
    return jsonb_build_object('status', 'auth_required');
  end if;

  if not exists (
    select 1
    from auth.users
    where id = current_user_id
      and email_confirmed_at is not null
  ) then
    return jsonb_build_object('status', 'email_unverified');
  end if;

  if normalized_requested_code is null or normalized_requested_code = '' then
    return jsonb_build_object('status', 'invalid_code');
  end if;

  select * into matching_code
  from public.premium_codes
  where normalized_code = normalized_requested_code;

  if not found then
    return jsonb_build_object('status', 'invalid_code');
  end if;

  if matching_code.product_id <> requested_product_id then
    return jsonb_build_object('status', 'wrong_product');
  end if;

  if not matching_code.active then
    return jsonb_build_object('status', 'inactive_code');
  end if;

  insert into public.user_product_unlocks (user_id, product_id, premium_code_id)
  values (current_user_id, requested_product_id, matching_code.id)
  on conflict (user_id, product_id) do nothing
  returning id into inserted_unlock_id;

  if inserted_unlock_id is null then
    return jsonb_build_object(
      'status', 'already_unlocked',
      'product_id', requested_product_id,
      'premium_code_id', matching_code.id
    );
  end if;

  return jsonb_build_object(
    'status', 'success',
    'product_id', requested_product_id,
    'premium_code_id', matching_code.id,
    'unlock_id', inserted_unlock_id
  );
end;
$$;

create or replace function public.redeem_premium_code(
  requested_product_id uuid,
  requested_code text
)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$
  select private.redeem_premium_code(requested_product_id, requested_code);
$$;

grant execute on function private.redeem_premium_code(uuid, text) to authenticated;
grant execute on function public.redeem_premium_code(uuid, text) to authenticated;
revoke execute on function public.redeem_premium_code(uuid, text) from anon;

create or replace function private.record_download_event(requested_asset_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := (select auth.uid());
  event_id uuid;
  asset_row public.product_assets%rowtype;
begin
  if current_user_id is null then
    return null;
  end if;

  select * into asset_row
  from public.product_assets
  where id = requested_asset_id
    and kind = 'premium_download'
    and exists (
      select 1
      from public.user_product_unlocks u
      where u.user_id = current_user_id
        and u.product_id = product_assets.product_id
    );

  if not found then
    return null;
  end if;

  insert into public.download_events (user_id, product_id, asset_id)
  values (current_user_id, asset_row.product_id, asset_row.id)
  returning id into event_id;

  return event_id;
end;
$$;

create or replace function public.record_download_event(requested_asset_id uuid)
returns uuid
language sql
security invoker
set search_path = public, pg_temp
as $$
  select private.record_download_event(requested_asset_id);
$$;

grant execute on function private.record_download_event(uuid) to authenticated;
grant execute on function public.record_download_event(uuid) to authenticated;
revoke execute on function public.record_download_event(uuid) from anon;

alter table storage.objects enable row level security;

drop policy if exists "public media objects are readable" on storage.objects;
drop policy if exists "premium objects are readable after unlock" on storage.objects;
drop policy if exists "admins manage LamiliaLomi objects" on storage.objects;

create policy "public media objects are readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id in ('public-media', 'public-videos'));

create policy "premium objects are readable after unlock"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'premium-files'
    and exists (
      select 1
      from public.product_assets a
      join public.user_product_unlocks u on u.product_id = a.product_id
      where a.bucket = bucket_id
        and a.path = name
        and a.kind = 'premium_download'
        and u.user_id = (select auth.uid())
    )
  );

create policy "admins manage LamiliaLomi objects"
  on storage.objects for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
