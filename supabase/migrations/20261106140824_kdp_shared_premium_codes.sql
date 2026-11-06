-- Expand only: existing codes default to single_use; historical unlocks are untouched.
alter table public.premium_codes
  add column code_type text not null default 'single_use',
  add constraint premium_codes_type_check check (code_type in ('single_use', 'shared')),
  add constraint premium_codes_shared_not_consumed_check
    check (code_type <> 'shared' or (redeemed_by is null and redeemed_at is null));

create unique index premium_codes_one_shared_per_product
  on public.premium_codes (product_id) where code_type = 'shared';

-- Printed identity is permanent even before the first redemption. Deactivation
-- is the only supported removal; neither printing nor disabling revokes access.
create function private.guard_shared_premium_code()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.code_type = 'shared' then
      raise exception using errcode = '23514',
        message = 'A printed shared code cannot be deleted; deactivate it instead.';
    end if;
    return old;
  end if;
  if old.code_type is distinct from new.code_type
    or (old.code_type = 'shared' and
      (old.code is distinct from new.code or old.product_id is distinct from new.product_id)) then
    raise exception using errcode = '23514',
      message = 'Premium code type and printed shared identity cannot change.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_shared_premium_code() from public, anon, authenticated;
create trigger premium_codes_shared_identity_guard
before update or delete on public.premium_codes
for each row execute function private.guard_shared_premium_code();

create function private.manage_shared_premium_code(
  requested_product_id uuid,
  requested_code text default null,
  requested_active boolean default true
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  shared_code public.premium_codes%rowtype;
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if requested_product_id is null or requested_active is null then
    raise exception using errcode = '22023', message = 'Shared code state is invalid.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  perform 1 from public.products where id = requested_product_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'Product not found.';
  end if;
  select * into shared_code from public.premium_codes
  where product_id = requested_product_id and code_type = 'shared' for update;
  if found then
    if requested_code is not null and
      private.normalize_premium_code(requested_code) <> shared_code.normalized_code then
      raise exception using errcode = '23514', message = 'A printed shared code cannot be replaced.';
    end if;
    update public.premium_codes set active = requested_active where id = shared_code.id
      returning * into shared_code;
  else
    insert into public.premium_codes(product_id, code, active, code_type)
    values (requested_product_id,
      coalesce(requested_code, 'KDP-' || upper(replace(gen_random_uuid()::text, '-', ''))),
      requested_active, 'shared') returning * into shared_code;
  end if;
  return to_jsonb(shared_code);
end;
$$;
revoke all on function private.manage_shared_premium_code(uuid, text, boolean) from public, anon;
grant execute on function private.manage_shared_premium_code(uuid, text, boolean) to authenticated;
create function public.manage_shared_premium_code(
  requested_product_id uuid,
  requested_code text default null,
  requested_active boolean default true
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.manage_shared_premium_code(requested_product_id, requested_code, requested_active);
$$;
revoke all on function public.manage_shared_premium_code(uuid, text, boolean) from public, anon;
grant execute on function public.manage_shared_premium_code(uuid, text, boolean) to authenticated;

-- A product editor, including deployed older versions, cannot remove, replace,
-- or silently reactivate a shared code using its stale desired-state snapshot.
alter function private.save_product(jsonb) rename to save_product_before_shared_codes;
revoke all on function private.save_product_before_shared_codes(jsonb) from public, anon, authenticated;
create function private.save_product(product_state jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  requested_product_id uuid := nullif(product_state ->> 'id', '')::uuid;
  requested_codes jsonb := coalesce(product_state -> 'premiumCodes', '[]'::jsonb);
  merged_codes jsonb;
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if requested_product_id is null or jsonb_typeof(requested_codes) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Product code state is invalid.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  select coalesce(jsonb_agg(entry.value), '[]'::jsonb) into merged_codes
  from jsonb_array_elements(requested_codes) entry(value)
  where not exists (
    select 1 from public.premium_codes c
    where c.product_id = requested_product_id and c.code_type = 'shared'
      and c.id = nullif(entry.value ->> 'id', '')::uuid
  );
  select merged_codes || coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'code', c.code, 'active', c.active)), '[]'::jsonb)
  into merged_codes from public.premium_codes c
  where c.product_id = requested_product_id and c.code_type = 'shared';
  return private.save_product_before_shared_codes(
    jsonb_set(product_state, '{premiumCodes}', merged_codes, true));
end;
$$;
revoke all on function private.save_product(jsonb) from public, anon;
grant execute on function private.save_product(jsonb) to authenticated;

create or replace function private.redeem_premium_code(
  requested_product_id uuid,
  requested_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  matching_code public.premium_codes%rowtype;
  existing_unlock public.user_product_unlocks%rowtype;
  inserted_unlock_id uuid;
  claimed_code_id uuid;
  normalized_requested_code text := private.normalize_premium_code(requested_code);
begin
  if current_user_id is null then
    return jsonb_build_object('status', 'auth_required');
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = current_user_id
      and u.email_confirmed_at is not null
  ) then
    return jsonb_build_object('status', 'email_unverified');
  end if;

  if normalized_requested_code is null or normalized_requested_code = '' then
    return jsonb_build_object('status', 'invalid_code');
  end if;

  -- Match the product save routine's product-before-code lock order. This
  -- holds publication state stable and avoids a save/redemption lock cycle.
  perform 1
  from public.products p
  where p.id = requested_product_id
    and p.status = 'published'
  for share;

  if not found then
    return jsonb_build_object('status', 'product_not_found');
  end if;

  select c.* into matching_code
  from public.premium_codes c
  where c.normalized_code = normalized_requested_code
  for update;

  if not found then
    return jsonb_build_object('status', 'invalid_code');
  end if;

  if matching_code.product_id <> requested_product_id then
    return jsonb_build_object('status', 'wrong_product');
  end if;

  -- An existing entitlement wins over any additional valid code. In
  -- particular, repeated scans do not consume a second code for this product.
  select u.* into existing_unlock
  from public.user_product_unlocks u
  where u.user_id = current_user_id
    and u.product_id = requested_product_id;

  if found then
    return jsonb_build_object(
      'status', 'already_unlocked',
      'product_id', requested_product_id,
      'premium_code_id', existing_unlock.premium_code_id
    );
  end if;

  if matching_code.code_type = 'single_use' and matching_code.redeemed_at is not null then
    if matching_code.redeemed_by = current_user_id then
      -- Repair an absent entitlement if historical/manual cleanup removed it;
      -- a claimed code still represents permanent access for its owner.
      insert into public.user_product_unlocks (user_id, product_id, premium_code_id)
      values (current_user_id, requested_product_id, matching_code.id)
      on conflict (user_id, product_id) do nothing;

      return jsonb_build_object(
        'status', 'already_unlocked',
        'product_id', requested_product_id,
        'premium_code_id', matching_code.id
      );
    end if;

    return jsonb_build_object('status', 'already_used');
  end if;

  if not matching_code.active then
    return jsonb_build_object('status', 'inactive_code');
  end if;

  insert into public.user_product_unlocks (user_id, product_id, premium_code_id)
  values (current_user_id, requested_product_id, matching_code.id)
  on conflict (user_id, product_id) do nothing
  returning id into inserted_unlock_id;

  if inserted_unlock_id is null then
    return jsonb_build_object(
      'status', 'already_unlocked',
      'product_id', requested_product_id,
      'premium_code_id', matching_code.id
    );
  end if;

  if matching_code.code_type = 'shared' then
    return jsonb_build_object('status', 'success', 'product_id', requested_product_id,
      'premium_code_id', matching_code.id, 'unlock_id', inserted_unlock_id);
  end if;

  update public.premium_codes c
  set redeemed_by = current_user_id,
      redeemed_at = clock_timestamp()
  where c.id = matching_code.id
    and c.active
    and c.redeemed_at is null
  returning c.id into claimed_code_id;

  if claimed_code_id is null then
    raise exception using
      errcode = '40001',
      message = 'Premium code changed while it was being redeemed; retry the request.';
  end if;

  return jsonb_build_object(
    'status', 'success',
    'product_id', requested_product_id,
    'premium_code_id', matching_code.id,
    'unlock_id', inserted_unlock_id
  );
end;
$$;

revoke all on function private.redeem_premium_code(uuid, text) from public, anon;
grant execute on function private.redeem_premium_code(uuid, text) to authenticated;
revoke all on function public.redeem_premium_code(uuid, text) from public, anon;
grant execute on function public.redeem_premium_code(uuid, text) to authenticated;

-- Preserve legacy printed slug-based links as products are renamed. New print
-- exports use the product UUID, while an old slug can never be reassigned to a
-- different book. Alias writes are owned solely by the product trigger.
create table public.product_slug_aliases (
  slug text primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index product_slug_aliases_product_id_idx on public.product_slug_aliases(product_id);
alter table public.product_slug_aliases enable row level security;
revoke all on public.product_slug_aliases from public, anon, authenticated;
grant select on public.product_slug_aliases to anon, authenticated, service_role;
create policy "published product slug aliases are readable"
on public.product_slug_aliases for select to anon, authenticated
using (exists(select 1 from public.products p
  where p.id = product_id and p.status = 'published'));

insert into public.product_slug_aliases(slug, product_id)
select slug, id from public.products;

create function private.preserve_product_slug_aliases()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- ON CONFLICT only accepts an alias already belonging to this exact book.
  -- A conflicting historical alias must roll back the product edit, rather
  -- than route a printed link to another product.
  insert into public.product_slug_aliases(slug, product_id)
  values(new.slug, new.id)
  on conflict (slug) do update set product_id = excluded.product_id
    where public.product_slug_aliases.product_id = excluded.product_id;
  if not found then
    raise exception using errcode = '23505',
      constraint = 'product_slug_aliases_pkey',
      message = 'This slug is reserved by an existing printed product link.';
  end if;
  return new;
end;
$$;
revoke all on function private.preserve_product_slug_aliases() from public, anon, authenticated;
create trigger products_preserve_printed_slug
  after insert or update of slug on public.products
  for each row execute function private.preserve_product_slug_aliases();
