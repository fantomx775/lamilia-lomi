-- Restore the verified, active, private premium Storage contract after the
-- public-media policy cleanup migrations. This is forward-only and does not
-- rewrite an already-applied migration.
drop policy if exists "premium objects are readable after unlock" on storage.objects;

create policy "premium objects are readable after unlock"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'premium-files'
    and (select private.is_email_verified())
    and exists (
      select 1
      from public.product_assets a
      join public.user_product_unlocks u on u.product_id = a.product_id
      join public.products p on p.id = a.product_id
      where a.bucket = bucket_id
        and a.path = name
        and a.kind = 'premium_download'
        and a.is_public = false
        and a.is_active
        and p.status = 'published'
        and u.user_id = (select auth.uid())
    )
  );
