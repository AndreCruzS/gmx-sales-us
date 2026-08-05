-- Phase 7 tests · 10: HubSpot sync substrate (spec 2026-08-05 task 1) — the
-- enum value, link columns, per-stream cursors/snapshots/errors tables, and
-- the vault secret accessor. Gate: schema exists, sync-state tables are
-- default-deny under RLS (server-side machinery only), and the secret
-- accessor is service_role-only. Follows the fixture prologue of
-- 07_exceptions.test.sql (seeded org + persona, tests.set_claims +
-- set local role authenticated).
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- enum gained the provider value
select ok(
  'hubspot' = any (enum_range(null::integration_provider)::text[]),
  'integration_provider has hubspot');

-- link columns
select has_column('public', 'accounts',      'hubspot_id', 'accounts.hubspot_id');
select has_column('public', 'contacts',      'hubspot_id', 'contacts.hubspot_id');
select has_column('public', 'opportunities', 'hubspot_id', 'opportunities.hubspot_id');
select has_column('public', 'activities',    'hubspot_id', 'activities.hubspot_id');
select has_column('public', 'next_actions',  'hubspot_id', 'next_actions.hubspot_id');

select has_table('public', 'hubspot_sync_cursors',   'cursors table');
select has_table('public', 'hubspot_sync_snapshots', 'snapshots table');
select has_table('public', 'hubspot_sync_errors',    'errors table');

-- default-deny: an authenticated caller sees nothing (no policies exist)
select tests.set_claims('tj@gmxgroup.com', 'gmx-us');
set local role authenticated;
select is_empty(
  $$ select * from hubspot_sync_errors $$,
  'sync errors invisible to authenticated');
select is_empty(
  $$ select * from hubspot_sync_cursors $$,
  'cursors invisible to authenticated');
select is_empty(
  $$ select * from hubspot_sync_snapshots $$,
  'snapshots invisible to authenticated');
reset role;

-- secret accessor exists and authenticated cannot execute it
select has_function('public', 'get_integration_secret', array['text']);
select throws_like(
  $$ set local role authenticated;
     select public.get_integration_secret('x') $$,
  '%permission denied%',
  'get_integration_secret denied to authenticated');

select * from finish();
rollback;
