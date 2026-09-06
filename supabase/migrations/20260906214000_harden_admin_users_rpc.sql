-- The admin user RPC performs its own admin check, but anonymous callers do
-- not need execute access to an administrator-only function.
revoke execute on function public.list_admin_users() from public, anon;
grant execute on function public.list_admin_users() to authenticated;
