-- Additive, service-only aggregate. Existing deployed queries keep working.
create function public.community_moderation_counts(p_product_id uuid default null, p_creator_prefix text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'pending', count(*) filter (where a.status = 'pending'),
    'approved', count(*) filter (where a.status = 'approved'),
    'rejected', count(*) filter (where a.status = 'rejected'),
    'removed', count(*) filter (where a.status = 'removed'))
  from public.community_artworks a
  where a.deleted_at is null
    and (p_product_id is null or a.product_id = p_product_id)
    and (p_creator_prefix is null or exists (
      select 1 from public.community_profiles cp where cp.user_id = a.author_id
        and cp.username ilike replace(replace(replace(p_creator_prefix, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'));
$$;
revoke all on function public.community_moderation_counts(uuid, text) from public, anon, authenticated;
grant execute on function public.community_moderation_counts(uuid, text) to service_role;
