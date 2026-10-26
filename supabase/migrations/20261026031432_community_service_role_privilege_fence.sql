-- Supabase default privileges can grant service_role broader table rights
-- than a later narrow GRANT implies. Revoke the full ACL before restoring the
-- exact append/worker permissions needed by these private community tables.
revoke all on public.community_moderation_events from public, anon, authenticated, service_role;
grant select, insert on public.community_moderation_events to service_role;
grant usage, select on sequence public.community_moderation_events_id_seq to service_role;

revoke all on public.community_artwork_report_events from public, anon, authenticated, service_role;
grant select, insert on public.community_artwork_report_events to service_role;
grant usage, select on sequence public.community_artwork_report_events_id_seq to service_role;

revoke all on public.community_moderation_email_outbox from public, anon, authenticated, service_role;
grant select, insert, update on public.community_moderation_email_outbox to service_role;
