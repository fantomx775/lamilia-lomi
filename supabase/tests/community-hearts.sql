-- Run only against supabase_db_lamilia-coloring-club-p0, the disposable local DB.
-- Real privileges/constraints/triggers/RPCs are exercised and all fixtures roll back.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.community_artwork_likes'::regclass), 'heart rows have RLS');
SELECT ok(NOT has_table_privilege('anon','public.community_artwork_likes','SELECT,INSERT,UPDATE,DELETE'), 'anonymous raw heart table access is revoked');
SELECT ok(NOT has_table_privilege('authenticated','public.community_artwork_likes','SELECT,INSERT,UPDATE,DELETE'), 'authenticated raw heart table access is revoked');
SELECT ok(NOT has_function_privilege('anon','public.community_set_artwork_like(uuid,uuid,boolean)','EXECUTE'), 'anonymous cannot spoof an actor through the heart RPC');
SELECT ok(NOT has_function_privilege('authenticated','public.community_set_artwork_like(uuid,uuid,boolean)','EXECUTE'), 'authenticated cannot invoke the service-only heart RPC');
SELECT ok(has_function_privilege('service_role','public.community_set_artwork_like(uuid,uuid,boolean)','EXECUTE'), 'only trusted server execution is granted');

INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
SELECT ('61000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'cc-sql-heart-'||n||'@example.test',now(),'{}','{}' FROM generate_series(1,6) n;
INSERT INTO public.products(id,slug,status,audience,product_type)
VALUES('63000000-0000-4000-8000-000000000001','cc-sql-heart-book','published','adults','coloring-book');
INSERT INTO public.product_translations(product_id,locale,title,short_description,long_description)
VALUES('63000000-0000-4000-8000-000000000001','en','Heart SQL fixture','Isolated fixture','Isolated fixture');

SET LOCAL ROLE service_role;
SELECT public.community_join('61000000-0000-4000-8000-000000000001','cc_sql_heart_owner',true,'2026-10-25-v1');
SELECT public.community_join('61000000-0000-4000-8000-000000000002','cc_sql_heart_member',true,'2026-10-25-v1');
SELECT public.community_join('61000000-0000-4000-8000-000000000003','cc_sql_heart_verify',true,'2026-10-25-v1');
SELECT public.community_join('61000000-0000-4000-8000-000000000005','cc_sql_heart_suspend',true,'2026-10-25-v1');
SELECT public.community_join('61000000-0000-4000-8000-000000000006','cc_sql_heart_other',true,'2026-10-25-v1');
RESET ROLE;
UPDATE auth.users SET email_confirmed_at=NULL WHERE id='61000000-0000-4000-8000-000000000003';
UPDATE public.community_profiles SET suspended_at=now() WHERE user_id='61000000-0000-4000-8000-000000000005';
INSERT INTO public.community_artworks(id,author_id,product_id,storage_path,storage_provider,content_type,size_bytes,description,status,published_at,deleted_at)
SELECT ('62000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '61000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001',
  'community/61000000-0000-4000-8000-000000000001/64000000-0000-4000-8000-'||lpad(n::text,12,'0'),
  'supabase','image/webp',100,'Isolated SQL heart fixture',
  CASE n WHEN 2 THEN 'pending' WHEN 3 THEN 'rejected' WHEN 4 THEN 'removed' ELSE 'approved' END,
  CASE WHEN n IN(1,5) THEN now() ELSE NULL END,
  CASE WHEN n=5 THEN now() ELSE NULL END
FROM generate_series(1,5) n;
CREATE TEMP TABLE cc_heart_content_before AS
SELECT revision,updated_at FROM public.community_artworks WHERE id='62000000-0000-4000-8000-000000000001';
GRANT SELECT ON cc_heart_content_before TO service_role;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.community_artwork_likes$$,'42501','permission denied for table community_artwork_likes','anonymous REST cannot list liker identities');
SELECT throws_ok($$SELECT public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',true)$$,'42501','permission denied for function community_set_artwork_like','anonymous cannot choose a forged heart actor');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.community_artwork_likes$$,'42501','permission denied for table community_artwork_likes','authenticated REST cannot read raw liker rows');
SELECT throws_ok($$INSERT INTO public.community_artwork_likes(artwork_id,user_id) VALUES('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002')$$,'42501','permission denied for table community_artwork_likes','direct REST cannot insert a heart or spoof its user');
RESET ROLE;
SET LOCAL ROLE service_role;

SELECT is((SELECT count(*) FROM public.user_product_unlocks WHERE user_id='61000000-0000-4000-8000-000000000002'),0::bigint,'eligible liker has no product unlock');
SELECT is(public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',true)->>'liked','true','verified opted-in adult can heart without unlocking the book');
SELECT is((SELECT likes_count FROM public.community_artworks WHERE id='62000000-0000-4000-8000-000000000001'),1,'first heart increments exactly once');
SELECT is(public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',true)->>'likesCount','1','duplicate like is idempotent');
SELECT is((SELECT count(*) FROM public.community_artwork_likes WHERE artwork_id='62000000-0000-4000-8000-000000000001'),1::bigint,'unique actor/artwork key prevents duplicate rows');
SELECT is(public.community_set_artwork_like('61000000-0000-4000-8000-000000000006','62000000-0000-4000-8000-000000000001',true)->>'likesCount','2','a different eligible member contributes one heart');
SELECT is(public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',false)->>'likesCount','1','unlike decrements exactly once');
SELECT is(public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',false)->>'likesCount','1','repeated unlike is idempotent');
SELECT is((SELECT revision FROM public.community_artworks WHERE id='62000000-0000-4000-8000-000000000001'),(SELECT revision FROM cc_heart_content_before),'hearts do not change content revision');
SELECT is((SELECT updated_at FROM public.community_artworks WHERE id='62000000-0000-4000-8000-000000000001'),(SELECT updated_at FROM cc_heart_content_before),'hearts do not rewrite content modification time');

-- Expected denial messages are asserted after the final migration contract is ready.
SELECT throws_ok($$SELECT public.community_set_artwork_like('61000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000001',true)$$,'42501',NULL,'current Auth email verification is required');
SELECT throws_ok($$SELECT public.community_set_artwork_like('61000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000001',true)$$,'42501',NULL,'verified nonmember cannot heart');
SELECT throws_ok($$SELECT public.community_set_artwork_like('61000000-0000-4000-8000-000000000005','62000000-0000-4000-8000-000000000001',true)$$,'42501',NULL,'suspended member cannot heart');
SELECT throws_ok($$SELECT public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',NULL)$$,'22023',NULL,'null intent cannot accidentally act as unlike');
SELECT is(public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002',true)->>'available','false','pending work cannot receive hearts');
SELECT is(public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000003',true)->>'available','false','rejected work cannot receive hearts');
SELECT is(public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000004',true)->>'available','false','removed work cannot receive hearts');
SELECT is(public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000005',true)->>'available','false','deleted work cannot receive hearts');

RESET ROLE;
DELETE FROM auth.users WHERE id='61000000-0000-4000-8000-000000000006';
SELECT is((SELECT likes_count FROM public.community_artworks WHERE id='62000000-0000-4000-8000-000000000001'),0,'Auth deletion cascades the like and repairs its cached count');
SET LOCAL ROLE service_role;
SELECT public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',true);
UPDATE public.community_profiles SET participation_revoked_at=now() WHERE user_id='61000000-0000-4000-8000-000000000002';
SELECT is((SELECT likes_count FROM public.community_artworks WHERE id='62000000-0000-4000-8000-000000000001'),0,'withdrawal removes existing personal hearts');
SELECT is((SELECT count(*) FROM public.community_artwork_likes WHERE user_id='61000000-0000-4000-8000-000000000002'),0::bigint,'withdrawal leaves no personal engagement rows');
SELECT throws_ok($$SELECT public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',true)$$,'42501',NULL,'withdrawn member cannot heart');
SELECT public.community_join('61000000-0000-4000-8000-000000000002','cc_sql_heart_member',true,'2026-10-25-v1');
SELECT public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',true);
UPDATE public.community_profiles SET suspended_at=now() WHERE user_id='61000000-0000-4000-8000-000000000002';
SELECT is((SELECT likes_count FROM public.community_artworks WHERE id='62000000-0000-4000-8000-000000000001'),0,'suspension removes existing member hearts');
UPDATE public.community_profiles SET suspended_at=NULL WHERE user_id='61000000-0000-4000-8000-000000000002';
UPDATE public.products SET status='archived' WHERE id='63000000-0000-4000-8000-000000000001';
SELECT is(public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',true)->>'available','false','archived books cannot receive hearts');
UPDATE public.products SET status='published' WHERE id='63000000-0000-4000-8000-000000000001';
UPDATE public.community_profiles SET suspended_at=now() WHERE user_id='61000000-0000-4000-8000-000000000001';
SELECT is(public.community_set_artwork_like('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',true)->>'available','false','a suspended creator cannot receive reactions');
SELECT * FROM finish();
ROLLBACK;
