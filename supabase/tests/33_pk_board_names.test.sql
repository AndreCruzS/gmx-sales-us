-- PK follow-up for reps · tests 33 (20261103150000_pk_board_names.sql).
--
-- TJ reads his colleagues' names, and the dealer of a PK he can see — but not
-- the dealer of a PK he cannot see.

begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into activities (id, org_id, activity_type, primary_account_id, owner_id, occurred_at) values
  ('ac330000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'PK_TRAINING', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', now()),
  ('ac330000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'PK_TRAINING', 'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004', now());
insert into next_actions (org_id, action, owner_id, due_date, activity_id) values
  ('11111111-1111-1111-1111-111111111111', 'Handed to TJ', 'c0000000-0000-0000-0000-000000000003',
   current_date + 1, 'ac330000-0000-0000-0000-000000000001');

select tests.set_claims('tj@gmxgroup.com', 'gmx-us');
set local role authenticated;

select is(
  (select full_name from public.pk_member_names() where id = 'c0000000-0000-0000-0000-000000000002'),
  'Joao Manager', 'a rep reads a colleague''s name');

select is(
  (select count(*) from public.pk_member_names() where id = 'c0000000-0000-0000-0000-000000000007'),
  0::bigint, 'never a member of another org');

select is(
  (select count(*) from public.pk_dealer_names(array['ac330000-0000-0000-0000-000000000001'::uuid])),
  1::bigint, 'a rep reads the dealer of a PK that holds his item');

select is(
  (select count(*) from public.pk_dealer_names(array['ac330000-0000-0000-0000-000000000002'::uuid])),
  0::bigint, 'but not the dealer of a PK he cannot see');

reset role;
select * from finish();
rollback;
