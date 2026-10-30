-- Dealer items · tests 27 (20261030120000_dealer_items.sql).
--
-- 1. next_actions carry an item type, a source and who entered them.
-- 2. Visits stay out of the to-do list; old follow-ups read as follow-ups.
-- 3. An assistant may enter an item for the person they support; a rep may not
--    enter one for a peer.

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_type('public', 'next_action_type', 'item type enum exists');
select has_column('public', 'next_actions', 'item_type', 'next_actions has item_type');
select col_default_is('public', 'next_actions', 'source', 'MANUAL'::next_action_source,
  'source defaults to MANUAL');

select is(
  (select count(*) from next_actions where kind = 'VISIT' and item_type is not null),
  0::bigint, 'visits stay out of the to-do list');
select is(
  (select count(*) from next_actions where kind is distinct from 'VISIT' and item_type is null),
  0::bigint, 'old follow-ups read as follow-ups');

-- Eric (support) is assigned to Bianca (admin) for this test.
insert into support_assignments (org_id, support_membership_id, rep_membership_id)
values ('11111111-1111-1111-1111-111111111111',
        'c0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001');

select tests.set_claims('eric@gmxgroup.com', 'gmx-us');
set local role authenticated;
select lives_ok(
  $$ insert into next_actions (id, org_id, action, owner_id, due_date, item_type)
     values ('e0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
             'Send the price list', 'c0000000-0000-0000-0000-000000000001',
             current_date + 3, 'ACTION') $$,
  'an assistant enters an item for the admin they support');
select is(
  (select entered_by from next_actions where id = 'e0000000-0000-0000-0000-0000000000a1'),
  'c0000000-0000-0000-0000-000000000005'::uuid,
  'the item records the assistant as who entered it');
reset role;

select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;
select throws_ok(
  $$ insert into next_actions (org_id, action, owner_id, due_date, item_type)
     values ('11111111-1111-1111-1111-111111111111', 'Call back',
             'c0000000-0000-0000-0000-000000000003', current_date + 3, 'ACTION') $$,
  '42501', null, 'a rep cannot enter an item for a peer');
reset role;

select * from finish();
rollback;
