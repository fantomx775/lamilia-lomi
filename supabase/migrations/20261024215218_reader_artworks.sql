create table if not exists public.product_reader_artworks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  storage_path text not null unique,
  storage_provider text not null check (storage_provider in ('local', 'supabase', 'r2')),
  filename text not null,
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 4194304),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 240),
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_reader_artworks_public_order_idx
  on public.product_reader_artworks (product_id, is_visible, sort_order, id);

alter table public.product_reader_artworks enable row level security;
revoke all on public.product_reader_artworks from public, anon, authenticated;
grant select, insert, update, delete on public.product_reader_artworks to service_role;

create or replace function public.reorder_product_reader_artworks(
  requested_product_id uuid,
  ordered_ids uuid[]
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actual_count integer;
begin
  if ordered_ids is null then
    return false;
  end if;

  perform 1 from public.products where id = requested_product_id for update;
  if not found then
    return false;
  end if;

  select count(*) into actual_count
  from public.product_reader_artworks
  where product_id = requested_product_id;

  if actual_count <> coalesce(array_length(ordered_ids, 1), 0)
    or cardinality(ordered_ids) <> cardinality(array(select distinct unnest(ordered_ids)))
    or exists (
      select 1 from public.product_reader_artworks a
      where a.product_id = requested_product_id and not (a.id = any(ordered_ids))
    ) then
    return false;
  end if;

  update public.product_reader_artworks a
  set sort_order = array_position(ordered_ids, a.id) - 1, updated_at = now()
  where a.product_id = requested_product_id;
  return true;
end;
$$;

revoke all on function public.reorder_product_reader_artworks(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_product_reader_artworks(uuid, uuid[]) to service_role;
