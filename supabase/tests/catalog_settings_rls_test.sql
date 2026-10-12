BEGIN;
SELECT plan(18);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.catalog_settings'::regclass),
  'catalog settings has row level security enabled'
);
SELECT ok(
  has_table_privilege('anon', 'public.catalog_settings', 'SELECT'),
  'anonymous visitors can read catalog settings'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.catalog_settings', 'SELECT'),
  'signed-in users can read catalog settings'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.catalog_settings', 'UPDATE'),
  'signed-in admins have the table privilege needed to update settings'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.catalog_settings', 'UPDATE'),
  'anonymous visitors cannot update catalog settings'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.catalog_settings', 'INSERT'),
  'anonymous visitors cannot insert catalog settings'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.catalog_settings', 'INSERT'),
  'signed-in users cannot insert catalog settings'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.catalog_settings', 'DELETE'),
  'signed-in users cannot delete catalog settings'
);

INSERT INTO auth.users (
  id,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data
)
VALUES
  (
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    'catalog-admin@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
    'catalog-user@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb
  );

INSERT INTO public.profiles (id, email, role)
VALUES
  (
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    'catalog-admin@example.test',
    'admin'
  ),
  (
    'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
    'catalog-user@example.test',
    'user'
  )
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email, role = EXCLUDED.role;

SET LOCAL ROLE anon;
SELECT set_config(
  'test.catalog_settings_anon_read',
  COALESCE(
    (SELECT desktop_columns::text FROM public.catalog_settings WHERE id = 'global'),
    'missing'
  ),
  true
);
RESET ROLE;

SELECT is(
  current_setting('test.catalog_settings_anon_read'),
  '4',
  'anonymous visitors can read the default desktop column count'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
SELECT set_config(
  'test.catalog_settings_nonadmin_read',
  COALESCE(
    (SELECT desktop_columns::text FROM public.catalog_settings WHERE id = 'global'),
    'missing'
  ),
  true
);
WITH updated AS (
  UPDATE public.catalog_settings
  SET desktop_columns = 3,
      about_intro = 'unauthorized intro',
      favorite_coloring_book_ids = ARRAY['forbidden', '', '']::text[]
  WHERE id = 'global'
  RETURNING id
)
SELECT set_config(
  'test.catalog_settings_nonadmin_update_rows',
  (SELECT count(*)::text FROM updated),
  true
);
RESET ROLE;

SELECT is(
  current_setting('test.catalog_settings_nonadmin_read'),
  '4',
  'non-admin users can read catalog settings'
);
SELECT is(
  current_setting('test.catalog_settings_nonadmin_update_rows'),
  '0',
  'non-admin users cannot update About or catalog settings'
);
SELECT is(
  (SELECT about_intro FROM public.catalog_settings WHERE id = 'global'),
  '',
  'non-admin updates do not change About content'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
WITH updated AS (
  UPDATE public.catalog_settings
  SET desktop_columns = 5,
      about_intro = 'Admin introduction',
      favorite_coloring_book_ids = ARRAY['coloring-1', 'coloring-2', 'coloring-3']::text[],
      favorite_picture_book_ids = ARRAY['picture-1', 'picture-2', 'picture-3']::text[]
  WHERE id = 'global'
  RETURNING id
)
SELECT set_config(
  'test.catalog_settings_admin_update_rows',
  (SELECT count(*)::text FROM updated),
  true
);
RESET ROLE;

SELECT is(
  current_setting('test.catalog_settings_admin_update_rows'),
  '1',
  'admins can update catalog settings'
);
SELECT is(
  (SELECT desktop_columns::integer FROM public.catalog_settings WHERE id = 'global'),
  5,
  'the admin update is persisted'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.catalog_settings
    WHERE id = 'global'
      AND about_intro = 'Admin introduction'
      AND favorite_coloring_book_ids = ARRAY['coloring-1', 'coloring-2', 'coloring-3']::text[]
      AND favorite_picture_book_ids = ARRAY['picture-1', 'picture-2', 'picture-3']::text[]
  ),
  'the admin About settings update is persisted'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
SELECT throws_ok(
  $$UPDATE public.catalog_settings
    SET favorite_coloring_book_ids = ARRAY['duplicate', 'duplicate', '']::text[]
    WHERE id = 'global'$$,
  '23514',
  'admins cannot bypass duplicate selection validation within a section using direct SQL'
);
SELECT throws_ok(
  $$UPDATE public.catalog_settings
    SET favorite_coloring_book_ids = ARRAY['shared', '', '']::text[],
        favorite_picture_book_ids = ARRAY['shared', '', '']::text[]
    WHERE id = 'global'$$,
  '23514',
  'admins cannot bypass duplicate selection validation across sections using direct SQL'
);
RESET ROLE;
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.catalog_settings'::regclass
      AND conname = 'catalog_settings_desktop_columns_check'
      AND contype = 'c'
  ),
  'the database restricts desktop columns to supported values'
);

SELECT * FROM finish();
ROLLBACK;
