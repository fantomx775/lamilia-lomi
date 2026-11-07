begin;

-- Keep historical code IDs for existing entitlements, and reserve old printed
-- strings so an inactive QR cannot start granting access again.
alter table public.premium_codes
  add column retired_at timestamptz,
  add constraint premium_codes_retired_inactive_check
    check (retired_at is null or (code_type = 'shared' and not active));

drop index public.premium_codes_one_shared_per_product;
create unique index premium_codes_one_shared_per_product
  on public.premium_codes (product_id) where code_type = 'shared' and retired_at is null;

create function private.guard_retired_premium_code()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.retired_at is not null and new.retired_at is distinct from old.retired_at then
    raise exception using errcode = '23514', message = 'A retired premium code cannot be restored.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_retired_premium_code() from public, anon, authenticated;
create trigger premium_codes_retired_identity_guard
before update of retired_at on public.premium_codes
for each row execute function private.guard_retired_premium_code();

create or replace function private.manage_shared_premium_code(
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
  where product_id = requested_product_id and code_type = 'shared' and retired_at is null for update;
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
create function private.retire_shared_premium_code(requested_product_id uuid, requested_code_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(requested_product_id::text, 0));
  perform 1 from public.products where id = requested_product_id for update;

  update public.premium_codes
  set active = false, retired_at = clock_timestamp()
  where id = requested_code_id and product_id = requested_product_id
    and code_type = 'shared' and retired_at is null;
  return found;
end;
$$;
revoke all on function private.retire_shared_premium_code(uuid, uuid) from public, anon;
grant execute on function private.retire_shared_premium_code(uuid, uuid) to authenticated;

create function public.retire_shared_premium_code(requested_product_id uuid, requested_code_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select private.retire_shared_premium_code(requested_product_id, requested_code_id);
$$;
revoke all on function public.retire_shared_premium_code(uuid, uuid) from public, anon;
grant execute on function public.retire_shared_premium_code(uuid, uuid) to authenticated;

commit;
