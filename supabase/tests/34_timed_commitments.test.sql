-- Timed commitments · tests 34 (20261104120000 + 20261104130000).
--
-- A visit may carry a time and its zone; a call or a meeting must; neither
-- lands on the routine list.

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select enum_has_labels('public', 'next_action_kind',
  array['VISIT', 'CALL', 'MEETING', 'SAMPLE_FOLLOW_UP', 'QUOTE_FOLLOW_UP', 'DISPLAY_CHECK', 'OTHER'],
  'call and meeting are kinds of their own');

select has_column('public', 'next_actions', 'due_time', 'next_actions has due_time');

select tests.set_claims('tj@gmxgroup.com', 'gmx-us');
set local role authenticated;

select lives_ok(
  $$ insert into next_actions (id, org_id, action, owner_id, due_date, account_id, objective,
                               kind, due_time, time_zone, duration_minutes)
     values ('e3400000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
             'Collect the decking quote', 'c0000000-0000-0000-0000-000000000003', current_date + 2,
             'd0000000-0000-0000-0000-000000000003', 'COLLECT_QUOTE', 'VISIT',
             '10:00', 'America/New_York', 60) $$,
  'a visit takes a time and its zone');

select lives_ok(
  $$ insert into next_actions (id, org_id, action, owner_id, due_date, account_id,
                               kind, due_time, time_zone)
     values ('e3400000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
             'Call the buyer about the sample', 'c0000000-0000-0000-0000-000000000003', current_date + 1,
             'd0000000-0000-0000-0000-000000000003', 'CALL', '14:00', 'America/New_York') $$,
  'a call with a time is a commitment');

select throws_ok(
  $$ insert into next_actions (org_id, action, owner_id, due_date, kind)
     values ('11111111-1111-1111-1111-111111111111', 'Meet Bia',
             'c0000000-0000-0000-0000-000000000003', current_date + 1, 'MEETING') $$,
  '23514', null, 'a meeting without a time is refused');

select throws_ok(
  $$ insert into next_actions (org_id, action, owner_id, due_date, due_time)
     values ('11111111-1111-1111-1111-111111111111', 'Clockless zone',
             'c0000000-0000-0000-0000-000000000003', current_date + 1, '09:00') $$,
  '23514', null, 'a time without its zone is refused');

select is(
  (select count(*) from routine_items where item_id = 'e3400000-0000-0000-0000-000000000002'),
  0::bigint, 'a timed call is not a routine chore');

select is(
  (select item_type::text from next_actions where id = 'e3400000-0000-0000-0000-000000000002'),
  'FOLLOW_UP', 'a call is typed as a follow-up for the dealers page');

reset role;
select * from finish();
rollback;
