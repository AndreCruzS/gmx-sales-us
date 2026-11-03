-- PK follow-up for reps · tests 32 (20261103140000_pk_visible_to_reps.sql).
--
-- TJ (rep, c..03) ran a PK at Buffalo. In it: his own item, one João (manager,
-- c..02) took, one Deon (rep, c..04) took. Deon ran a PK of his own with one
-- item handed to TJ, and one of Deon's. Deon also has an ordinary store visit
-- with a to-do — none of that is TJ's to read.
--
--   1. TJ reads every item of his PK, João's and Deon's included.
--   2. TJ reads Deon's PK band because an item in it is his — but only his item.
--   3. TJ still cannot read Deon's non-PK visit or its to-do.
--   4. TJ cannot change João's item; he can note on it and keep a read.
--   5. Subtasks on João's item are read-only for TJ.
--   6. João (manager) sees his team's PKs; Bianca (admin) sees all.

begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

select has_function('private', 'pk_ids_run_by_visible', 'the PK items helper exists');

-- Fixtures, as the service role.
insert into activities (id, org_id, activity_type, primary_account_id, owner_id, occurred_at) values
  ('ac320000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'PK_TRAINING', 'd0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', now() - interval '3 days'),
  ('ac320000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'PK_TRAINING', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', now() - interval '2 days'),
  ('ac320000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'DEALER_VISIT', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', now() - interval '1 day');

insert into next_actions (id, org_id, action, owner_id, due_date, activity_id) values
  -- TJ's PK
  ('e3200000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Send the PK deck', 'c0000000-0000-0000-0000-000000000003', current_date + 2, 'ac320000-0000-0000-0000-000000000001'),
  ('e3200000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Price the ipe order', 'c0000000-0000-0000-0000-000000000002', current_date + 2, 'ac320000-0000-0000-0000-000000000001'),
  ('e3200000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Ship the samples', 'c0000000-0000-0000-0000-000000000004', current_date + 2, 'ac320000-0000-0000-0000-000000000001'),
  -- Deon's PK: one handed to TJ, one Deon's
  ('e3200000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Call their buyer', 'c0000000-0000-0000-0000-000000000003', current_date + 2, 'ac320000-0000-0000-0000-000000000002'),
  ('e3200000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'Rebuild the display', 'c0000000-0000-0000-0000-000000000004', current_date + 2, 'ac320000-0000-0000-0000-000000000002'),
  -- Deon's ordinary visit
  ('e3200000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'Restock samples', 'c0000000-0000-0000-0000-000000000004', current_date + 2, 'ac320000-0000-0000-0000-000000000003');

insert into next_action_subtasks (id, org_id, next_action_id, title, created_by) values
  ('e3210000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'e3200000-0000-0000-0000-000000000002', 'Get the freight quote', 'c0000000-0000-0000-0000-000000000002');

-- ── TJ ──────────────────────────────────────────────────────────────────────
select tests.set_claims('tj@gmxgroup.com', 'gmx-us');
set local role authenticated;

select is(
  (select count(*) from public.pk_board_items() where activity_id = 'ac320000-0000-0000-0000-000000000001'),
  3::bigint, 'TJ reads every item of his PK, João''s and Deon''s included');

select is(
  (select count(*) from public.pk_board_visits() where id = 'ac320000-0000-0000-0000-000000000002'),
  1::bigint, 'TJ reads the band of a PK that holds an item handed to him');

select results_eq(
  $$ select id from public.pk_board_items() where activity_id = 'ac320000-0000-0000-0000-000000000002' $$,
  $$ values ('e3200000-0000-0000-0000-000000000004'::uuid) $$,
  'in Deon''s PK, TJ reads only the item that is his');

select is(
  (select count(*) from public.pk_board_visits() where id = 'ac320000-0000-0000-0000-000000000003') + (select count(*) from activities where id = 'ac320000-0000-0000-0000-000000000003'),
  0::bigint, 'TJ still cannot read Deon''s store visit');

select is(
  (select count(*) from public.pk_board_items() where id = 'e3200000-0000-0000-0000-000000000006') + (select count(*) from next_actions where id = 'e3200000-0000-0000-0000-000000000006'),
  0::bigint, 'TJ still cannot read the to-do from Deon''s store visit');

-- The tables themselves are as before: the rep's day reads them, and João's
-- and Deon's PK work must not land on TJ's routine list or visit history.
select is(
  (select count(*) from next_actions where activity_id = 'ac320000-0000-0000-0000-000000000001'),
  1::bigint, 'the next_actions table still shows TJ only his own item');
select is(
  (select count(*) from activities where id = 'ac320000-0000-0000-0000-000000000002'),
  0::bigint, 'the activities table still hides Deon''s PK from TJ');
select is(
  (select count(*) from next_action_notes where next_action_id = 'f1000000-0000-0000-0000-0000000000a2'),
  1::bigint, 'TJ reads João''s note in his own seeded PK');

-- His view of João's item is read-only.
update next_actions set progress = 'WORKING_ON_IT' where id = 'e3200000-0000-0000-0000-000000000002';
select is(
  (select progress::text from public.pk_board_items() where id = 'e3200000-0000-0000-0000-000000000002'),
  'NOT_STARTED', 'TJ cannot change João''s item');

insert into next_action_notes (org_id, next_action_id, body) values
  ('11111111-1111-1111-1111-111111111111', 'e3200000-0000-0000-0000-000000000002',
   'The dealer called me about the price');
select is(
  (select count(*) from next_action_notes where next_action_id = 'e3200000-0000-0000-0000-000000000002'),
  1::bigint, 'TJ adds a note to João''s item');

insert into next_action_reads (org_id, membership_id, next_action_id) values
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000003',
   'e3200000-0000-0000-0000-000000000002');
select is(
  (select count(*) from next_action_reads where next_action_id = 'e3200000-0000-0000-0000-000000000002'),
  1::bigint, 'TJ keeps his own read on João''s item');

select is(
  (select count(*) from next_action_subtasks where next_action_id = 'e3200000-0000-0000-0000-000000000002'),
  1::bigint, 'TJ sees the subtasks of João''s item');

update next_action_subtasks set done_at = now() where id = 'e3210000-0000-0000-0000-000000000001';
select is(
  (select done_at from next_action_subtasks where id = 'e3210000-0000-0000-0000-000000000001'),
  null, 'TJ cannot tick a subtask on João''s item');

select throws_ok(
  $$ insert into next_action_subtasks (org_id, next_action_id, title) values
       ('11111111-1111-1111-1111-111111111111', 'e3200000-0000-0000-0000-000000000002', 'Mine now') $$,
  '42501', null, 'TJ cannot add a subtask to João''s item');

-- His own item still moves.
update next_actions set progress = 'WORKING_ON_IT' where id = 'e3200000-0000-0000-0000-000000000001';
select is(
  (select progress::text from next_actions where id = 'e3200000-0000-0000-0000-000000000001'),
  'WORKING_ON_IT', 'TJ still moves his own item');

reset role;

-- ── Deon: TJ's PK is open to him only through his own item in it, so he
-- reads that item and the band, not TJ's or João's items.
select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;
select results_eq(
  $$ select id from public.pk_board_items() where activity_id = 'ac320000-0000-0000-0000-000000000001' order by id $$,
  $$ values ('e3200000-0000-0000-0000-000000000003'::uuid) $$,
  'in TJ''s PK, Deon reads only his own item');
reset role;

-- ── João (manager of TJ and Deon) and Bianca (admin) ────────────────────────
select tests.set_claims('joao@gmxgroup.com', 'gmx-us');
set local role authenticated;
select is(
  (select count(*) from public.pk_board_items() where activity_id in
     ('ac320000-0000-0000-0000-000000000001', 'ac320000-0000-0000-0000-000000000002')),
  5::bigint, 'João sees every item of his team''s PKs');
reset role;

select tests.set_claims('bianca@gmxgroup.com', 'gmx-us');
set local role authenticated;
select is(
  (select count(*) from public.pk_board_items() where activity_id::text like 'ac32%'),
  6::bigint, 'Bianca sees every item');
reset role;

select * from finish();
rollback;
