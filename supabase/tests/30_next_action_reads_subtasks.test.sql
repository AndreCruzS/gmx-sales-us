-- PK follow-up · tests 30 (20261102140000_next_action_reads_subtasks.sql).
--
-- 1. A member upserts only their own read; an admin sees every member's read.
-- 2. Subtasks: stamped creator; writers are the item's owner side or an admin;
--    a rep who cannot see the item sees none and cannot add one.

begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select has_table('public', 'next_action_reads', 'reads table exists');
select has_table('public', 'next_action_subtasks', 'subtasks table exists');

-- Fixture: an item owned by Deon (c..04). TJ (c..03) cannot see it.
insert into next_actions (id, org_id, action, owner_id, due_date) values
  ('e0000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
   'Item with reads', 'c0000000-0000-0000-0000-000000000004', current_date + 3);

-- Service role (no member): the supplied creator stands.
insert into next_action_subtasks (id, org_id, next_action_id, title, created_by) values
  ('e2000000-0000-0000-0000-0000000000d0', '11111111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-0000000000d1', 'Imported step', 'c0000000-0000-0000-0000-000000000001');
select is(
  (select created_by from next_action_subtasks where id = 'e2000000-0000-0000-0000-0000000000d0'),
  'c0000000-0000-0000-0000-000000000001'::uuid, 'service role keeps the supplied created_by');

-- Deon upserts his own read, twice (insert then update).
select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;
insert into next_action_reads (org_id, membership_id, next_action_id, last_read_at) values
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000004',
   'e0000000-0000-0000-0000-0000000000d1', '2026-01-01 00:00+00')
on conflict (membership_id, next_action_id) do update set last_read_at = excluded.last_read_at;
insert into next_action_reads (org_id, membership_id, next_action_id, last_read_at) values
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000004',
   'e0000000-0000-0000-0000-0000000000d1', '2026-02-01 00:00+00')
on conflict (membership_id, next_action_id) do update set last_read_at = excluded.last_read_at;
select is(
  (select last_read_at from next_action_reads
    where membership_id = 'c0000000-0000-0000-0000-000000000004'),
  '2026-02-01 00:00+00'::timestamptz, 'a member upserts their own read');
select is(
  (select count(*) from next_action_reads), 1::bigint, 'the upsert left one row');

-- Writing a read for someone else is refused.
select throws_ok(
  $$ insert into next_action_reads (org_id, membership_id, next_action_id) values
       ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001',
        'e0000000-0000-0000-0000-0000000000d1') $$,
  '42501', null, 'a read for another membership is refused');

-- Deon cannot delete a read.
delete from next_action_reads;
reset role;
select is(
  (select count(*) from next_action_reads), 1::bigint, 'a delete removes no read');

-- Bianca (admin) leaves her own read and sees Deon's.
select tests.set_claims('bianca@gmxgroup.com', 'gmx-us');
set local role authenticated;
insert into next_action_reads (org_id, membership_id, next_action_id) values
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-0000000000d1');
select is(
  (select count(*) from next_action_reads
    where next_action_id = 'e0000000-0000-0000-0000-0000000000d1'),
  2::bigint, 'an admin sees both members reads');

-- Admin adds, ticks and deletes a subtask; creator is stamped.
insert into next_action_subtasks (id, org_id, next_action_id, title, created_by) values
  ('e2000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-0000000000d1', 'Call the branch', 'c0000000-0000-0000-0000-000000000004');
select is(
  (select created_by from next_action_subtasks where id = 'e2000000-0000-0000-0000-0000000000d1'),
  'c0000000-0000-0000-0000-000000000001'::uuid, 'created_by is the signed-in member');
update next_action_subtasks set done_at = now()
 where id = 'e2000000-0000-0000-0000-0000000000d1';
select isnt(
  (select done_at from next_action_subtasks where id = 'e2000000-0000-0000-0000-0000000000d1'),
  null, 'an admin ticks a subtask');
select throws_ok(
  $$ insert into next_action_subtasks (org_id, next_action_id, title) values
       ('11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-0000000000d1', '  ') $$,
  '23514', null, 'a blank title is refused');
delete from next_action_subtasks where id = 'e2000000-0000-0000-0000-0000000000d1';
select is(
  (select count(*) from next_action_subtasks where id = 'e2000000-0000-0000-0000-0000000000d1'),
  0::bigint, 'an admin deletes a subtask');
reset role;

-- TJ cannot see Deon's item: no reads, no subtasks, cannot add one.
select tests.set_claims('tj@gmxgroup.com', 'gmx-us');
set local role authenticated;
-- (Counted on that item only: since 20261103140000 TJ reads the subtasks in
-- his own seeded PK.)
select is(
  (select count(*) from next_action_subtasks where next_action_id = 'e0000000-0000-0000-0000-0000000000d1')
  + (select count(*) from next_action_reads where next_action_id = 'e0000000-0000-0000-0000-0000000000d1'),
  0::bigint, 'a rep who cannot see the item reads no subtasks or reads');
select throws_ok(
  $$ insert into next_action_subtasks (org_id, next_action_id, title) values
       ('11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-0000000000d1', 'sneaky') $$,
  '42501', null, 'a rep who cannot see the item cannot add a subtask');
select throws_ok(
  $$ insert into next_action_reads (org_id, membership_id, next_action_id) values
       ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000003',
        'e0000000-0000-0000-0000-0000000000d1') $$,
  '42501', null, 'a rep who cannot see the item cannot leave a read');
reset role;

select * from finish();
rollback;
