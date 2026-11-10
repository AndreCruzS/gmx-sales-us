-- Deadline urgency · tests 36 (20261110120000).
--
-- The deadline decides urgency; the database mirrors src/lib/domain/deadline.ts.
-- Business days walk Mon-Fri only. derive_priority may say ELIMINATE (display);
-- stored_priority and the nightly recompute never do.

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select has_column('public', 'next_actions', 'important', 'next_actions has important');

-- 2026-11-13 is a Friday, 2026-11-14 a Saturday.
select is(private.add_business_days('2026-11-13', 2), '2026-11-17'::date, 'Fri + 2 business days = Tue');
select is(private.add_business_days('2026-11-14', 2), '2026-11-17'::date, 'Sat + 2 business days = Tue');
select is(private.add_business_days('2026-11-14', 0), '2026-11-16'::date, 'Sat + 0 rolls to Mon');
select is(private.business_days_until('2026-11-13', '2026-11-17'), 2, 'Fri to Tue is 2 business days');
select is(private.business_days_until('2026-11-17', '2026-11-13'), -2, 'Tue to the Fri before is 2 late');

select is(private.derive_priority(false, '2026-11-11', '2026-11-10', false),
  'PLAN'::next_action_priority, 'urgent, not important, rep: Plan');
select is(private.derive_priority(false, '2026-11-11', '2026-11-10', true),
  'DELEGATE'::next_action_priority, 'urgent, not important, admin/support: Delegate');
select is(private.derive_priority(true, '2026-11-11', '2026-11-10', false),
  'DO_NOW'::next_action_priority, 'urgent and important: Do now');
select is(private.derive_priority(false, '2026-12-30', '2026-11-10', false),
  'ELIMINATE'::next_action_priority, 'neither: Eliminate (display only)');
select is(private.derive_priority(null, '2026-11-11', '2026-11-10', false),
  null, 'important unknown: no priority');
select is(private.stored_priority(false, '2026-12-30', '2026-11-10', false),
  'PLAN'::next_action_priority, 'stored: Eliminate becomes Plan for a rep');
select is(private.stored_priority(false, '2026-12-30', '2026-11-10', true),
  'DELEGATE'::next_action_priority, 'stored: Eliminate becomes Delegate for an admin owner');

-- Rows (the rep is c..03, the admin c..01). Postgres role: no member signed in.
insert into next_actions (id, org_id, action, owner_id, due_date, kind, priority, important) values
  ('e3600000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Old rep delegate', 'c0000000-0000-0000-0000-000000000003',
   (now() at time zone 'America/Los_Angeles')::date + 30, 'OTHER', 'DELEGATE', false),
  ('e3600000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Important and soon', 'c0000000-0000-0000-0000-000000000003',
   (now() at time zone 'America/Los_Angeles')::date + 1, 'OTHER', 'PLAN', true),
  ('e3600000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Not important, far off', 'c0000000-0000-0000-0000-000000000003',
   (now() at time zone 'America/Los_Angeles')::date + 30, 'OTHER', 'PLAN', false),
  ('e3600000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Admin item, urgent, not important', 'c0000000-0000-0000-0000-000000000001',
   (now() at time zone 'America/Los_Angeles')::date + 1, 'OTHER', 'PLAN', false),
  ('e3600000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'Undecided', 'c0000000-0000-0000-0000-000000000003',
   (now() at time zone 'America/Los_Angeles')::date + 1, 'OTHER', null, null);

select set_config('t.stamp_before',
  (select updated_at::text from next_actions where id = 'e3600000-0000-0000-0000-000000000002'), true);

select ok(private.recompute_priorities() >= 3, 'recompute returns the rows it changed');

select is(
  (select priority::text from next_actions where id = 'e3600000-0000-0000-0000-000000000001'),
  'PLAN', 'a rep-owned Delegate reads Plan');
select is(
  (select priority::text || '/' || (completed_at is null)::text from next_actions
    where id = 'e3600000-0000-0000-0000-000000000003'),
  'PLAN/true', 'not important and far off: Plan, and not closed');

select is(
  (select priority::text from next_actions where id = 'e3600000-0000-0000-0000-000000000002'),
  'DO_NOW', 'important and due within 2 business days: Do now');
select is(
  (select priority::text from next_actions where id = 'e3600000-0000-0000-0000-000000000004'),
  'DELEGATE', 'an admin owner keeps Delegate for urgent and not important');
select is(
  (select priority::text from next_actions where id = 'e3600000-0000-0000-0000-000000000005'),
  null, 'important unknown stays without a priority');
select is(
  (select updated_at::text from next_actions where id = 'e3600000-0000-0000-0000-000000000002'),
  current_setting('t.stamp_before'), 'recompute leaves updated_at alone');

select ok(
  not exists (select 1 from pg_extension where extname = 'pg_cron')
  or exists (select 1 from cron.job where jobname = 'recompute-priorities' and schedule = '0 9 * * *'),
  'the nightly job is scheduled where cron exists');

select * from finish();
rollback;
