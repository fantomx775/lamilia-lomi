-- Keep an outdated admin server from replacing Rich Text V2 product content.
-- The lock matches every product-save RPC so the check and write are atomic.
alter function private.save_product(jsonb)
  rename to save_product_before_rich_text_v2_compatibility_guard;

revoke all on function private.save_product_before_rich_text_v2_compatibility_guard(jsonb)
  from public, anon, authenticated;

create function private.save_product(product_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_product_id uuid := nullif(product_state ->> 'id', '')::uuid;
begin
  if current_user_id is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  if requested_product_id is null then
    raise exception using
      errcode = '22023',
      message = 'Product identifier is required.';
  end if;

  -- save_product and save_product_with_storage_provider share this lock.
  -- A stale writer waits for any in-flight V2 save, then sees its committed
  -- value here before the wrapped mutation can replace translations.
  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));

  if product_state ->> 'richTextEditorVersion' is distinct from '2'
    and exists (
      select 1
      from public.product_translations current_translation
      where current_translation.product_id = requested_product_id
        and position('"richTextV2"' in coalesce(current_translation.long_description, '')) > 0
    ) then
    raise exception using
      errcode = 'P0001',
      message = 'admin.rich_text.client_outdated';
  end if;

  return private.save_product_before_rich_text_v2_compatibility_guard(
    product_state - 'richTextEditorVersion'
  );
end;
$$;

revoke all on function private.save_product(jsonb) from public, anon;
grant execute on function private.save_product(jsonb) to authenticated;
