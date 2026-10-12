-- Keep admin code batches and full product saves in the same per-product
-- transaction lane. A stale editor save must not erase a batch generated after
-- that editor loaded its product.

create or replace function public.create_premium_code_batch(
  requested_product_id uuid,
  code_entries jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  if requested_product_id is null then
    raise exception using
      errcode = '22023',
      message = 'Premium code batch is invalid.';
  end if;

  if jsonb_typeof(code_entries) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'Premium code batch is invalid.';
  end if;

  if jsonb_array_length(code_entries) < 1
    or jsonb_array_length(code_entries) > 250
    or exists (
      select 1
      from jsonb_array_elements(code_entries) as entry(value)
      where jsonb_typeof(entry.value) is distinct from 'object'
        or nullif(entry.value ->> 'id', '') is null
        or nullif(entry.value ->> 'code', '') is null
    ) then
    raise exception using
      errcode = '22023',
      message = 'Premium code batch is invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));

  if not exists (
    select 1 from public.products where id = requested_product_id
  ) then
    return false;
  end if;

  insert into public.premium_codes (id, product_id, code, active)
  select
    (entry.value ->> 'id')::uuid,
    requested_product_id,
    entry.value ->> 'code',
    true
  from jsonb_array_elements(code_entries) as entry(value);

  return true;
end;
$$;

revoke all on function public.create_premium_code_batch(uuid, jsonb) from public;
revoke all on function public.create_premium_code_batch(uuid, jsonb) from anon;
grant execute on function public.create_premium_code_batch(uuid, jsonb) to authenticated;

-- Keep the existing save implementation intact, but put a small wrapper at
-- its original entry point. The wrapper locks the product, merges codes that
-- were not in the editor's snapshot, then delegates to the original atomic
-- product save RPC. Explicit removals remain honored.
alter function private.save_product(jsonb)
  rename to save_product_before_premium_code_batch_merge;

revoke all on function private.save_product_before_premium_code_batch_merge(jsonb) from public;
revoke all on function private.save_product_before_premium_code_batch_merge(jsonb) from anon;
revoke all on function private.save_product_before_premium_code_batch_merge(jsonb) from authenticated;

create function private.save_product(product_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_product_id uuid := nullif(product_state ->> 'id', '')::uuid;
  requested_codes jsonb := coalesce(product_state -> 'premiumCodes', '[]'::jsonb);
  removed_code_ids uuid[];
  codes_missing_from_snapshot jsonb;
  normalized_state jsonb;
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

  if jsonb_typeof(requested_codes) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'Premium code state is invalid.';
  end if;

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into removed_code_ids
  from jsonb_array_elements_text(
    coalesce(product_state -> 'premiumCodeRemovals', '[]'::jsonb)
  ) as removal(value);

  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', code_row.id, 'code', code_row.code, 'active', code_row.active)
      order by code_row.id
    ),
    '[]'::jsonb
  )
  into codes_missing_from_snapshot
  from public.premium_codes code_row
  where code_row.product_id = requested_product_id
    and not (code_row.id = any(removed_code_ids))
    and not exists (
      select 1
      from jsonb_array_elements(requested_codes) as requested(value)
      where nullif(requested.value ->> 'id', '')::uuid = code_row.id
    );

  normalized_state := jsonb_set(
    product_state - 'premiumCodeRemovals',
    '{premiumCodes}',
    requested_codes || codes_missing_from_snapshot,
    true
  );

  return private.save_product_before_premium_code_batch_merge(normalized_state);
end;
$$;

revoke all on function private.save_product(jsonb) from public;
revoke all on function private.save_product(jsonb) from anon;
grant execute on function private.save_product(jsonb) to authenticated;
