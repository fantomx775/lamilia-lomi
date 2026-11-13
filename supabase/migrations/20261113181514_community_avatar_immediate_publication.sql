-- Compatible with the deployed avatar contract: approved now means published.
-- Historical pending and rejected photos remain unpublished; never mass approve.
create or replace function public.community_avatar_finalize(p_user uuid, p_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.community_actor_is_verified(p_user) then
    raise exception using errcode = '42501', message = 'verified member required';
  end if;
  perform 1 from public.community_profiles
  where user_id = p_user and is_adult and opted_in_at is not null
    and participation_revoked_at is null and suspended_at is null and rules_version = '2026-10-25-v1'
  for update;
  if not found then raise exception using errcode = '42501', message = 'active member required'; end if;
  perform 1 from public.community_profile_avatars where id = p_id and user_id = p_user and status = 'uploading'
    and created_at > clock_timestamp() - interval '2 minutes' for update;
  if not found then raise exception using errcode = '40001', message = 'photo upload expired or removed'; end if;
  delete from public.community_profile_avatars where user_id = p_user and status in ('pending', 'rejected', 'approved');
  update public.community_profile_avatars set status = 'approved' where id = p_id;
end;
$$;


create table public.community_avatar_reports (
  avatar_id uuid not null references public.community_profile_avatars(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('rights', 'privacy', 'harmful', 'other')),
  details text not null default '' check (char_length(details) <= 500),
  created_at timestamptz not null default now(),
  primary key (avatar_id, reporter_id)
);
alter table public.community_avatar_reports enable row level security;
revoke all on public.community_avatar_reports from public, anon, authenticated;
grant select, insert, delete on public.community_avatar_reports to service_role;
create index community_avatar_reports_reporter_idx on public.community_avatar_reports(reporter_id);

create function public.community_avatar_report(p_actor uuid, p_id uuid, p_reason text, p_details text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_inserted integer;
begin
  if not private.community_actor_is_verified(p_actor) then
    raise exception using errcode = '42501', message = 'verified account required';
  end if;
  perform 1 from public.community_profile_avatars a join public.community_profiles p on p.user_id = a.user_id
    where a.id = p_id and a.status = 'approved' and p.is_adult and p.opted_in_at is not null
      and p.participation_revoked_at is null and p.suspended_at is null and p.rules_version = '2026-10-25-v1'
      and private.community_avatar_owner_is_verified(a.user_id) for share of a;
  if not found then raise exception using errcode = '40001', message = 'photo no longer available'; end if;
  insert into public.community_avatar_reports(avatar_id, reporter_id, reason, details)
    values (p_id, p_actor, p_reason, p_details) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 0;
end;
$$;
revoke all on function public.community_avatar_report(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.community_avatar_report(uuid, uuid, text, text) to service_role;

-- One bounded request for the creators shown on a gallery page. Only verified,
-- participating owners' published IDs leave this server-only function.
create function public.community_public_avatar_ids(p_usernames text[])
returns table(username text, avatar_id uuid)
language sql stable security invoker set search_path = '' as $$
  select p.username, a.id
  from public.community_profiles p
  join public.community_profile_avatars a on a.user_id = p.user_id and a.status = 'approved'
  where cardinality(p_usernames) <= 100 and p.username = any(p_usernames)
    and p.is_adult and p.opted_in_at is not null and p.participation_revoked_at is null
    and p.suspended_at is null and p.rules_version = '2026-10-25-v1'
    and private.community_avatar_owner_is_verified(p.user_id);
$$;
revoke all on function public.community_public_avatar_ids(text[]) from public, anon, authenticated;
grant execute on function public.community_public_avatar_ids(text[]) to service_role;
