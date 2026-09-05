-- Keep the admin user list independent of a rotatable Auth service key.
create or replace function public.list_admin_users()
returns table (
  id uuid,
  email text,
  role text,
  email_verified boolean,
  marketing_consent boolean,
  unlock_count bigint,
  unlocked_products text[]
)
language sql
security definer
set search_path = public, auth, private, pg_temp
as $$
  select
    u.id,
    coalesce(u.email, ''),
    case when p.role = 'admin' then 'admin' else 'user' end,
    u.email_confirmed_at is not null,
    coalesce(p.marketing_consent, false),
    count(distinct unlock.id),
    coalesce(
      array_agg(distinct translation.title order by translation.title)
        filter (where translation.title is not null),
      '{}'::text[]
    )
  from auth.users as u
  left join public.profiles as p on p.id = u.id
  left join public.user_product_unlocks as unlock on unlock.user_id = u.id
  left join public.product_translations as translation
    on translation.product_id = unlock.product_id
   and translation.locale = 'en'
  where (select private.is_admin())
  group by u.id, u.email, u.email_confirmed_at, u.created_at, p.role, p.marketing_consent
  order by u.created_at desc;
$$;

revoke all on function public.list_admin_users() from public;
grant execute on function public.list_admin_users() to authenticated;
