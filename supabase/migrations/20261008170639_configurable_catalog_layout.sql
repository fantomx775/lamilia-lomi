create table public.catalog_settings (
  id text primary key default 'global' check (id = 'global'),
  desktop_columns smallint not null default 4
    constraint catalog_settings_desktop_columns_check
    check (desktop_columns in (3, 4, 5))
);

insert into public.catalog_settings (id, desktop_columns)
values ('global', 4)
on conflict (id) do nothing;

alter table public.catalog_settings enable row level security;

revoke all on table public.catalog_settings from public, anon, authenticated;
grant select on table public.catalog_settings to anon, authenticated;
grant update on table public.catalog_settings to authenticated;

create policy "catalog_settings_public_select"
  on public.catalog_settings for select
  to anon, authenticated
  using (true);

create policy "catalog_settings_admin_update"
  on public.catalog_settings for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
