-- Agent connector · tests 35 (20261105120000).
--
-- Rows made by Claude or Muse carry created_via; every agent write is logged
-- in agent_actions, which only its own user can see, change or (never) delete.

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select has_column('public', 'next_actions', 'created_via', 'next_actions has created_via');
select has_column('public', 'activities', 'created_via', 'activities has created_via');
select has_column('public', 'next_action_notes', 'created_via', 'next_action_notes has created_via');
select has_column('public', 'next_action_subtasks', 'created_via', 'next_action_subtasks has created_via');
select has_column('public', 'accounts', 'created_via', 'accounts has created_via');
select has_column('public', 'contacts', 'created_via', 'contacts has created_via');
select has_column('public', 'account_notes', 'created_via', 'account_notes has created_via');

select tests.set_claims('tj@gmxgroup.com', 'gmx-us');
set local role authenticated;

select throws_ok(
  $$ insert into next_actions (org_id, action, owner_id, due_date, kind, created_via)
     values ('11111111-1111-1111-1111-111111111111', 'Robot visit',
             'c0000000-0000-0000-0000-000000000003', current_date + 1, 'VISIT', 'robot') $$,
  '23514', null, 'an unknown origin is refused');

select lives_ok(
  $$ insert into agent_actions (id, session_id, via, tool, entity, entity_id, op)
     values ('a3500000-0000-0000-0000-000000000001', 'sess-1', 'claude', 'create_visit',
             'next_actions', 'e3500000-0000-0000-0000-000000000001', 'create') $$,
  'a user logs an agent action as themself');

select throws_ok(
  $$ insert into agent_actions (user_id, session_id, via, tool, entity, entity_id, op)
     values ('a0000000-0000-0000-0000-000000000001', 'sess-x', 'muse', 't', 'accounts',
             'e3500000-0000-0000-0000-000000000002', 'create') $$,
  '42501', null, 'a user cannot log an action as someone else');

select is((select count(*)::int from agent_actions), 1, 'the owner sees the action');

with d as (delete from agent_actions returning 1)
select is((select count(*)::int from d), 0, 'delete affects nothing (no policy)');

reset role;
select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;

select is((select count(*)::int from agent_actions), 0, 'another user sees none');

with u as (
  update agent_actions set undone_at = now() returning 1)
select is((select count(*)::int from u), 0, 'another user cannot update it');

select * from finish();
rollback;
