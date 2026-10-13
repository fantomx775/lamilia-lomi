BEGIN;
SELECT plan(23);

INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('aaaaaaaa-5999-4999-8999-aaaaaaaaaaaa', 'issue49-admin-ext@example.test', now(), '{}'::jsonb, '{}'::jsonb),
  ('bbbbbbbb-5999-4999-8999-bbbbbbbbbbbb', 'issue49-user-ext@example.test', now(), '{}'::jsonb, '{}'::jsonb);
INSERT INTO public.profiles (id, email, role)
VALUES
  ('aaaaaaaa-5999-4999-8999-aaaaaaaaaaaa', 'issue49-admin-ext@example.test', 'admin'),
  ('bbbbbbbb-5999-4999-8999-bbbbbbbbbbbb', 'issue49-user-ext@example.test', 'user')
ON CONFLICT (id) DO UPDATE SET email = excluded.email, role = excluded.role;

INSERT INTO public.collections (id, name, slug)
VALUES ('dddddddd-5999-4999-8999-dddddddddddd', 'Issue 49 extended collection', 'issue-49-extended');
INSERT INTO public.product_collections (product_id, collection_id)
VALUES ('11111111-1111-4111-8111-111111111111', 'dddddddd-5999-4999-8999-dddddddddddd');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.collections'::regclass), 'collections uses RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.product_collections'::regclass), 'assignments use RLS');
SELECT is((SELECT count(*)::integer FROM public.product_categories WHERE product_id='11111111-1111-4111-8111-111111111111'), 1, 'seeded product has its original category link');
SELECT is((SELECT count(*)::integer FROM public.product_tags WHERE product_id='11111111-1111-4111-8111-111111111111'), 2, 'seeded product has its original tag links');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-5999-4999-8999-aaaaaaaaaaaa';
UPDATE public.collections SET name='Issue 49 extended collection edited', slug='issue-49-extended-edited' WHERE id='dddddddd-5999-4999-8999-dddddddddddd';
SELECT is((SELECT name FROM public.collections WHERE id='dddddddd-5999-4999-8999-dddddddddddd'), 'Issue 49 extended collection edited', 'admin can update a collection');
INSERT INTO storage.objects (bucket_id, name)
VALUES ('collection-media', 'collections/dddddddd-5999-4999-8999-dddddddddddd/image/11111111-1111-4111-8111-111111111111-cover.png');
SELECT ok(EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='collection-media' AND name='collections/dddddddd-5999-4999-8999-dddddddddddd/image/11111111-1111-4111-8111-111111111111-cover.png'), 'admin can write collection image objects');
RESET ROLE;

CREATE FUNCTION pg_temp.issue49_nonadmin_collection_insert_denied() RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.collections (id,name,slug) VALUES ('eeeeeeee-5999-4999-8999-eeeeeeeeeeee','Forbidden extended','forbidden-extended');
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END; $$;
CREATE FUNCTION pg_temp.issue49_nonadmin_collection_update_denied() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.collections SET name='Forbidden update' WHERE id='dddddddd-5999-4999-8999-dddddddddddd';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected=0;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END; $$;
CREATE FUNCTION pg_temp.issue49_nonadmin_collection_delete_denied() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  DELETE FROM public.collections WHERE id='dddddddd-5999-4999-8999-dddddddddddd';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected=0;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END; $$;
CREATE FUNCTION pg_temp.issue49_nonadmin_assignment_insert_denied() RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.product_collections (product_id,collection_id) VALUES ('22222222-2222-4222-8222-222222222222','dddddddd-5999-4999-8999-dddddddddddd');
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END; $$;
CREATE FUNCTION pg_temp.issue49_nonadmin_assignment_update_denied() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.product_collections SET collection_id='dddddddd-5999-4999-8999-dddddddddddd' WHERE product_id='11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected=0;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END; $$;
CREATE FUNCTION pg_temp.issue49_nonadmin_assignment_delete_denied() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  DELETE FROM public.product_collections WHERE product_id='11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected=0;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END; $$;
CREATE FUNCTION pg_temp.issue49_nonadmin_storage_insert_denied() RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO storage.objects (bucket_id,name) VALUES ('collection-media','collections/forbidden/forbidden.png');
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END; $$;
CREATE FUNCTION pg_temp.issue49_nonadmin_storage_update_denied() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  UPDATE storage.objects SET name='collections/forbidden/replaced.png' WHERE bucket_id='collection-media' AND name='collections/dddddddd-5999-4999-8999-dddddddddddd/image/11111111-1111-4111-8111-111111111111-cover.png';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected=0;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END; $$;
CREATE FUNCTION pg_temp.issue49_nonadmin_storage_delete_denied() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  DELETE FROM storage.objects WHERE bucket_id='collection-media' AND name='collections/dddddddd-5999-4999-8999-dddddddddddd/image/11111111-1111-4111-8111-111111111111-cover.png';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected=0;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END; $$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-5999-4999-8999-bbbbbbbbbbbb';
SELECT is((SELECT count(*)::integer FROM public.collections), 0, 'non-admin cannot read collections');
SELECT is((SELECT count(*)::integer FROM public.product_collections), 0, 'non-admin cannot read assignments');
SELECT is((SELECT count(*)::integer FROM storage.objects WHERE bucket_id='collection-media'), 0, 'non-admin cannot read collection images');
SELECT ok(pg_temp.issue49_nonadmin_collection_insert_denied(), 'non-admin collection insert is denied');
SELECT ok(pg_temp.issue49_nonadmin_collection_update_denied(), 'non-admin collection update is denied');
SELECT ok(pg_temp.issue49_nonadmin_collection_delete_denied(), 'non-admin collection delete is denied');
SELECT ok(pg_temp.issue49_nonadmin_assignment_insert_denied(), 'non-admin assignment insert is denied');
SELECT ok(pg_temp.issue49_nonadmin_assignment_update_denied(), 'non-admin assignment update is denied');
SELECT ok(pg_temp.issue49_nonadmin_assignment_delete_denied(), 'non-admin assignment delete is denied');
SELECT ok(pg_temp.issue49_nonadmin_storage_insert_denied(), 'non-admin image insert is denied');
SELECT ok(pg_temp.issue49_nonadmin_storage_update_denied(), 'non-admin image update is denied');
SELECT ok(pg_temp.issue49_nonadmin_storage_delete_denied(), 'non-admin image delete is denied');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-5999-4999-8999-aaaaaaaaaaaa';
DELETE FROM public.collections WHERE id='dddddddd-5999-4999-8999-dddddddddddd';
SELECT ok(NOT EXISTS (SELECT 1 FROM public.collections WHERE id='dddddddd-5999-4999-8999-dddddddddddd'), 'admin can delete a collection');
SELECT ok(EXISTS (SELECT 1 FROM public.products WHERE id='11111111-1111-4111-8111-111111111111'), 'collection deletion preserves its product');
SELECT is((SELECT count(*)::integer FROM public.product_collections WHERE product_id='11111111-1111-4111-8111-111111111111'), 0, 'collection deletion clears only the assignment');
SELECT is((SELECT count(*)::integer FROM public.product_categories WHERE product_id='11111111-1111-4111-8111-111111111111'), 1, 'collection deletion preserves category links');
SELECT is((SELECT count(*)::integer FROM public.product_tags WHERE product_id='11111111-1111-4111-8111-111111111111'), 2, 'collection deletion preserves tag links');
SELECT * FROM finish();
ROLLBACK;
