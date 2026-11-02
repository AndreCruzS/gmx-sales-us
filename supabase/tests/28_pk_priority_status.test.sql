-- PK follow-up · tests 28 (20261102120000_pk_priority_status.sql).
--
-- 1. next_actions carry a priority, an action-required and a progress.
-- 2. Done and Eliminate both close the item through completed_at, kept in sync.
-- 3. A member who moves a status or the priority is stamped on the row.

begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_type('public', 'next_action_priority', 'priority enum exists');
select has_type('public', 'next_action_required', 'action-required enum exists');
select has_type('public', 'next_action_progress', 'progress enum exists');
select col_default_is('public', 'next_actions', 'action_required', 'NONE'::next_action_required,
  'action_required defaults to NONE');
select col_default_is('public', 'next_actions', 'progress', 'NOT_STARTED'::next_action_progress,
  'progress defaults to NOT_STARTED');
select col_is_null('public', 'next_actions', 'priority', 'priority is optional');

-- A completed row always reads DONE (the backfill, and the same rule on insert).
select is(
  (select count(*) from next_actions where completed_at is not null and progress <> 'DONE'),
  0::bigint, 'every completed row reads DONE');

-- Fixtures, written as the service role (no membership, so no stamping).
insert into next_actions (id, org_id, action, owner_id, due_date) values
  ('e0000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   'Item one', 'c0000000-0000-0000-0000-000000000001', current_date + 3),
  ('e0000000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111',
   'Item two', 'c0000000-0000-0000-0000-000000000001', current_date + 3),
  ('e0000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111',
   'Item three', 'c0000000-0000-0000-0000-000000000001', current_date + 3);

-- progress -> DONE closes the item; leaving DONE reopens it.
update next_actions set progress = 'DONE' where id = 'e0000000-0000-0000-0000-0000000000b1';
select isnt(
  (select completed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000b1'),
  null, 'progress DONE sets completed_at');
update next_actions set progress = 'WORKING_ON_IT' where id = 'e0000000-0000-0000-0000-0000000000b1';
select is(
  (select completed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000b1'),
  null, 'leaving DONE clears completed_at');

-- completed_at set alone (home "done") makes progress DONE, and back.
update next_actions set completed_at = now() where id = 'e0000000-0000-0000-0000-0000000000b2';
select is(
  (select progress from next_actions where id = 'e0000000-0000-0000-0000-0000000000b2'),
  'DONE'::next_action_progress, 'completed_at alone sets progress DONE');
update next_actions set completed_at = null where id = 'e0000000-0000-0000-0000-0000000000b2';
select is(
  (select progress from next_actions where id = 'e0000000-0000-0000-0000-0000000000b2'),
  'NOT_STARTED'::next_action_progress, 'clearing completed_at reopens a DONE item');

-- Eliminate closes the item and drops the days.
update next_actions set priority = 'PLAN', priority_days = 7
 where id = 'e0000000-0000-0000-0000-0000000000b3';
update next_actions set priority = 'ELIMINATE' where id = 'e0000000-0000-0000-0000-0000000000b3';
select isnt(
  (select completed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000b3'),
  null, 'ELIMINATE sets completed_at');
select is(
  (select priority_days from next_actions where id = 'e0000000-0000-0000-0000-0000000000b3'),
  null, 'ELIMINATE nulls priority_days');
select is(
  (select progress from next_actions where id = 'e0000000-0000-0000-0000-0000000000b3'),
  'NOT_STARTED'::next_action_progress, 'ELIMINATE leaves progress alone');
update next_actions set priority = 'PLAN', priority_days = 7
 where id = 'e0000000-0000-0000-0000-0000000000b3';
select is(
  (select completed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000b3'),
  null, 'leaving ELIMINATE clears completed_at');

-- ...unless the item is DONE.
update next_actions set priority = 'ELIMINATE', progress = 'DONE'
 where id = 'e0000000-0000-0000-0000-0000000000b3';
update next_actions set priority = 'PLAN' where id = 'e0000000-0000-0000-0000-0000000000b3';
select isnt(
  (select completed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000b3'),
  null, 'leaving ELIMINATE keeps completed_at when progress is DONE');

-- Service role leaves no stamp.
select is(
  (select last_changed_by from next_actions where id = 'e0000000-0000-0000-0000-0000000000b2'),
  null, 'no signed-in member, no stamp');

-- A signed-in admin changing action_required is stamped.
select tests.set_claims('bianca@gmxgroup.com', 'gmx-us');
set local role authenticated;
update next_actions set action_required = 'AWAITING_RESPONSE'
 where id = 'e0000000-0000-0000-0000-0000000000b2';
select is(
  (select last_changed_by from next_actions where id = 'e0000000-0000-0000-0000-0000000000b2'),
  'c0000000-0000-0000-0000-000000000001'::uuid, 'a status change stamps last_changed_by');
select isnt(
  (select last_changed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000b2'),
  null, 'a status change stamps last_changed_at');
reset role;

select throws_ok(
  $$ update next_actions set priority_days = -1
      where id = 'e0000000-0000-0000-0000-0000000000b2' $$,
  '23514', null, 'priority_days cannot be negative');

select * from finish();
rollback;
