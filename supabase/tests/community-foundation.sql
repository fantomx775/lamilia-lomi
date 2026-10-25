-- Run against the named disposable local Supabase DB only:
-- PGOPTIONS='-c search_path=public,extensions' docker exec -i <local-db-container> \
--   psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/community-foundation.sql
-- Everything, including Auth/product fixtures, rolls back.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT plan(56);

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.community_profiles'::regclass), 'community profiles have RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.community_artworks'::regclass), 'community artworks have RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.community_moderation_events'::regclass), 'moderation events have RLS enabled');
SELECT ok(NOT has_table_privilege('anon', 'public.community_profiles', 'SELECT'), 'anon cannot read raw community profiles');
SELECT ok(NOT has_table_privilege('authenticated', 'public.community_profiles', 'SELECT'), 'authenticated cannot read raw community profiles');
SELECT ok(NOT has_table_privilege('anon', 'public.community_artworks', 'SELECT') AND NOT has_table_privilege('anon', 'public.community_artworks', 'INSERT') AND NOT has_table_privilege('anon', 'public.community_artworks', 'UPDATE') AND NOT has_table_privilege('anon', 'public.community_artworks', 'DELETE'), 'anon cannot access raw community artworks');
SELECT ok(NOT has_table_privilege('authenticated', 'public.community_artworks', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.community_artworks', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.community_artworks', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.community_artworks', 'DELETE'), 'authenticated cannot access raw community artworks');
SELECT ok(NOT has_table_privilege('anon', 'public.community_moderation_events', 'SELECT') AND NOT has_table_privilege('anon', 'public.community_moderation_events', 'INSERT') AND NOT has_table_privilege('anon', 'public.community_moderation_events', 'UPDATE') AND NOT has_table_privilege('anon', 'public.community_moderation_events', 'DELETE'), 'anon cannot access moderation events');
SELECT ok(NOT has_table_privilege('authenticated', 'public.community_moderation_events', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.community_moderation_events', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.community_moderation_events', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.community_moderation_events', 'DELETE'), 'authenticated cannot access moderation events');
SELECT ok(has_table_privilege('service_role', 'public.community_artworks', 'SELECT,INSERT,UPDATE,DELETE'), 'service role can access community data');
SELECT ok(NOT has_function_privilege('anon', 'public.community_create_pending_artwork(uuid,uuid,text,text,text,bigint,text,uuid)', 'EXECUTE'), 'anon cannot call mutation RPC');
SELECT ok(NOT has_function_privilege('authenticated', 'public.community_create_pending_artwork(uuid,uuid,text,text,text,bigint,text,uuid)', 'EXECUTE'), 'authenticated cannot call mutation RPC');
SELECT ok(has_function_privilege('service_role', 'public.community_create_pending_artwork(uuid,uuid,text,text,text,bigint,text,uuid)', 'EXECUTE'), 'service role can call mutation RPC');
SELECT ok(NOT has_function_privilege('anon', 'private.community_actor_is_verified(uuid)', 'EXECUTE'), 'auth lookup helper is not client-callable');
SELECT ok(has_function_privilege('service_role', 'private.community_actor_is_verified(uuid)', 'EXECUTE'), 'service role can use narrow auth lookup helper');
SELECT ok(NOT has_table_privilege('service_role', 'auth.users', 'SELECT'), 'service role has no direct auth user table access');

INSERT INTO auth.users (id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
VALUES
  ('10000000-0000-4000-8000-000000000001','cc-member@example.test',now(),'{}','{}'),
  ('10000000-0000-4000-8000-000000000002','cc-locked@example.test',now(),'{}','{}'),
  ('10000000-0000-4000-8000-000000000003','cc-unverified@example.test',null,'{}','{}'),
  ('10000000-0000-4000-8000-000000000004','cc-admin@example.test',now(),'{}','{}'),
  ('10000000-0000-4000-8000-000000000005','cc-other@example.test',now(),'{}','{}');
INSERT INTO public.profiles (id,email,role)
VALUES
  ('10000000-0000-4000-8000-000000000001','cc-member@example.test','user'),
  ('10000000-0000-4000-8000-000000000002','cc-locked@example.test','user'),
  ('10000000-0000-4000-8000-000000000003','cc-unverified@example.test','user'),
  ('10000000-0000-4000-8000-000000000004','cc-admin@example.test','admin'),
  ('10000000-0000-4000-8000-000000000005','cc-other@example.test','user')
ON CONFLICT (id) DO UPDATE SET role = excluded.role;
INSERT INTO public.user_product_unlocks (user_id,product_id)
VALUES ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111');
CREATE TEMP TABLE community_join_timestamp (accepted_at timestamptz);
GRANT SELECT, INSERT ON community_join_timestamp TO service_role;
CREATE TEMP TABLE community_artwork_result (id uuid);
GRANT SELECT, INSERT ON community_artwork_result TO service_role;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.community_artworks$$, '42501', 'permission denied for table community_artworks', 'anonymous raw artwork SELECT is denied');
SELECT throws_ok($$SELECT public.community_join('10000000-0000-4000-8000-000000000001','garden_user',true,'2026-10-25-v1')$$, '42501', 'permission denied for function community_join', 'anonymous cannot invoke join RPC');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.community_profiles$$, '42501', 'permission denied for table community_profiles', 'authenticated raw profile SELECT is denied');
SELECT throws_ok($$INSERT INTO public.community_artworks (author_id,product_id,storage_path,storage_provider,content_type,size_bytes) VALUES ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','community/10000000-0000-4000-8000-000000000001/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','local','image/png',100)$$, '42501', 'permission denied for table community_artworks', 'direct PostgREST insert cannot spoof author or status');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT is(public.community_join('10000000-0000-4000-8000-000000000001','Garden_User',true,'2026-10-25-v1'), '10000000-0000-4000-8000-000000000001'::uuid, 'verified actor can join with normalized username');
INSERT INTO community_join_timestamp SELECT accepted_at FROM public.community_profiles WHERE user_id='10000000-0000-4000-8000-000000000001';
SELECT is(public.community_join('10000000-0000-4000-8000-000000000001','garden_user',true,'2026-10-25-v1'), '10000000-0000-4000-8000-000000000001'::uuid, 'repeated join with same username is idempotent');
SELECT is((SELECT accepted_at FROM public.community_profiles WHERE user_id='10000000-0000-4000-8000-000000000001'), (SELECT accepted_at FROM community_join_timestamp), 'idempotent join does not rewrite acceptance timestamp');
SELECT throws_ok($$SELECT public.community_join('10000000-0000-4000-8000-000000000001','different_name',true,'2026-10-25-v1')$$, '22023', 'use the rate-limited username change operation', 'join cannot bypass username-change limiter');
SELECT is(public.community_change_username('10000000-0000-4000-8000-000000000001','garden_user2'), true, 'separate username-change operation succeeds');
SELECT is(public.community_change_username('10000000-0000-4000-8000-000000000001','garden_user3'), true, 'username change limiter allows second change in window');
SELECT is(public.community_change_username('10000000-0000-4000-8000-000000000001','garden_user4'), true, 'username change limiter allows configured maximum');
SELECT throws_ok($$SELECT public.community_change_username('10000000-0000-4000-8000-000000000001','garden_user5')$$, '42900', 'username changes are rate limited', 'username changes are limited per account');
SELECT throws_ok($$SELECT public.community_join('10000000-0000-4000-8000-000000000003','unverified_user',true,'2026-10-25-v1')$$, '42501', 'verified account required', 'unverified auth user cannot join');
SELECT throws_ok($$SELECT public.community_join('10000000-0000-4000-8000-000000000002','admin',true,'2026-10-25-v1')$$, '22023', 'reserved username', 'reserved username is rejected');
INSERT INTO community_artwork_result SELECT public.community_create_pending_artwork(
  '10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
  'community/10000000-0000-4000-8000-000000000001/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'supabase','image/png',12345,'A flower','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);
SELECT is((SELECT id FROM community_artwork_result), (SELECT id FROM public.community_artworks WHERE idempotency_key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'eligible verified unlocked user can create pending metadata');
SELECT is(public.community_create_pending_artwork(
  '10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
  'community/10000000-0000-4000-8000-000000000001/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'supabase','image/png',12345,'A flower','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
), (SELECT id FROM community_artwork_result), 'matching idempotent retry returns existing artwork');
SELECT throws_ok($$SELECT public.community_create_pending_artwork(
  '10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
  'community/10000000-0000-4000-8000-000000000001/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'supabase','image/png',12345,'Different caption','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$, '22023', 'idempotency key was reused with different artwork metadata', 'same idempotency key with changed payload is rejected');
SELECT throws_ok($$SELECT public.community_create_pending_artwork(
  '10000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
  'community/10000000-0000-4000-8000-000000000002/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'supabase','image/png',12345,'Locked','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$, '42501', 'active community membership required', 'locked user cannot submit artwork');
SELECT throws_ok($$SELECT public.community_create_pending_artwork(
  '10000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222',
  'community/10000000-0000-4000-8000-000000000001/cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'supabase','image/png',12345,'Wrong product','cccccccc-cccc-4ccc-8ccc-cccccccccccc')$$, '42501', 'published unlocked product required', 'unlock for another product does not authorize submission');
SELECT throws_ok($$SELECT public.community_moderate_artwork('10000000-0000-4000-8000-000000000001',(SELECT id FROM community_artwork_result),1,'approve',null)$$, '42501', 'active administrator required', 'member cannot spoof admin role for moderation');
SELECT is(public.community_moderate_artwork('10000000-0000-4000-8000-000000000004',(SELECT id FROM community_artwork_result),1,'approve',null), 2, 'admin can approve the expected pending revision');
UPDATE public.community_profiles SET rules_version='obsolete-rules' WHERE user_id='10000000-0000-4000-8000-000000000001';
SELECT throws_ok($$SELECT public.community_edit_artwork_description('10000000-0000-4000-8000-000000000001',(SELECT id FROM community_artwork_result),2,'Stale rules edit')$$, '40001', 'artwork is unavailable or revision changed', 'stale rules acceptance cannot edit or resubmit artwork');
UPDATE public.community_profiles SET rules_version='2026-10-25-v1' WHERE user_id='10000000-0000-4000-8000-000000000001';
SELECT is(public.community_edit_artwork_description('10000000-0000-4000-8000-000000000001',(SELECT id FROM community_artwork_result),2,'Edited caption'), 3, 'owner edit returns approved work to a new pending revision');
SELECT is((SELECT status FROM public.community_artworks WHERE id=(SELECT id FROM community_artwork_result)), 'pending', 'approved revision disappears from public state during edit');
SELECT is(public.community_moderate_artwork('10000000-0000-4000-8000-000000000004',(SELECT id FROM community_artwork_result),3,'approve',null), 4, 'admin can approve the edited revision');
SELECT is(public.community_moderate_artwork('10000000-0000-4000-8000-000000000004',(SELECT id FROM community_artwork_result),4,'remove','Private identifying details'), 5, 'admin can remove approved work with a reason');
SELECT is(public.community_edit_artwork_description('10000000-0000-4000-8000-000000000001',(SELECT id FROM community_artwork_result),5,'Edited but still removed'), 6, 'author edit does not restore removed content');
SELECT is((SELECT status FROM public.community_artworks WHERE id=(SELECT id FROM community_artwork_result)), 'removed', 'removed state persists after author edit');
SELECT is(public.community_delete_artwork('10000000-0000-4000-8000-000000000001',(SELECT id FROM community_artwork_result),6), true, 'owner can soft delete their record');
SELECT ok((SELECT deleted_at is not null FROM public.community_artworks WHERE id=(SELECT id FROM community_artwork_result)), 'soft-deleted artwork has terminal timestamp');
SELECT throws_ok($$SELECT public.community_moderate_artwork('10000000-0000-4000-8000-000000000004',(SELECT id FROM community_artwork_result),7,'restore',null)$$, '40001', 'artwork is unavailable or revision changed', 'soft-deleted artwork cannot be restored');

SELECT public.community_create_pending_artwork(
  '10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
  'community/10000000-0000-4000-8000-000000000001/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'supabase','image/png',12345,'Suspension test','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
UPDATE public.community_profiles SET suspended_at=now() WHERE user_id='10000000-0000-4000-8000-000000000001';
SELECT throws_ok($$SELECT public.community_moderate_artwork('10000000-0000-4000-8000-000000000004',(SELECT id FROM public.community_artworks WHERE idempotency_key='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),1,'approve',null)$$, '42501', 'active eligible author required for approval', 'admin cannot approve artwork from suspended author');
UPDATE public.community_profiles SET suspended_at=null WHERE user_id='10000000-0000-4000-8000-000000000001';

SELECT public.community_create_pending_artwork(
  '10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
  'community/10000000-0000-4000-8000-000000000001/cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'supabase','image/png',12345,'Archived product test','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
UPDATE public.products SET status='archived' WHERE id='11111111-1111-4111-8111-111111111111';
SELECT throws_ok($$SELECT public.community_moderate_artwork('10000000-0000-4000-8000-000000000004',(SELECT id FROM public.community_artworks WHERE idempotency_key='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),1,'approve',null)$$, '42501', 'published product required for approval', 'admin cannot approve artwork for archived product');
UPDATE public.products SET status='published' WHERE id='11111111-1111-4111-8111-111111111111';

SELECT public.community_create_pending_artwork(
  '10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
  'community/10000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'supabase','image/png',12345,'Revoked author test','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
UPDATE public.community_profiles SET participation_revoked_at=now() WHERE user_id='10000000-0000-4000-8000-000000000001';
SELECT throws_ok($$SELECT public.community_moderate_artwork('10000000-0000-4000-8000-000000000004',(SELECT id FROM public.community_artworks WHERE idempotency_key='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),1,'approve',null)$$, '42501', 'active eligible author required for approval', 'admin cannot approve artwork after participation revocation');
DELETE FROM public.community_rate_limit_buckets WHERE bucket_key=encode(extensions.digest('community-username-change:10000000-0000-4000-8000-000000000001','sha256'),'hex');
SELECT throws_ok($$SELECT public.community_change_username('10000000-0000-4000-8000-000000000001','after_leave')$$, '42501', 'active community membership required', 'revoked participant cannot rename username');
UPDATE public.community_profiles SET participation_revoked_at=null, rules_version='old-rules' WHERE user_id='10000000-0000-4000-8000-000000000001';
SELECT throws_ok($$SELECT public.community_moderate_artwork('10000000-0000-4000-8000-000000000004',(SELECT id FROM public.community_artworks WHERE idempotency_key='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),1,'approve',null)$$, '42501', 'active eligible author required for approval', 'admin cannot approve artwork under stale rules acceptance');
UPDATE public.community_profiles SET rules_version='2026-10-25-v1' WHERE user_id='10000000-0000-4000-8000-000000000001';

SELECT public.community_create_pending_artwork(
  '10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
  'community/10000000-0000-4000-8000-000000000001/ffffffff-ffff-4fff-8fff-ffffffffffff',
  'supabase','image/png',12345,'Unlock revocation test','ffffffff-ffff-4fff-8fff-ffffffffffff');
RESET ROLE;
DELETE FROM public.user_product_unlocks
WHERE user_id='10000000-0000-4000-8000-000000000001' AND product_id='11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.community_moderate_artwork('10000000-0000-4000-8000-000000000004',(SELECT id FROM public.community_artworks WHERE idempotency_key='ffffffff-ffff-4fff-8fff-ffffffffffff'),1,'approve',null)$$, '42501', 'unlocked product required for approval', 'admin cannot approve after product unlock is revoked');
RESET ROLE;
INSERT INTO public.user_product_unlocks (user_id,product_id)
VALUES ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111');
SET LOCAL ROLE service_role;

SELECT public.community_create_pending_artwork(
  '10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
  'community/10000000-0000-4000-8000-000000000001/dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'supabase','image/png',12345,'Deleted author test','dddddddd-dddd-4ddd-8ddd-dddddddddddd');
RESET ROLE;
DELETE FROM auth.users WHERE id='10000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.community_moderate_artwork('10000000-0000-4000-8000-000000000004',(SELECT id FROM public.community_artworks WHERE idempotency_key='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),1,'approve',null)$$, '42501', 'active eligible author required for approval', 'admin cannot approve artwork after author deletion');
RESET ROLE;

SELECT ok((SELECT count(*) = 3 FROM public.community_moderation_events WHERE artwork_id=(SELECT id FROM community_artwork_result)), 'admin moderation decisions are append-only audit rows');
SELECT ok(NOT has_table_privilege('service_role', 'public.community_moderation_events', 'UPDATE') AND NOT has_table_privilege('service_role', 'public.community_moderation_events', 'DELETE'), 'service role cannot update or delete moderation audit rows');

SELECT * FROM finish();
ROLLBACK;
