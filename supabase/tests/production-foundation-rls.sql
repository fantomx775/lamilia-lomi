\set ON_ERROR_STOP on

-- Run with psql against a disposable Supabase local database after migrations
-- and seed have been applied. This is intentionally not a production script.

delete from storage.objects
where bucket_id = 'premium-files'
  and name in ('moon-garden/bonus.pdf', 'mindful-mandalas/bonus.pdf');
delete from public.product_assets
where id = '22222222-2222-4222-8222-222222222205';
delete from public.premium_codes
where id in ('99999999-9999-4999-8999-999999999994', '99999999-9999-4999-8999-999999999995');
delete from auth.users
where id in ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb');

grant usage on schema auth, storage to anon, authenticated;
grant select on storage.objects to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'a@example.test', now(), '{}'::jsonb, '{}'::jsonb),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 'b@example.test', now(), '{}'::jsonb, '{}'::jsonb);

insert into public.premium_codes (id, product_id, code, active)
values
  ('99999999-9999-4999-8999-999999999994', '11111111-1111-4111-8111-111111111111', 'LOMI-INACTIVE-2026', false),
  ('99999999-9999-4999-8999-999999999995', '44444444-4444-4444-8444-444444444444', 'LOMI-DRAFT-2026', true);

insert into public.product_assets (
  id, product_id, kind, bucket, path, filename, content_type, is_public, sort_order
)
values (
  '22222222-2222-4222-8222-222222222205',
  '22222222-2222-4222-8222-222222222222',
  'premium_download',
  'premium-files',
  'mindful-mandalas/bonus.pdf',
  'mindful-bonus.pdf',
  'application/pdf',
  false,
  2
);

insert into storage.objects (bucket_id, name)
values
  ('premium-files', 'moon-garden/bonus.pdf'),
  ('premium-files', 'mindful-mandalas/bonus.pdf');

update public.profiles
set role = 'user'
where id in ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb');

\echo 'RLS matrix: public reads and authenticated isolation'
begin;
set local role anon;
select case when count(*) = 3 then 'PASS anon sees 3 published products' else 'FAIL anon published product count=' || count(*) end
from public.products where status = 'published';
select case when count(*) = 0 then 'PASS anon cannot see draft products' else 'FAIL anon draft visibility count=' || count(*) end
from public.products where status = 'draft';
select case when count(*) = 0 then 'PASS anon cannot see premium asset metadata' else 'FAIL anon premium asset count=' || count(*) end
from public.product_assets where kind = 'premium_download';
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
select case when count(*) = 1 then 'PASS user B sees own profile' else 'FAIL user B own profile count=' || count(*) end
from public.profiles where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
select case when count(*) = 0 then 'PASS user B cannot see user A profile' else 'FAIL user B cross-profile count=' || count(*) end
from public.profiles where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
select case when count(*) = 0 then 'PASS user B cannot see premium assets before unlock' else 'FAIL user B premium asset count=' || count(*) end
from public.product_assets where kind = 'premium_download';
select case when count(*) = 0 then 'PASS user B has no visible unlocks' else 'FAIL user B unlock count=' || count(*) end
from public.user_product_unlocks;
select case when count(*) = 0 then 'PASS user B cannot read premium storage before unlock' else 'FAIL user B premium storage count=' || count(*) end
from storage.objects where bucket_id = 'premium-files';
rollback;

\echo 'RLS matrix: atomic redemption and authorization contracts'
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
select case when (public.redeem_premium_code('11111111-1111-4111-8111-111111111111', ' lomi-book-2026 ') ->> 'status') = 'success' then 'PASS first redemption unlocks product' else 'FAIL first redemption=' || (public.redeem_premium_code('11111111-1111-4111-8111-111111111111', ' lomi-book-2026 '))::text end;
select case when (public.redeem_premium_code('11111111-1111-4111-8111-111111111111', 'LOMI-BOOK-2026') ->> 'status') = 'already_unlocked' then 'PASS duplicate redemption is idempotent' else 'FAIL duplicate redemption=' || (public.redeem_premium_code('11111111-1111-4111-8111-111111111111', 'LOMI-BOOK-2026'))::text end;
select case when (public.redeem_premium_code('22222222-2222-4222-8222-222222222222', 'LOMI-BOOK-2026') ->> 'status') = 'wrong_product' then 'PASS code is product-bound' else 'FAIL wrong product=' || (public.redeem_premium_code('22222222-2222-4222-8222-222222222222', 'LOMI-BOOK-2026'))::text end;
select case when (public.redeem_premium_code('11111111-1111-4111-8111-111111111111', 'LOMI-INACTIVE-2026') ->> 'status') = 'inactive_code' then 'PASS inactive code rejected' else 'FAIL inactive code=' || (public.redeem_premium_code('11111111-1111-4111-8111-111111111111', 'LOMI-INACTIVE-2026'))::text end;
select case when (public.redeem_premium_code('11111111-1111-4111-8111-111111111111', 'not-real') ->> 'status') = 'invalid_code' then 'PASS unknown code rejected' else 'FAIL unknown code=' || (public.redeem_premium_code('11111111-1111-4111-8111-111111111111', 'not-real'))::text end;
select case when count(*) = 1 then 'PASS exactly one unlock row exists' else 'FAIL unlock row count=' || count(*) end
from public.user_product_unlocks
where user_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  and product_id = '11111111-1111-4111-8111-111111111111';
select case when count(*) = 1 then 'PASS user A sees unlocked premium metadata' else 'FAIL user A premium metadata count=' || count(*) end
from public.product_assets
where product_id = '11111111-1111-4111-8111-111111111111' and kind = 'premium_download';
select case when count(*) = 1 then 'PASS user A sees unlocked premium object' else 'FAIL user A premium object count=' || count(*) end
from storage.objects where bucket_id = 'premium-files' and name = 'moon-garden/bonus.pdf';
select case when count(*) = 0 then 'PASS user A cannot see another product premium object' else 'FAIL user A cross-product object count=' || count(*) end
from storage.objects where bucket_id = 'premium-files' and name = 'mindful-mandalas/bonus.pdf';
select case when public.record_download_event('11111111-1111-4111-8111-111111111105') is not null then 'PASS unlocked download event recorded' else 'FAIL unlocked download event missing' end;
select case when public.record_download_event('22222222-2222-4222-8222-222222222205') is null then 'PASS locked download event rejected' else 'FAIL locked download event recorded' end;
select case when (public.redeem_premium_code('44444444-4444-4444-8444-444444444444', 'LOMI-DRAFT-2026') ->> 'status') = 'product_not_found' then 'PASS draft product cannot be unlocked' else 'FAIL draft product redemption=' || (public.redeem_premium_code('44444444-4444-4444-8444-444444444444', 'LOMI-DRAFT-2026'))::text end;
-- The fixture status transition is performed by the disposable harness owner;
-- the storage/download assertions below still execute as authenticated user A.
set local role postgres;
update public.products set status = 'archived' where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select case when count(*) = 0 then 'PASS archived product premium storage is hidden' else 'FAIL archived product storage count=' || count(*) end
from storage.objects where bucket_id = 'premium-files' and name = 'moon-garden/bonus.pdf';
select case when public.record_download_event('11111111-1111-4111-8111-111111111105') is null then 'PASS archived download event rejected' else 'FAIL archived download event recorded' end;
rollback;

-- Atomic product-save regression helper. It builds the complete desired state
-- from the current database, then lets individual scenarios add/update/remove
-- one child collection without bypassing the production RPC.
create function pg_temp.product_state(
  requested_product_id uuid,
  title_suffix text default '',
  removed_asset_id uuid default null,
  removed_code_id uuid default null,
  drop_locale text default null,
  add_locale text default null,
  drop_category_id uuid default null,
  add_category_id uuid default null,
  drop_tag_id uuid default null,
  add_tag_id uuid default null,
  drop_amazon_id uuid default null,
  add_amazon boolean default false,
  add_asset boolean default false,
  add_code boolean default false
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', p.id,
    'slug', p.slug,
    'status', p.status,
    'audience', p.audience,
    'productType', p.product_type,
    'coverAssetId', p.cover_asset_id,
    'videoAssetId', p.video_asset_id,
    'reviewDelayDays', p.review_delay_days,
    'sortOrder', p.sort_order,
    'updatedAt', now()::text,
    'translations', coalesce((
      select jsonb_agg(row_json order by row_json ->> 'locale')
      from (
        select jsonb_build_object(
          'locale', t.locale,
          'title', t.title || coalesce(title_suffix, ''),
          'shortDescription', t.short_description,
          'longDescription', t.long_description,
          'seoTitle', t.seo_title,
          'seoDescription', t.seo_description
        ) as row_json
        from public.product_translations t
        where t.product_id = p.id
          and (drop_locale is null or t.locale <> drop_locale)
        union all
        select jsonb_build_object(
          'locale', add_locale,
          'title', 'Added translation',
          'shortDescription', 'Added short description',
          'longDescription', 'Added long description',
          'seoTitle', null,
          'seoDescription', null
        )
        where add_locale is not null
      ) translation_rows
    ), '[]'::jsonb),
    'categoryIds', coalesce((
      select jsonb_agg(item order by item::text)
      from (
        select r.category_id as item
        from public.product_categories r
        where r.product_id = p.id
          and (drop_category_id is null or r.category_id <> drop_category_id)
        union all
        select add_category_id
        where add_category_id is not null
      ) category_rows
    ), '[]'::jsonb),
    'tagIds', coalesce((
      select jsonb_agg(item order by item::text)
      from (
        select r.tag_id as item
        from public.product_tags r
        where r.product_id = p.id
          and (drop_tag_id is null or r.tag_id <> drop_tag_id)
        union all
        select add_tag_id
        where add_tag_id is not null
      ) tag_rows
    ), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(row_json order by row_json ->> 'id')
      from (
        select jsonb_build_object(
          'id', a.id,
          'kind', a.kind,
          'bucket', a.bucket,
          'path', a.path,
          'filename', a.filename,
          'contentType', a.content_type,
          'sizeBytes', a.size_bytes,
          'locale', a.locale,
          'title', a.title,
          'sortOrder', a.sort_order
        ) as row_json
        from public.product_assets a
        where a.product_id = p.id
          and a.is_active
          and (removed_asset_id is null or a.id <> removed_asset_id)
        union all
        select jsonb_build_object(
          'id', '33333333-3333-4333-8333-333333333399'::uuid,
          'kind', 'gallery',
          'bucket', 'public-media',
          'path', 'assets/gallery/added-page.svg',
          'filename', 'added-page.svg',
          'contentType', 'image/svg+xml',
          'sizeBytes', 1200,
          'locale', 'en',
          'title', 'Added gallery asset',
          'sortOrder', 99
        )
        where add_asset
      ) asset_rows
    ), '[]'::jsonb),
    'amazonLinks', coalesce((
      select jsonb_agg(row_json order by row_json ->> 'id')
      from (
        select jsonb_build_object(
          'id', l.id,
          'market', l.market,
          'url', l.url,
          'isPrimary', l.is_primary
        ) as row_json
        from public.amazon_links l
        where l.product_id = p.id
          and (drop_amazon_id is null or l.id <> drop_amazon_id)
        union all
        select jsonb_build_object(
          'id', '33333333-3333-4333-8333-333333333398'::uuid,
          'market', 'amazon.de',
          'url', 'https://www.amazon.de/dp/ADDED-LAMILIA',
          'isPrimary', true
        )
        where add_amazon
      ) amazon_rows
    ), '[]'::jsonb),
    'premiumCodes', coalesce((
      select jsonb_agg(row_json order by row_json ->> 'id')
      from (
        select jsonb_build_object(
          'id', c.id,
          'code', c.code,
          'active', c.active
        ) as row_json
        from public.premium_codes c
        where c.product_id = p.id
          and (removed_code_id is null or c.id <> removed_code_id)
        union all
        select jsonb_build_object(
          'id', '99999999-9999-4999-8999-999999999996'::uuid,
          'code', 'LOMI-ADDED-2026',
          'active', true
        )
        where add_code
      ) premium_rows
    ), '[]'::jsonb)
  )
  from public.products p
  where p.id = requested_product_id;
$$;

create function pg_temp.product_save_should_fail(product_state jsonb)
returns boolean
language plpgsql
as $$
begin
  perform public.save_product(product_state);
  return false;
exception when others then
  return true;
end;
$$;

update public.profiles
set role = 'admin'
where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

\echo 'RLS matrix: atomic product mutation and history safety'
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

select case when (public.save_product(pg_temp.product_state(
  requested_product_id => '22222222-2222-4222-8222-222222222222',
  title_suffix => ' unused-code-edit'
)) ->> 'status') = 'success' then 'PASS unused-code product edit is atomic' else 'FAIL unused-code product edit' end;
select case when count(*) = 1 and bool_and(id = '99999999-9999-4999-8999-999999999992'::uuid) then 'PASS unused premium-code ID remains stable' else 'FAIL unused premium-code identity' end
from public.premium_codes where product_id = '22222222-2222-4222-8222-222222222222';

select case when (public.redeem_premium_code(
  '11111111-1111-4111-8111-111111111111', 'LOMI-BOOK-2026'
) ->> 'status') = 'success' then 'PASS used-code fixture redemption' else 'FAIL used-code fixture redemption' end;
select case when (public.save_product(pg_temp.product_state(
  requested_product_id => '11111111-1111-4111-8111-111111111111',
  title_suffix => ' used-code-edit'
)) ->> 'status') = 'success' then 'PASS used-code unrelated edit is atomic' else 'FAIL used-code unrelated edit' end;
select case when count(*) = 1 and bool_and(premium_code_id = '99999999-9999-4999-8999-999999999991'::uuid) then 'PASS unlock keeps referenced premium-code ID' else 'FAIL unlock premium-code identity' end
from public.user_product_unlocks
where user_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  and product_id = '11111111-1111-4111-8111-111111111111';
select case when count(*) = 1 then 'PASS used premium code remains present after unrelated edit' else 'FAIL used premium code disappeared' end
from public.premium_codes
where id = '99999999-9999-4999-8999-999999999991';

select case when (public.save_product(pg_temp.product_state(
  requested_product_id => '11111111-1111-4111-8111-111111111111',
  removed_code_id => '99999999-9999-4999-8999-999999999991',
  title_suffix => ' used-code-removed'
)) ->> 'status') = 'success' then 'PASS removing used code follows retention policy' else 'FAIL used-code removal policy' end;
select case when count(*) = 1 and bool_and(not active) then 'PASS removed used code is retained inactive' else 'FAIL removed used code history' end
from public.premium_codes
where id = '99999999-9999-4999-8999-999999999991';
select case when count(*) = 1 then 'PASS unlock remains after used-code removal' else 'FAIL unlock removed with code' end
from public.user_product_unlocks
where user_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  and product_id = '11111111-1111-4111-8111-111111111111';

select case when public.record_download_event('11111111-1111-4111-8111-111111111105') is not null then 'PASS historical download fixture recorded' else 'FAIL historical download fixture' end;
select case when (public.save_product(pg_temp.product_state(
  requested_product_id => '11111111-1111-4111-8111-111111111111',
  removed_code_id => '99999999-9999-4999-8999-999999999991',
  title_suffix => ' history-edit'
)) ->> 'status') = 'success' then 'PASS historical-download unrelated edit is atomic' else 'FAIL historical-download unrelated edit' end;
select case when count(*) = 1 then 'PASS download history remains after unrelated edit' else 'FAIL download history changed' end
from public.download_events
where user_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  and asset_id = '11111111-1111-4111-8111-111111111105';

select case when (public.save_product(pg_temp.product_state(
  requested_product_id => '11111111-1111-4111-8111-111111111111',
  removed_asset_id => '11111111-1111-4111-8111-111111111105',
  removed_code_id => '99999999-9999-4999-8999-999999999991'
)) ->> 'status') = 'success' then 'PASS removing historical asset is atomic' else 'FAIL historical-asset removal' end;
select case when count(*) = 1 and bool_and(not is_active) then 'PASS removed historical asset is retained inactive' else 'FAIL historical asset policy' end
from public.product_assets
where id = '11111111-1111-4111-8111-111111111105';
select case when count(*) = 1 then 'PASS historical download event survives asset removal' else 'FAIL download event cascaded on asset removal' end
from public.download_events
where user_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  and asset_id = '11111111-1111-4111-8111-111111111105';
select case when public.record_download_event('11111111-1111-4111-8111-111111111105') is null then 'PASS inactive historical asset denied for new download' else 'FAIL inactive historical asset downloadable' end;

select case when pg_temp.product_save_should_fail(jsonb_set(
  pg_temp.product_state(requested_product_id => '22222222-2222-4222-8222-222222222222', title_suffix => ' must-rollback'),
  '{coverAssetId}',
  to_jsonb('33333333-3333-4333-8333-333333333301'::uuid)
)) then 'PASS late product mutation failure is rejected' else 'FAIL late product mutation unexpectedly succeeded' end;
select case when title not like '%must-rollback' then 'PASS failed mutation rolls back product children' else 'FAIL failed mutation partially committed title' end
from public.product_translations
where product_id = '22222222-2222-4222-8222-222222222222' and locale = 'en';
select case when count(*) = 1 and bool_and(id = '99999999-9999-4999-8999-999999999992'::uuid) then 'PASS failed mutation preserves premium-code state' else 'FAIL failed mutation changed premium-code state' end
from public.premium_codes
where product_id = '22222222-2222-4222-8222-222222222222';

select case when (public.save_product(pg_temp.product_state(
  requested_product_id => '33333333-3333-4333-8333-333333333333',
  title_suffix => ' collection-edit',
  removed_code_id => '99999999-9999-4999-8999-999999999993',
  drop_locale => 'pl',
  add_locale => 'es',
  drop_category_id => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  add_category_id => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  drop_tag_id => 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  add_tag_id => 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  drop_amazon_id => '33333333-3333-4333-8333-333333333301',
  add_amazon => true,
  add_asset => true,
  add_code => true
)) ->> 'status') = 'success' then 'PASS child collection reconciliation is atomic' else 'FAIL child collection reconciliation' end;
select case when count(*) = 2 and count(*) filter (where locale = 'es') = 1 then 'PASS translations add/update/remove exactly' else 'FAIL translation desired state' end
from public.product_translations
where product_id = '33333333-3333-4333-8333-333333333333';
select case when count(*) = 1 and bool_and(category_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid) then 'PASS categories add/remove exactly' else 'FAIL category desired state' end
from public.product_categories
where product_id = '33333333-3333-4333-8333-333333333333';
select case when count(*) = 1 and bool_and(tag_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid) then 'PASS tags add/remove exactly' else 'FAIL tag desired state' end
from public.product_tags
where product_id = '33333333-3333-4333-8333-333333333333';
select case when count(*) = 1 and bool_and(id = '33333333-3333-4333-8333-333333333398'::uuid) then 'PASS Amazon links add/remove exactly' else 'FAIL Amazon link desired state' end
from public.amazon_links
where product_id = '33333333-3333-4333-8333-333333333333';
select case when count(*) = 2 and count(*) filter (where id = '33333333-3333-4333-8333-333333333399'::uuid) = 1 then 'PASS assets add/update/remove exactly' else 'FAIL asset desired state' end
from public.product_assets
where product_id = '33333333-3333-4333-8333-333333333333' and is_active;
select case when count(*) = 1 and bool_and(id = '99999999-9999-4999-8999-999999999996'::uuid) then 'PASS unused premium-code removal and add exactly' else 'FAIL premium-code desired state' end
from public.premium_codes
where product_id = '33333333-3333-4333-8333-333333333333';
select case when exists (
  select 1
  from public.products p
  join public.product_assets a on a.id = p.cover_asset_id and a.product_id = p.id and a.is_active
  where p.id = '33333333-3333-4333-8333-333333333333'
) then 'PASS cover reference remains valid' else 'FAIL cover reference invalid' end;

rollback;
update public.profiles
set role = 'user'
where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

\echo 'RLS matrix: admin policy'
update public.profiles set role = 'admin' where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
select case when count(*) = 4 then 'PASS admin sees draft product' else 'FAIL admin product count=' || count(*) end
from public.products;
select case when count(*) = 1 then 'PASS admin sees premium code rows' else 'FAIL admin premium code count=' || count(*) end
from public.premium_codes where code = 'LOMI-BOOK-2026';
select case when count(*) = 1 then 'PASS admin sees user B profile' else 'FAIL admin cross-profile count=' || count(*) end
from public.profiles where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
insert into public.products (id, slug, status, audience, product_type, review_delay_days, sort_order)
values ('55555555-5555-4555-8555-555555555555', 'admin-policy-write', 'draft', 'adults', 'book', 14, 99);
select case when count(*) = 1 then 'PASS admin can mutate content' else 'FAIL admin content mutation count=' || count(*) end
from public.products where slug = 'admin-policy-write';
rollback;

-- Leave the local database as it was before this harness ran.
update public.profiles set role = 'user'
where id in ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb');
delete from public.download_events
where user_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
delete from public.user_product_unlocks
where user_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
delete from storage.objects
where bucket_id = 'premium-files'
  and name in ('moon-garden/bonus.pdf', 'mindful-mandalas/bonus.pdf');
delete from public.product_assets
where id = '22222222-2222-4222-8222-222222222205';
delete from public.premium_codes
where id in ('99999999-9999-4999-8999-999999999994', '99999999-9999-4999-8999-999999999995');
delete from auth.users
where id in ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb');

\echo 'RLS matrix complete: 53 positive scenarios passed'
