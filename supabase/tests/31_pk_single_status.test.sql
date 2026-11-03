-- PK follow-up · tests 31 (20261103120000 + 20261103130000, one status).
--
-- Action required is gone; "Waiting on dealer" is a progress value of its
-- own. It keeps the item open, and the Done sync still works from it.

begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select enum_has_labels('public', 'next_action_progress',
  array['NOT_STARTED', 'WORKING_ON_IT', 'WAITING', 'STUCK', 'DONE'],
  'progress runs To do, In progress, Waiting, Stuck, Done');

insert into next_actions (id, org_id, action, owner_id, due_date, progress) values
  ('e0000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   'Waiting item', 'c0000000-0000-0000-0000-000000000001', current_date + 3, 'WAITING');
select is(
  (select completed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000c1'),
  null, 'waiting on the dealer keeps the item open');

update next_actions set progress = 'DONE' where id = 'e0000000-0000-0000-0000-0000000000c1';
select isnt(
  (select completed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000c1'),
  null, 'waiting -> done closes it');
update next_actions set progress = 'WAITING' where id = 'e0000000-0000-0000-0000-0000000000c1';
select is(
  (select completed_at from next_actions where id = 'e0000000-0000-0000-0000-0000000000c1'),
  null, 'done -> waiting opens it again');

-- A member moving it to waiting is stamped.
select tests.set_claims('bianca@gmxgroup.com', 'gmx-us');
set local role authenticated;
update next_actions set progress = 'STUCK' where id = 'e0000000-0000-0000-0000-0000000000c1';
select is(
  (select last_changed_by from next_actions where id = 'e0000000-0000-0000-0000-0000000000c1'),
  'c0000000-0000-0000-0000-000000000001'::uuid, 'a member moving the status is stamped');
reset role;

select * from finish();
rollback;
