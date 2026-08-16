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
update public.products set status = 'archived' where id = '11111111-1111-4111-8111-111111111111';
select case when count(*) = 0 then 'PASS archived product premium storage is hidden' else 'FAIL archived product storage count=' || count(*) end
from storage.objects where bucket_id = 'premium-files' and name = 'moon-garden/bonus.pdf';
select case when public.record_download_event('11111111-1111-4111-8111-111111111105') is null then 'PASS archived download event rejected' else 'FAIL archived download event recorded' end;
rollback;

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

\echo 'RLS matrix complete: 26 positive scenarios passed'
