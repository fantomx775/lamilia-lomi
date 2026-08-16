\set ON_ERROR_STOP on

-- Execute this file in two authenticated sessions at the same time, passing a
-- different suffix to each session, for example:
--   psql ... -v suffix=concurrent-a -f atomic-product-save-concurrency.sql
-- The caller must hold the disposable admin fixture user below.
\if :{?suffix}
\else
\set suffix concurrency
\endif

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

select public.save_product(
  jsonb_build_object(
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
      select jsonb_agg(jsonb_build_object(
        'locale', t.locale,
        'title', t.title || ' ' || :'suffix',
        'shortDescription', t.short_description,
        'longDescription', t.long_description,
        'seoTitle', t.seo_title,
        'seoDescription', t.seo_description
      ) order by t.locale)
      from public.product_translations t
      where t.product_id = p.id
    ), '[]'::jsonb),
    'categoryIds', coalesce((
      select jsonb_agg(pc.category_id order by pc.category_id)
      from public.product_categories pc
      where pc.product_id = p.id
    ), '[]'::jsonb),
    'tagIds', coalesce((
      select jsonb_agg(pt.tag_id order by pt.tag_id)
      from public.product_tags pt
      where pt.product_id = p.id
    ), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
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
      ) order by a.id)
      from public.product_assets a
      where a.product_id = p.id and a.is_active
    ), '[]'::jsonb),
    'amazonLinks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'market', l.market,
        'url', l.url,
        'isPrimary', l.is_primary
      ) order by l.id)
      from public.amazon_links l
      where l.product_id = p.id
    ), '[]'::jsonb),
    'premiumCodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'code', c.code,
        'active', c.active
      ) order by c.id)
      from public.premium_codes c
      where c.product_id = p.id
    ), '[]'::jsonb)
  )
) ->> 'status' as mutation_status
from public.products p
where p.id = '33333333-3333-4333-8333-333333333333';

commit;
