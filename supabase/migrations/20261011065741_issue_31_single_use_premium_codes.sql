-- Premium codes are single-use across accounts. Keep the entitlement itself in
-- user_product_unlocks; these fields record which account consumed each code.
alter table public.premium_codes
  add column redeemed_by uuid references auth.users(id) on delete set null,
  add column redeemed_at timestamptz;

-- Preserve the earliest historical redemption if older data contains codes
-- that were previously reused. Existing entitlements remain untouched.
with earliest_redemption as (
  select distinct on (u.premium_code_id)
    u.premium_code_id,
    u.user_id,
    u.unlocked_at
  from public.user_product_unlocks u
  join public.premium_codes c
    on c.id = u.premium_code_id
   and c.product_id = u.product_id
  where u.premium_code_id is not null
  order by u.premium_code_id, u.unlocked_at, u.id
)
update public.premium_codes c
set redeemed_by = r.user_id,
    redeemed_at = r.unlocked_at
from earliest_redemption r
where c.id = r.premium_code_id
  and c.redeemed_at is null;

create index premium_codes_product_redemption_idx
  on public.premium_codes (product_id, active, redeemed_at);

-- Keep the referencing side of the account FK indexed for user deletion and
-- redemption ownership lookups.
create index premium_codes_redeemed_by_idx
  on public.premium_codes (redeemed_by);

-- Once an unlock references a code, its code and product identity are history.
-- Redemption metadata is immutable after the first claim; deleting an auth
-- user may clear redeemed_by through ON DELETE SET NULL, while redeemed_at
-- continues to make the code permanently unavailable.
create or replace function private.guard_premium_code_identity_and_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.code is distinct from new.code
     or old.product_id is distinct from new.product_id then
    if exists (
      select 1
      from public.user_product_unlocks u
      where u.premium_code_id = old.id
    ) then
      raise exception using
        errcode = '23514',
        constraint = 'premium_codes_referenced_identity_immutable',
        message = 'A premium code referenced by an unlock cannot change its code or product.';
    end if;
  end if;

  if old.redeemed_at is not null then
    if new.redeemed_at is distinct from old.redeemed_at then
      raise exception using
        errcode = '23514',
        constraint = 'premium_codes_redemption_immutable',
        message = 'A redeemed premium code cannot be made available again.';
    end if;

    if new.redeemed_by is distinct from old.redeemed_by
       and new.redeemed_by is not null then
      raise exception using
        errcode = '23514',
        constraint = 'premium_codes_redemption_immutable',
        message = 'A redeemed premium code cannot be assigned to another account.';
    end if;
  elsif new.redeemed_at is not null then
    if new.redeemed_by is null or not exists (
      select 1
      from public.user_product_unlocks u
      where u.user_id = new.redeemed_by
        and u.product_id = new.product_id
        and u.premium_code_id = new.id
    ) then
      raise exception using
        errcode = '23514',
        constraint = 'premium_codes_redemption_requires_unlock',
        message = 'A premium code can only be marked redeemed by its matching account unlock.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_premium_code_identity_and_redemption() from public;

create trigger premium_codes_identity_and_redemption_guard
before update of code, product_id, redeemed_by, redeemed_at
on public.premium_codes
for each row
execute function private.guard_premium_code_identity_and_redemption();

-- Lock the code row before inspecting or claiming it. The entitlement's unique
-- (user_id, product_id) key serializes simultaneous scans of different codes
-- by the same account: only the request that inserts the entitlement claims a
-- code, and losing retries return already_unlocked without consuming theirs.
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

  if matching_code.redeemed_at is not null then
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
