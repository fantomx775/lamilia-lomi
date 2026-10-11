BEGIN;
SELECT plan(17);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.collections'::regclass),
  'collections has row level security enabled'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.collections', 'SELECT'),
  'anonymous visitors cannot read the admin-only collections table'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.collections', 'SELECT'),
  'authenticated users receive the table privilege checked by RLS'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.collections', 'INSERT'),
  'anonymous visitors cannot insert collections'
);
SELECT ok(
  NOT (SELECT public FROM storage.buckets WHERE id = 'collection-media'),
  'collection-media is a private storage bucket'
);

INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('aaaaaaaa-4999-4999-8999-aaaaaaaaaaaa', 'issue49-admin@example.test', now(), '{}'::jsonb, '{}'::jsonb),
  ('bbbbbbbb-4999-4999-8999-bbbbbbbbbbbb', 'issue49-user@example.test', now(), '{}'::jsonb, '{}'::jsonb);
INSERT INTO public.profiles (id, email, role)
VALUES
  ('aaaaaaaa-4999-4999-8999-aaaaaaaaaaaa', 'issue49-admin@example.test', 'admin'),
  ('bbbbbbbb-4999-4999-8999-bbbbbbbbbbbb', 'issue49-user@example.test', 'user')
ON CONFLICT (id) DO UPDATE SET email = excluded.email, role = excluded.role;

INSERT INTO public.collections (id, name, slug)
VALUES ('dddddddd-4999-4999-8999-dddddddddddd', 'Issue 49 collection', 'issue-49-collection');
INSERT INTO storage.objects (bucket_id, name)
VALUES ('collection-media', 'collections/dddddddd-4999-4999-8999-dddddddddddd/test.png');

CREATE FUNCTION pg_temp.issue49_duplicate_collection_name_is_denied()
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.collections (id, name, slug)
  VALUES ('eeeeeeee-4999-4999-8999-eeeeeeeeeeee', ' ISSUE 49 COLLECTION ', 'duplicate-name');
  RETURN false;
EXCEPTION WHEN unique_violation THEN
  RETURN true;
END;
$$;

SELECT ok(
  pg_temp.issue49_duplicate_collection_name_is_denied(),
  'collection names are unique ignoring case and surrounding whitespace'
);

CREATE FUNCTION pg_temp.issue49_nonadmin_insert_is_denied()
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.collections (id, name, slug)
  VALUES ('eeeeeeee-4999-4999-8999-eeeeeeeeeeee', 'Forbidden collection', 'forbidden-collection');
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN true;
END;
$$;

SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::integer FROM storage.objects WHERE bucket_id = 'collection-media'),
  0,
  'anonymous visitors cannot read collection image objects'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-4999-4999-8999-bbbbbbbbbbbb';
SELECT is((SELECT count(*)::integer FROM public.collections), 0, 'non-admin users cannot read collections');
SELECT is((SELECT count(*)::integer FROM storage.objects WHERE bucket_id = 'collection-media'), 0, 'non-admin users cannot read collection image objects');
SELECT ok(pg_temp.issue49_nonadmin_insert_is_denied(), 'non-admin users cannot create collections');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-4999-4999-8999-aaaaaaaaaaaa';
SELECT is((SELECT count(*)::integer FROM public.collections), 1, 'admins can read collections');
SELECT is((SELECT count(*)::integer FROM storage.objects WHERE bucket_id = 'collection-media'), 1, 'admins can read collection image objects');
SELECT is(
  (public.save_product(jsonb_build_object(
    'id', 'cccccccc-4999-4999-8999-cccccccccccc',
    'slug', 'issue-49-product',
    'status', 'draft',
    'audience', 'kids',
    'productType', 'coloring-book',
    'collectionId', 'dddddddd-4999-4999-8999-dddddddddddd',
    'translations', '[]'::jsonb,
    'categoryIds', '[]'::jsonb,
    'tagIds', '[]'::jsonb,
    'assets', '[]'::jsonb,
    'amazonLinks', '[]'::jsonb,
    'premiumCodes', '[]'::jsonb
  )) ->> 'status'),
  'success',
  'the admin product-save RPC accepts a collection assignment'
);
SELECT is(
  (SELECT collection_id FROM public.products WHERE id = 'cccccccc-4999-4999-8999-cccccccccccc'),
  'dddddddd-4999-4999-8999-dddddddddddd'::uuid,
  'the product-save RPC persists collection_id'
);
SELECT public.save_product(jsonb_build_object(
  'id', 'cccccccc-4999-4999-8999-cccccccccccc',
  'slug', 'issue-49-product',
  'status', 'draft',
  'audience', 'kids',
  'productType', 'coloring-book',
  'translations', '[]'::jsonb,
  'categoryIds', '[]'::jsonb,
  'tagIds', '[]'::jsonb,
  'assets', '[]'::jsonb,
  'amazonLinks', '[]'::jsonb,
  'premiumCodes', '[]'::jsonb
));
SELECT is(
  (SELECT collection_id FROM public.products WHERE id = 'cccccccc-4999-4999-8999-cccccccccccc'),
  'dddddddd-4999-4999-8999-dddddddddddd'::uuid,
  'older product-save payloads preserve the collection assignment'
);
SELECT public.save_product(jsonb_build_object(
  'id', 'cccccccc-4999-4999-8999-cccccccccccc',
  'slug', 'issue-49-product',
  'status', 'draft',
  'audience', 'kids',
  'productType', 'coloring-book',
  'collectionId', null,
  'translations', '[]'::jsonb,
  'categoryIds', '[]'::jsonb,
  'tagIds', '[]'::jsonb,
  'assets', '[]'::jsonb,
  'amazonLinks', '[]'::jsonb,
  'premiumCodes', '[]'::jsonb
));
SELECT is(
  (SELECT collection_id FROM public.products WHERE id = 'cccccccc-4999-4999-8999-cccccccccccc'),
  null::uuid,
  'the product-save RPC clears collection assignment when requested'
);
SELECT public.save_product(jsonb_build_object(
  'id', 'cccccccc-4999-4999-8999-cccccccccccc',
  'slug', 'issue-49-product',
  'status', 'draft',
  'audience', 'kids',
  'productType', 'coloring-book',
  'collectionId', 'dddddddd-4999-4999-8999-dddddddddddd',
  'translations', '[]'::jsonb,
  'categoryIds', '[]'::jsonb,
  'tagIds', '[]'::jsonb,
  'assets', '[]'::jsonb,
  'amazonLinks', '[]'::jsonb,
  'premiumCodes', '[]'::jsonb
));
DELETE FROM public.collections WHERE id = 'dddddddd-4999-4999-8999-dddddddddddd';
SELECT is(
  (SELECT collection_id FROM public.products WHERE id = 'cccccccc-4999-4999-8999-cccccccccccc'),
  null::uuid,
  'deleting a collection detaches but preserves its product'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
