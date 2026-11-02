-- PK follow-up · tests 28 (20261102120000_pk_priority_status.sql).
--
-- 1. next_actions carry a priority, an action-required and a progress.
-- 2. Done and Eliminate both close the item through completed_at, kept in sync.
-- 3. A member who moves a status or the priority is stamped on the row.

begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

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
  (select count(*) from next_actions where completed_at is not null and progress <> 'DONE'
      and priority is distinct from 'ELIMINATE'),
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

-- Two fields moving together: the closing timestamp wins.
insert into next_actions (id, org_id, action, owner_id, due_date, priority, completed_at) values
  ('e0000000-0000-0000-0000-0000000000b4', '11111111-1111-1111-1111-111111111111',
   'Item four', 'c0000000-0000-0000-0000-000000000001', current_date + 3, 'PLAN', now());
select is(
  (select progress from next_actions where id = 'e0000000-0000-0000-0000-0000000000b4'),
  'DONE'::next_action_progress, 'insert with priority and completed_at reads DONE');

insert into next_actions (id, org_id, action, owner_id, due_date) values
  ('e0000000-0000-0000-0000-0000000000b5', '11111111-1111-1111-1111-111111111111',
   'Item five', 'c0000000-0000-0000-0000-000000000001', current_date + 3),
  ('e0000000-0000-0000-0000-0000000000b6', '11111111-1111-1111-1111-111111111111',
   'Item six', 'c0000000-0000-0000-0000-000000000001', current_date + 3);
update next_actions set completed_at = now(), priority = 'DO_NOW'
 where id = 'e0000000-0000-0000-0000-0000000000b5';
select is(
  (select progress from next_actions where id = 'e0000000-0000-0000-0000-0000000000b5'),
  'DONE'::next_action_progress, 'completed_at and priority in one update read DONE');
update next_actions set completed_at = now(), progress = 'WORKING_ON_IT'
 where id = 'e0000000-0000-0000-0000-0000000000b6';
select is(
  (select progress from next_actions where id = 'e0000000-0000-0000-0000-0000000000b6'),
  'DONE'::next_action_progress, 'completed_at wins over a progress set in the same update');

-- Eliminated items: leaving DONE keeps them closed; a direct reopen leaves progress alone.
insert into next_actions (id, org_id, action, owner_id, due_date, priority, progress) values
  ('e0000000-0000-0000-0000-0000000000b7', '11111111-1111-1111-1111-111111111111',
   'Item seven', 'c0000000-0000-0000-0000-000000000001', current_date + 3, 'ELIMINATE', 'DONE');
update next_actions set progress = 'STUCK' where id = 'e0000000-0000-0000-0000-0000000000b7';
select isnt(
  (select completed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000b7'),
  null, 'leaving DONE while eliminated keeps completed_at');
update next_actions set completed_at = null where id = 'e0000000-0000-0000-0000-0000000000b7';
select is(
  (select completed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000b7'),
  null, 'an eliminated item can be reopened by clearing completed_at');
select is(
  (select progress from next_actions where id = 'e0000000-0000-0000-0000-0000000000b7'),
  'STUCK'::next_action_progress, 'reopening an eliminated item leaves progress alone');

-- One write leaving Eliminate and setting a new completed_at: the row is closed and Done.
insert into next_actions (id, org_id, action, owner_id, due_date, priority) values
  ('e0000000-0000-0000-0000-0000000000b9', '11111111-1111-1111-1111-111111111111',
   'Item nine', 'c0000000-0000-0000-0000-000000000001', current_date + 3, 'ELIMINATE');
update next_actions set priority = 'PLAN', completed_at = now() + interval '1 minute'
 where id = 'e0000000-0000-0000-0000-0000000000b9';
select is(
  (select progress from next_actions where id = 'e0000000-0000-0000-0000-0000000000b9'),
  'DONE'::next_action_progress, 'leaving ELIMINATE with a new completed_at reads DONE');
select isnt(
  (select completed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000b9'),
  null, 'leaving ELIMINATE with a new completed_at stays closed');

-- Service role leaves no stamp.
select is(
  (select last_changed_by from next_actions where id = 'e0000000-0000-0000-0000-0000000000b2'),
  null, 'no signed-in member, no stamp');
select is(
  (select last_changed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000b2'),
  null, 'no signed-in member, no stamp time either');

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
insert into next_actions (id, org_id, action, owner_id, due_date, priority) values
  ('e0000000-0000-0000-0000-0000000000b8', '11111111-1111-1111-1111-111111111111',
   'Item eight', 'c0000000-0000-0000-0000-000000000001', current_date + 3, 'PLAN');
select is(
  (select last_changed_by from next_actions where id = 'e0000000-0000-0000-0000-0000000000b8'),
  'c0000000-0000-0000-0000-000000000001'::uuid, 'a row inserted with a priority is stamped');
reset role;

-- A server write (no member) on a member-stamped row leaves both stamps alone.
select tests.clear_auth();
create temp table stamp_before as
  select last_changed_by, last_changed_at from next_actions
   where id = 'e0000000-0000-0000-0000-0000000000b2';
update next_actions set progress = 'STUCK' where id = 'e0000000-0000-0000-0000-0000000000b2';
select is(
  (select (last_changed_by, last_changed_at) from next_actions
    where id = 'e0000000-0000-0000-0000-0000000000b2'),
  (select (last_changed_by, last_changed_at) from stamp_before),
  'a server write leaves last_changed_by and last_changed_at unchanged');

select throws_ok(
  $$ update next_actions set priority_days = -1
      where id = 'e0000000-0000-0000-0000-0000000000b2' $$,
  '23514', null, 'priority_days cannot be negative');

select * from finish();
rollback;
