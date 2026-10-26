-- Focused security and lifecycle coverage for the additive #85 migrations.
-- Run only against the named disposable local Supabase database. The full
-- fixture set, including Auth deletion and hard-delete checks, rolls back.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT plan(86);

INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('85000000-0000-4000-8000-000000000001', 'cc85-author@example.test', now(), '{}', '{}'),
  ('85000000-0000-4000-8000-000000000002', 'cc85-mail@example.test', now(), '{}', '{}'),
  ('85000000-0000-4000-8000-000000000003', 'cc85-admin@example.test', now(), '{}', '{}'),
  ('85000000-0000-4000-8000-000000000004', 'cc85-erasure@example.test', now(), '{}', '{}'),
  ('85000000-0000-4000-8000-000000000005', 'cc85-nonmember-reporter@example.test', now(), '{}', '{}'),
  ('85000000-0000-4000-8000-000000000006', 'cc85-user@example.test', now(), '{}', '{}');
INSERT INTO public.profiles (id, email, role)
VALUES
  ('85000000-0000-4000-8000-000000000001', 'cc85-author@example.test', 'user'),
  ('85000000-0000-4000-8000-000000000002', 'cc85-mail@example.test', 'user'),
  ('85000000-0000-4000-8000-000000000003', 'cc85-admin@example.test', 'admin'),
  ('85000000-0000-4000-8000-000000000004', 'cc85-erasure@example.test', 'user'),
  ('85000000-0000-4000-8000-000000000005', 'cc85-nonmember-reporter@example.test', 'user'),
  ('85000000-0000-4000-8000-000000000006', 'cc85-user@example.test', 'user')
ON CONFLICT (id) DO UPDATE SET role = excluded.role;

INSERT INTO public.products (id, slug, status, audience, product_type)
VALUES
  ('85111111-1111-4111-8111-111111111111', 'cc85-report-fixture', 'published', 'kids', 'coloring_book'),
  ('85222222-2222-4222-8222-222222222222', 'cc85-erasure-fixture', 'published', 'adults', 'coloring_book'),
  ('85333333-3333-4333-8333-333333333333', 'cc85-delete-fixture', 'published', 'kids', 'coloring_book'),
  ('85444444-4444-4444-8444-444444444444', 'cc85-referenced-art-fixture', 'published', 'kids', 'coloring_book'),
  ('85555555-5555-4555-8555-555555555555', 'cc85-referenced-reservation-fixture', 'published', 'kids', 'coloring_book'),
  ('85666666-6666-4666-8666-666666666666', 'cc85-legacy-delete-fixture', 'draft', 'adults', 'coloring_book');

CREATE TEMP TABLE cc85_ids (key text PRIMARY KEY, id uuid NOT NULL);
CREATE TEMP TABLE cc85_outbox_claim (
  moderation_event_id bigint, author_user_id uuid, notification_type text,
  attempt_count integer, first_attempt_at timestamptz, payload_fingerprint text,
  template_version text
);
CREATE TEMP TABLE cc85_cleanup_claim (
  id bigint, storage_provider text, storage_path text, lease_token uuid
);
CREATE TEMP TABLE cc85_expected_cleanup_lease (lease_expires_at timestamptz NOT NULL);
GRANT ALL ON cc85_ids, cc85_outbox_claim, cc85_cleanup_claim, cc85_expected_cleanup_lease TO service_role;
INSERT INTO public.user_product_unlocks (user_id, product_id) VALUES
  ('85000000-0000-4000-8000-000000000001', '85111111-1111-4111-8111-111111111111'),
  ('85000000-0000-4000-8000-000000000002', '85111111-1111-4111-8111-111111111111'),
  ('85000000-0000-4000-8000-000000000004', '85222222-2222-4222-8222-222222222222'),
  ('85000000-0000-4000-8000-000000000001', '85333333-3333-4333-8333-333333333333');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.community_artwork_reports'::regclass), 'reports have RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.community_artwork_report_events'::regclass), 'report history has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.community_moderation_email_outbox'::regclass), 'notification outbox has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.community_account_media_cleanup_jobs'::regclass), 'account cleanup ledger has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.community_product_deletion_markers'::regclass), 'product deletion markers have RLS enabled');
SELECT ok(NOT has_table_privilege('anon', 'public.community_artwork_reports', 'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated', 'public.community_artwork_reports', 'SELECT,INSERT,UPDATE,DELETE'), 'report rows are inaccessible through the Data API');
SELECT ok(NOT has_table_privilege('anon', 'public.community_artwork_report_events', 'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated', 'public.community_artwork_report_events', 'SELECT,INSERT,UPDATE,DELETE'), 'report history is inaccessible through the Data API');
SELECT ok(NOT has_table_privilege('anon', 'public.community_moderation_email_outbox', 'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated', 'public.community_moderation_email_outbox', 'SELECT,INSERT,UPDATE,DELETE'), 'outbox is inaccessible through the Data API');
SELECT ok(NOT has_table_privilege('anon', 'public.community_account_media_cleanup_jobs', 'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated', 'public.community_account_media_cleanup_jobs', 'SELECT,INSERT,UPDATE,DELETE'), 'account cleanup ledger is inaccessible through the Data API');
SELECT ok(NOT has_table_privilege('anon', 'public.community_product_deletion_markers', 'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated', 'public.community_product_deletion_markers', 'SELECT,INSERT,UPDATE,DELETE'), 'product deletion markers are inaccessible through the Data API');
SELECT ok(has_table_privilege('service_role', 'public.community_artwork_reports', 'SELECT,INSERT,UPDATE,DELETE'), 'service role can process private reports');
SELECT ok(has_table_privilege('service_role', 'public.community_moderation_email_outbox', 'SELECT,INSERT,UPDATE,DELETE'), 'service role can process the outbox');
SELECT ok(has_table_privilege('service_role', 'public.community_account_media_cleanup_jobs', 'SELECT,INSERT,UPDATE,DELETE'), 'service role can process the cleanup ledger');
SELECT ok(NOT has_function_privilege('anon', 'public.community_create_artwork_report(uuid,uuid,text,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.community_create_artwork_report(uuid,uuid,text,text)', 'EXECUTE') AND has_function_privilege('service_role', 'public.community_create_artwork_report(uuid,uuid,text,text)', 'EXECUTE'), 'report mutation is server-only');
SELECT ok(NOT has_function_privilege('anon', 'public.community_update_artwork_report(uuid,uuid,integer,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.community_update_artwork_report(uuid,uuid,integer,text)', 'EXECUTE') AND has_function_privilege('service_role', 'public.community_update_artwork_report(uuid,uuid,integer,text)', 'EXECUTE'), 'report moderation is server-only');
SELECT ok(NOT has_function_privilege('anon', 'public.community_claim_moderation_email_outbox(uuid,integer)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.community_claim_moderation_email_outbox(uuid,integer)', 'EXECUTE') AND has_function_privilege('service_role', 'public.community_claim_moderation_email_outbox(uuid,integer)', 'EXECUTE'), 'notification claims are service-only');
SELECT ok(NOT has_function_privilege('anon', 'public.community_claim_account_media_cleanup(uuid,integer)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.community_claim_account_media_cleanup(uuid,integer)', 'EXECUTE') AND has_function_privilege('service_role', 'public.community_claim_account_media_cleanup(uuid,integer)', 'EXECUTE'), 'account cleanup claims are service-only');
SELECT ok(NOT has_function_privilege('anon', 'public.community_begin_product_deletion(uuid)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.community_begin_product_deletion(uuid)', 'EXECUTE'), 'product deletion fence is authenticated-admin-only');
SELECT ok(NOT has_function_privilege('anon', 'public.community_finalize_product_deletion(uuid)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.community_finalize_product_deletion(uuid)', 'EXECUTE'), 'product deletion finalizer is authenticated-admin-only');
SELECT ok(NOT has_table_privilege('service_role', 'auth.users', 'SELECT'), 'service role still cannot read Auth rows directly');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.community_account_media_cleanup_jobs'::regclass
    AND constraint_row.confrelid IN ('auth.users'::regclass, 'public.community_profiles'::regclass, 'public.community_upload_reservations'::regclass)
), 'account cleanup paths survive identity and reservation cascades');

SET LOCAL ROLE service_role;
SELECT is(public.community_join('85000000-0000-4000-8000-000000000001', 'cc85_author', true, '2026-10-25-v1'), '85000000-0000-4000-8000-000000000001'::uuid, 'report target author joins');
SELECT is(public.community_join('85000000-0000-4000-8000-000000000002', 'cc85_mail', true, '2026-10-25-v1'), '85000000-0000-4000-8000-000000000002'::uuid, 'notification author joins');
SELECT is(public.community_join('85000000-0000-4000-8000-000000000004', 'cc85_erasure', true, '2026-10-25-v1'), '85000000-0000-4000-8000-000000000004'::uuid, 'account deletion author joins');

INSERT INTO cc85_ids
SELECT 'report_artwork', public.community_create_pending_artwork(
  '85000000-0000-4000-8000-000000000001', '85111111-1111-4111-8111-111111111111',
  'community/85000000-0000-4000-8000-000000000001/85100000-0000-4000-8000-000000000001',
  'supabase', 'image/webp', 800, 'A reportable artwork', '85100000-0000-4000-8000-000000000001');
SELECT is(public.community_moderate_artwork('85000000-0000-4000-8000-000000000003', (SELECT id FROM cc85_ids WHERE key='report_artwork'), 1, 'approve', null), 2, 'moderator publishes the report target');

-- A verified reporter need not join the Club or unlock the book.
INSERT INTO cc85_ids (key, id)
SELECT 'report_id', (public.community_create_artwork_report(
  '85000000-0000-4000-8000-000000000005', (SELECT id FROM cc85_ids WHERE key='report_artwork'), 'privacy', 'Please review the visible identifier.'
)->>'reportId')::uuid;
SELECT is((public.community_create_artwork_report(
  '85000000-0000-4000-8000-000000000005', (SELECT id FROM cc85_ids WHERE key='report_artwork'), 'privacy', 'Changed duplicate text'
)->>'duplicate')::boolean, true, 'duplicate report is idempotent for a verified nonmember');
SELECT throws_ok($$SELECT public.community_create_artwork_report('85000000-0000-4000-8000-000000000005',(SELECT id FROM cc85_ids WHERE key='report_artwork'),null,'')$$, '22023', 'invalid report', 'null report reason is rejected');
SELECT throws_ok($$SELECT public.community_update_artwork_report('85000000-0000-4000-8000-000000000003',(SELECT id FROM cc85_ids WHERE key='report_id'),null,'resolve')$$, '22023', 'invalid report action', 'null report revision cannot bypass CAS');
SELECT throws_ok($$SELECT public.community_update_artwork_report('85000000-0000-4000-8000-000000000003',(SELECT id FROM cc85_ids WHERE key='report_id'),1,null)$$, '22023', 'invalid report action', 'null report action is rejected');
SELECT throws_ok($$SELECT public.community_update_artwork_report('85000000-0000-4000-8000-000000000003',(SELECT id FROM cc85_ids WHERE key='report_id'),2,'resolve')$$, '40001', 'report revision changed', 'stale report decision is rejected');
SELECT ok(NOT has_table_privilege('anon', 'public.community_artwork_reports', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.community_artwork_reports', 'SELECT'), 'neither anonymous nor signed-in clients can inspect report text or reporter IDs');

RESET ROLE;
-- This account is verified but deliberately has no community_profiles row.
DELETE FROM auth.users WHERE id='85000000-0000-4000-8000-000000000005';
SET LOCAL ROLE service_role;
SELECT ok((SELECT reporter_user_id IS NULL AND details = '' FROM public.community_artwork_reports WHERE id=(SELECT id FROM cc85_ids WHERE key='report_id')), 'Auth deletion anonymizes a nonmember reporter and clears their report text');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.community_artwork_report_events WHERE report_id=(SELECT id FROM cc85_ids WHERE key='report_id') AND actor_user_id='85000000-0000-4000-8000-000000000005'), 'Auth deletion removes nonmember reporter event identities');
SELECT is(public.community_update_artwork_report('85000000-0000-4000-8000-000000000003',(SELECT id FROM cc85_ids WHERE key='report_id'),1,'resolve'), 2, 'administrator can resolve the anonymized report');
UPDATE public.community_artwork_reports SET retention_expires_at=now()-interval '1 minute' WHERE id=(SELECT id FROM cc85_ids WHERE key='report_id');
SELECT is(public.community_purge_expired_report_details(10), 1, 'retention purge selects pre-anonymized reports with later admin event identities');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.community_artwork_report_events WHERE report_id=(SELECT id FROM cc85_ids WHERE key='report_id') AND actor_user_id IS NOT NULL), '30-day purge scrubs retained event actor links even when report identity was already null');
SELECT ok(EXISTS (SELECT 1 FROM public.community_artwork_report_events WHERE report_id=(SELECT id FROM cc85_ids WHERE key='report_id') AND action='retention_scrubbed'), 'retention leaves a non-identifying audit event');
SELECT throws_ok($$SELECT public.community_purge_expired_report_details(null)$$, '22023', 'invalid retention batch size', 'null retention batch size is rejected');
SELECT ok(NOT has_table_privilege('service_role', 'public.community_artwork_report_events', 'UPDATE') AND NOT has_table_privilege('service_role', 'public.community_artwork_report_events', 'DELETE'), 'report audit history stays append-only for the service role');

-- Exercise the outbox lease, idempotency horizon and provider retry state.
INSERT INTO cc85_ids
SELECT 'mail_artwork', public.community_create_pending_artwork(
  '85000000-0000-4000-8000-000000000002', '85111111-1111-4111-8111-111111111111',
  'community/85000000-0000-4000-8000-000000000002/85200000-0000-4000-8000-000000000001',
  'supabase', 'image/webp', 900, 'Private caption', '85200000-0000-4000-8000-000000000001');
SELECT is(public.community_moderate_artwork('85000000-0000-4000-8000-000000000003', (SELECT id FROM cc85_ids WHERE key='mail_artwork'), 1, 'reject', 'Private moderation reason'), 2, 'rejection decision is recorded');
INSERT INTO cc85_ids (key, id)
SELECT 'mail_event', event.id FROM public.community_moderation_events event
WHERE event.artwork_id=(SELECT id FROM cc85_ids WHERE key='mail_artwork') AND event.to_status='rejected';
SELECT ok((SELECT state='pending' AND notification_type='rejected' AND author_user_id='85000000-0000-4000-8000-000000000002'
  FROM public.community_moderation_email_outbox WHERE moderation_event_id=(SELECT id FROM cc85_ids WHERE key='mail_event')), 'rejection atomically creates one private notification intent');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='community_moderation_email_outbox'
    AND column_name IN ('email', 'description', 'reason', 'storage_path')
), 'outbox schema does not copy email, artwork text, moderation reason or media path');
SELECT throws_ok($$SELECT * FROM public.community_claim_moderation_email_outbox(null,10)$$, '22023', 'invalid notification claim', 'null notification lease token is rejected');
SELECT throws_ok($$SELECT * FROM public.community_claim_moderation_email_outbox('85300000-0000-4000-8000-000000000001',21)$$, '22023', 'invalid notification claim', 'notification claims are bounded');
INSERT INTO cc85_outbox_claim SELECT * FROM public.community_claim_moderation_email_outbox('85300000-0000-4000-8000-000000000001',10);
SELECT is((SELECT count(*) FROM cc85_outbox_claim), 1::bigint, 'worker claims a due notification under its lease token');
SELECT is(public.community_finish_moderation_email_send((SELECT id FROM cc85_ids WHERE key='mail_event'),'85300000-0000-4000-8000-000000000002','sent','msg-stale',null), false, 'stale worker token cannot mark delivery');
SELECT throws_ok($$SELECT public.community_prepare_moderation_email_send((SELECT id FROM cc85_ids WHERE key='mail_event'),'85300000-0000-4000-8000-000000000001',null,'community-v1')$$, '22023', 'invalid notification payload', 'null payload fingerprint is rejected');
SELECT is(public.community_prepare_moderation_email_send((SELECT id FROM cc85_ids WHERE key='mail_event'),'85300000-0000-4000-8000-000000000001',repeat('a',64),'community-v1'), true, 'current worker freezes the notification payload');
SELECT is(public.community_finish_moderation_email_send((SELECT id FROM cc85_ids WHERE key='mail_event'),'85300000-0000-4000-8000-000000000001','retry',null,'provider_error'), true, 'provider failure schedules retry instead of rolling back moderation');
SELECT ok((SELECT state='pending' AND attempt_count=1 AND next_attempt_at>now() FROM public.community_moderation_email_outbox WHERE moderation_event_id=(SELECT id FROM cc85_ids WHERE key='mail_event')), 'failed send returns to durable backoff queue');
UPDATE public.community_moderation_email_outbox SET next_attempt_at=now()-interval '1 second' WHERE moderation_event_id=(SELECT id FROM cc85_ids WHERE key='mail_event');
TRUNCATE cc85_outbox_claim;
INSERT INTO cc85_outbox_claim SELECT * FROM public.community_claim_moderation_email_outbox('85300000-0000-4000-8000-000000000003',10);
SELECT is((SELECT attempt_count FROM cc85_outbox_claim), 2, 'retry receives a fresh fenced lease');
SELECT is(public.community_prepare_moderation_email_send((SELECT id FROM cc85_ids WHERE key='mail_event'),'85300000-0000-4000-8000-000000000003',repeat('a',64),'community-v1'), true, 'retry must preserve the frozen payload fingerprint');
SELECT is(public.community_finish_moderation_email_send((SELECT id FROM cc85_ids WHERE key='mail_event'),'85300000-0000-4000-8000-000000000003','sent','provider-message-85',null), true, 'current lease can record provider acceptance');
SELECT ok((SELECT state='sent' AND provider_message_id='provider-message-85' AND attempt_count=2 FROM public.community_moderation_email_outbox WHERE moderation_event_id=(SELECT id FROM cc85_ids WHERE key='mail_event')), 'outbox records delivered state without changing artwork revision');
SELECT ok((SELECT revision=2 AND status='rejected' FROM public.community_artworks WHERE id=(SELECT id FROM cc85_ids WHERE key='mail_artwork')), 'notification retries never mutate moderation state');

INSERT INTO cc85_ids
SELECT 'horizon_artwork', public.community_create_pending_artwork(
  '85000000-0000-4000-8000-000000000002', '85111111-1111-4111-8111-111111111111',
  'community/85000000-0000-4000-8000-000000000002/85200000-0000-4000-8000-000000000002',
  'supabase', 'image/webp', 900, '', '85200000-0000-4000-8000-000000000002');
SELECT is(public.community_moderate_artwork('85000000-0000-4000-8000-000000000003', (SELECT id FROM cc85_ids WHERE key='horizon_artwork'), 1, 'reject', 'Another private reason'), 2, 'second moderation event enters the outbox');
INSERT INTO cc85_ids (key, id)
SELECT 'horizon_event', event.id FROM public.community_moderation_events event
WHERE event.artwork_id=(SELECT id FROM cc85_ids WHERE key='horizon_artwork') AND event.to_status='rejected';
TRUNCATE cc85_outbox_claim;
INSERT INTO cc85_outbox_claim SELECT * FROM public.community_claim_moderation_email_outbox('85300000-0000-4000-8000-000000000004',10);
SELECT is(public.community_prepare_moderation_email_send((SELECT id FROM cc85_ids WHERE key='horizon_event'),'85300000-0000-4000-8000-000000000004',repeat('b',64),'community-v1'), true, 'new event starts its provider idempotency horizon');
UPDATE public.community_moderation_email_outbox SET first_attempt_at=now()-interval '25 hours' WHERE moderation_event_id=(SELECT id FROM cc85_ids WHERE key='horizon_event');
SELECT is(public.community_prepare_moderation_email_send((SELECT id FROM cc85_ids WHERE key='horizon_event'),'85300000-0000-4000-8000-000000000004',repeat('b',64),'community-v1'), false, 'expired provider idempotency window cannot send again');
SELECT ok((SELECT state='uncertain' AND lease_token IS NULL FROM public.community_moderation_email_outbox WHERE moderation_event_id=(SELECT id FROM cc85_ids WHERE key='horizon_event')), 'expired notification is quarantined for manual review');

-- Create a rejected artwork plus an in-flight duplicate reservation. Auth
-- deletion must tombstone content and retain every possible private object key.
INSERT INTO cc85_ids
SELECT 'erase_artwork', public.community_create_pending_artwork(
  '85000000-0000-4000-8000-000000000004', '85222222-2222-4222-8222-222222222222',
  'community/85000000-0000-4000-8000-000000000004/85400000-0000-4000-8000-000000000001',
  'supabase', 'image/webp', 1000, 'Private caption to erase', '85400000-0000-4000-8000-000000000001');
SELECT is(public.community_moderate_artwork('85000000-0000-4000-8000-000000000003', (SELECT id FROM cc85_ids WHERE key='erase_artwork'), 1, 'reject', 'Private reason to erase'), 2, 'account artwork receives a private moderation event');
INSERT INTO cc85_ids (key, id)
SELECT 'erase_event', event.id FROM public.community_moderation_events event
WHERE event.artwork_id=(SELECT id FROM cc85_ids WHERE key='erase_artwork') AND event.to_status='rejected';
INSERT INTO public.community_upload_reservations (
  author_id, idempotency_key, product_id, storage_path, storage_provider, content_type,
  original_size_bytes, size_bytes, description, upload_fingerprint, lease_token, lease_expires_at
) VALUES
  ('85000000-0000-4000-8000-000000000004', '85400000-0000-4000-8000-000000000001', '85222222-2222-4222-8222-222222222222',
   'community/85000000-0000-4000-8000-000000000004/85400000-0000-4000-8000-000000000001', 'supabase', 'image/webp',
   1000, 900, 'Private caption to erase', repeat('c',64), '85400000-0000-4000-8000-000000000005', now()+interval '20 minutes'),
  ('85000000-0000-4000-8000-000000000004', '85400000-0000-4000-8000-000000000002', '85222222-2222-4222-8222-222222222222',
   'community/85000000-0000-4000-8000-000000000004/85400000-0000-4000-8000-000000000002', 'supabase', 'image/webp',
   1000, 900, '', repeat('d',64), '85400000-0000-4000-8000-000000000006', now()+interval '30 minutes');
INSERT INTO cc85_expected_cleanup_lease SELECT max(lease_expires_at) FROM public.community_upload_reservations WHERE author_id='85000000-0000-4000-8000-000000000004';
SELECT ok(NOT EXISTS (SELECT 1 FROM public.community_account_media_cleanup_jobs WHERE storage_path like 'community/85000000-0000-4000-8000-000000000004/%'), 'account media ledger is empty before Auth deletion');

RESET ROLE;
DELETE FROM auth.users WHERE id='85000000-0000-4000-8000-000000000004';
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*) FROM public.community_account_media_cleanup_jobs WHERE storage_path like 'community/85000000-0000-4000-8000-000000000004/%'), 2::bigint, 'Auth deletion queues artwork and in-flight reservation paths');
SELECT is((SELECT count(*) FROM public.community_account_media_cleanup_jobs WHERE storage_path='community/85000000-0000-4000-8000-000000000004/85400000-0000-4000-8000-000000000001'), 1::bigint, 'duplicate artwork and reservation path is deduplicated');
SELECT ok((SELECT min(not_before) >= (SELECT lease_expires_at + interval '2 minutes' FROM cc85_expected_cleanup_lease)
  FROM public.community_account_media_cleanup_jobs WHERE storage_path like 'community/85000000-0000-4000-8000-000000000004/%'), 'cleanup waits beyond the active writer lease plus safety margin');
SELECT ok((SELECT author_id IS NULL AND description='' AND moderation_reason IS NULL AND storage_path IS NULL AND deleted_at IS NOT NULL AND status='removed'
  FROM public.community_artworks WHERE id=(SELECT id FROM cc85_ids WHERE key='erase_artwork')), 'Auth deletion makes the artwork private and removes its identity/content/path');
SELECT ok((SELECT reason IS NULL FROM public.community_moderation_events WHERE id=(SELECT id FROM cc85_ids WHERE key='erase_event')), 'account deletion clears historical private moderation reason');
SELECT ok((SELECT state='suppressed' AND author_user_id IS NULL FROM public.community_moderation_email_outbox WHERE moderation_event_id=(SELECT id FROM cc85_ids WHERE key='erase_event')), 'account deletion suppresses and anonymizes pending notifications');
SELECT throws_ok($$SELECT * FROM public.community_claim_account_media_cleanup(null,10)$$, '22023', 'invalid account cleanup claim', 'null cleanup lease token is rejected');
SELECT throws_ok($$SELECT * FROM public.community_claim_account_media_cleanup('85500000-0000-4000-8000-000000000001',51)$$, '22023', 'invalid account cleanup claim', 'account cleanup claim is bounded');
TRUNCATE cc85_cleanup_claim;
INSERT INTO cc85_cleanup_claim SELECT * FROM public.community_claim_account_media_cleanup('85500000-0000-4000-8000-000000000002',50);
SELECT is((SELECT count(*) FROM cc85_cleanup_claim), 0::bigint, 'scheduler cannot delete bytes while the upload lease may still be active');
UPDATE public.community_account_media_cleanup_jobs SET not_before=now()-interval '1 second', next_attempt_at=now()-interval '1 second'
WHERE storage_path like 'community/85000000-0000-4000-8000-000000000004/%';
TRUNCATE cc85_cleanup_claim;
INSERT INTO cc85_cleanup_claim SELECT * FROM public.community_claim_account_media_cleanup('85500000-0000-4000-8000-000000000003',1);
SELECT is((SELECT count(*) FROM cc85_cleanup_claim), 1::bigint, 'bounded cleanup worker claims one eligible path');
SELECT is(public.community_finish_account_media_cleanup((SELECT id FROM cc85_cleanup_claim), '85500000-0000-4000-8000-000000000004', 'deleted'), false, 'stale cleanup token cannot acknowledge deletion');
SELECT is(public.community_finish_account_media_cleanup((SELECT id FROM cc85_cleanup_claim), '85500000-0000-4000-8000-000000000003', 'retry'), true, 'current cleanup token durably schedules retry');
SELECT ok((SELECT state='pending' AND lease_token IS NULL AND next_attempt_at>now() FROM public.community_account_media_cleanup_jobs WHERE id=(SELECT id FROM cc85_cleanup_claim)), 'cleanup retry releases lease and backs off');
UPDATE public.community_account_media_cleanup_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=(SELECT id FROM cc85_cleanup_claim);
TRUNCATE cc85_cleanup_claim;
INSERT INTO cc85_cleanup_claim SELECT * FROM public.community_claim_account_media_cleanup('85500000-0000-4000-8000-000000000005',1);
SELECT is(public.community_finish_account_media_cleanup((SELECT id FROM cc85_cleanup_claim), '85500000-0000-4000-8000-000000000005', 'deleted'), true, 'current retry lease can acknowledge provider deletion');
SELECT is((SELECT count(*) FROM public.community_account_media_cleanup_jobs WHERE id=(SELECT id FROM cc85_cleanup_claim)), 0::bigint, 'success removes only the acknowledged cleanup ledger job');

-- Product delete is explicitly fenced while private community references exist;
-- legacy deletion remains usable for products with no community references.
INSERT INTO public.community_artworks (id, author_id, product_id, storage_path, storage_provider, content_type, size_bytes, status, deleted_at)
VALUES ('85400000-0000-4000-8000-000000000010', null, '85444444-4444-4444-8444-444444444444', null, 'supabase', 'image/webp', 100, 'removed', now());
INSERT INTO public.community_upload_reservations (
  author_id, idempotency_key, product_id, storage_path, storage_provider, content_type,
  original_size_bytes, size_bytes, upload_fingerprint, lease_token
) VALUES (
  '85000000-0000-4000-8000-000000000001', '85500000-0000-4000-8000-000000000010', '85555555-5555-4555-8555-555555555555',
  'community/85000000-0000-4000-8000-000000000001/85500000-0000-4000-8000-000000000010', 'supabase', 'image/webp', 100, 100, repeat('e',64), '85500000-0000-4000-8000-000000000011'
);
SELECT set_config('request.jwt.claim.sub', '85000000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.community_begin_product_deletion('85333333-3333-4333-8333-333333333333')$$, '42501', 'Administrator access is required.', 'ordinary authenticated user cannot begin product deletion');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '85000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.community_begin_product_deletion(null)$$, '22023', 'Product identifier is required.', 'null product ID is rejected');
SELECT is((public.community_begin_product_deletion('85444444-4444-4444-8444-444444444444')->>'state'), 'community_references', 'even deleted artwork tombstones prevent hard deletion');
SELECT is((public.community_begin_product_deletion('85555555-5555-4555-8555-555555555555')->>'state'), 'community_references', 'unfinalized upload reservation prevents hard deletion');
SELECT is((public.community_begin_product_deletion('85333333-3333-4333-8333-333333333333')->>'state'), 'deleting', 'unreferenced product can enter fenced deletion');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE public.products SET status='archived' WHERE id='85333333-3333-4333-8333-333333333333'$$, '55000', 'Product deletion is already in progress.', 'product updates are blocked while deletion is fenced');
SELECT throws_ok($$SELECT public.community_reserve_upload('85000000-0000-4000-8000-000000000001','85600000-0000-4000-8000-000000000001','85333333-3333-4333-8333-333333333333','85600000-0000-4000-8000-000000000002',repeat('f',64),'supabase',100,100,'image/webp','')$$, '55000', 'Product deletion is already in progress.', 'upload reservations cannot race product deletion');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '85000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT is(public.community_finalize_product_deletion('85333333-3333-4333-8333-333333333333'), true, 'fenced finalizer removes the unreferenced product under the real admin JWT role');
SELECT is(public.community_finalize_product_deletion('85333333-3333-4333-8333-333333333333'), true, 'product finalization is idempotent after successful deletion');
SELECT is(public.delete_product('85666666-6666-4666-8666-666666666666'), true, 'legacy delete RPC remains compatible for unreferenced products without a marker');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
