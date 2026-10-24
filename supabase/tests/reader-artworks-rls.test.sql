BEGIN;
SELECT plan(7);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.product_reader_artworks'::regclass),
  'reader artwork metadata has RLS enabled'
);
SELECT ok(NOT has_table_privilege('anon', 'public.product_reader_artworks', 'SELECT'), 'anonymous clients cannot query private artwork metadata directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.product_reader_artworks', 'SELECT'), 'authenticated clients cannot query private artwork metadata directly');
SELECT ok(NOT has_table_privilege('anon', 'public.product_reader_artworks', 'INSERT'), 'anonymous clients cannot manage reader artwork');
SELECT ok(NOT has_table_privilege('authenticated', 'public.product_reader_artworks', 'INSERT'), 'authenticated clients cannot manage reader artwork');
SELECT ok(has_table_privilege('service_role', 'public.product_reader_artworks', 'SELECT,INSERT,UPDATE,DELETE'), 'server-only service role can manage artwork rows');
SELECT ok(has_function_privilege('service_role', 'public.reorder_product_reader_artworks(uuid,uuid[])', 'EXECUTE'), 'server-only role can reorder artwork rows');

ROLLBACK;
