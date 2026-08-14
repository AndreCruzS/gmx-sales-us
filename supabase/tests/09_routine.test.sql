-- Phase 6 tests · 09: routine list substrate (spec 2026-07-29 task 1) — chores
-- are next_actions with a kind; display checks derive from accounts. Gate:
-- backfill inference, routine_items content, the escalation handoff (an
-- overdue item leaves routine before it lands in exceptions — no gap, no
-- overlap), and RLS scoping. Follows the fixture prologue of
-- 07_exceptions.test.sql (same two-org seed, same role-switching helpers).
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

\set org_a 11111111-1111-1111-1111-111111111111
\set deon c0000000-0000-0000-0000-000000000004
\set soc_territory b0000000-0000-0000-0000-000000000002

-- 1-3: schema
select has_column('public', 'next_actions', 'kind', 'next_actions has kind');
select has_column('public', 'voice_captures', 'account_id', 'captures link account');
select has_column('public', 'voice_captures', 'planned_action_id', 'captures link plan');

-- ── Backfill fixtures (test 4) ───────────────────────────────────────────────
-- The seed's own next_actions (every f1000000… row) were backfilled to VISIT
-- when this migration first ran against the already-seeded local stack; they
-- would pollute the exact-count assertion below, so clear them first. Matched
-- by prefix rather than listed by id: the seed's week grows whenever the demo
-- needs more shape, and a hardcoded list silently stops covering it. Null the
-- activities' planned_action_id first (immediate FK, not deferrable).
update activities set planned_action_id = null
 where planned_action_id in (
   select id from next_actions where id::text like 'f1000000-%'
 );
delete from next_actions where id::text like 'f1000000-%';

insert into next_actions (id, org_id, action, owner_id, due_date) values
  ('f9000000-0000-0000-0000-000000000001', :'org_a',
   'Ask about the quote', :'deon', current_date + 5),
  ('f9000000-0000-0000-0000-000000000002', :'org_a',
   'Call the customer back', :'deon', current_date + 5),
  ('f9000000-0000-0000-0000-000000000003', :'org_a',
   'Send sample pack', :'deon', current_date + 5);

insert into next_actions (id, org_id, action, owner_id, due_date, objective) values
  ('f9000000-0000-0000-0000-000000000004', :'org_a',
   'Visit and review the store', :'deon', current_date + 5, 'MERCHANDISING_CHECK');

-- 4: backfill inference — seed rows in fixtures: one with objective (→VISIT),
-- one action 'Send sample pack' (→SAMPLE_FOLLOW_UP), one 'Chase quote'
-- (→QUOTE_FOLLOW_UP), one 'Call back' (→OTHER)
select results_eq(
  $$ select kind::text from next_actions where org_id = '$$ || :'org_a' || $$' order by action $$,
  $$ values ('QUOTE_FOLLOW_UP'), ('OTHER'), ('SAMPLE_FOLLOW_UP'), ('VISIT') $$,
  'backfill inferred kinds');

-- ── routine_items fixtures (tests 5-9) ───────────────────────────────────────
-- Overdue chore: past exception_overdue_follow_up's threshold (it fires the
-- instant due_date < current_date — no grace window), so it must have already
-- left the routine.
insert into next_actions (id, org_id, action, owner_id, due_date) values
  ('f9000000-0000-0000-0000-000000000005', :'org_a',
   'Chase the overdue quote', :'deon', current_date - 3);
\set overdue_na f9000000-0000-0000-0000-000000000005

-- Completed chore (test 12): would otherwise qualify, but is done.
insert into next_actions (id, org_id, action, owner_id, due_date, completed_at) values
  ('f9000000-0000-0000-0000-000000000006', :'org_a',
   'Send another sample pack', :'deon', current_date + 2, now());
\set completed_na f9000000-0000-0000-0000-000000000006

-- Display accounts: 5 months unverified → inside the routine window (4-6);
-- 7 months unverified → past the exception threshold, routine's business ends
-- at 6 months.
insert into accounts (id, org_id, name, account_type, city, state, territory_id,
                      owner_id, lead_source, has_display_wall, display_last_verified_at,
                      strategic_importance) values
  ('d9000000-0000-0000-0000-000000000001', :'org_a', 'Routine Display Co', 'DEALER',
   'Anaheim', 'CA', :'soc_territory', :'deon', 'EXISTING_RELATIONSHIP',
   true, now() - interval '5 months', 'MEDIUM'),
  ('d9000000-0000-0000-0000-000000000002', :'org_a', 'Stale Display Co', 'DEALER',
   'Anaheim', 'CA', :'soc_territory', :'deon', 'EXISTING_RELATIONSHIP',
   true, now() - interval '7 months', 'MEDIUM');
\set stale_display_acct d9000000-0000-0000-0000-000000000002

-- 5-9 run as the owning rep (D24-style scoping, suite 07 pattern).
select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
select set_config('role', 'authenticated', true);

-- 5-7: routine_items content
select is((select count(*) from routine_items where kind = 'SAMPLE_FOLLOW_UP')::int, 1, 'sample chore listed');
select is((select count(*) from routine_items where kind = 'DISPLAY_CHECK')::int, 1,
  'display unverified 5 months → routine (window 4, threshold 6)');
select is((select count(*) from routine_items where kind = 'VISIT')::int, 0, 'visits are not chores');

-- 8: escalation handoff — fixture next_action overdue past the
-- exception_overdue_follow_up threshold must NOT appear in routine_items
select is((select count(*) from routine_items where item_id = :'overdue_na')::int, 0,
  'escalated item leaves routine');

-- 9: display past 6 months lives in the exception, not routine
select is((select count(*) from routine_items
           where kind = 'DISPLAY_CHECK' and account_id = :'stale_display_acct')::int, 0,
  'display past threshold leaves routine');

select set_config('role', 'postgres', true);

-- ── 10-11: RLS scoping — rep sees own, other-org rep sees zero (suite 07 pattern) ──
create temp table _scope (check_name text primary key, val int);
grant select, insert on _scope to authenticated;

do $$
begin
  perform tests.set_claims('deon@gmxgroup.com', 'gmx-us');
  perform set_config('role', 'authenticated', true);
  insert into _scope
    select 'deon_sees_own', count(*) from public.routine_items
     where owner_membership_id = 'c0000000-0000-0000-0000-000000000004';
  perform set_config('role', 'postgres', true);

  perform tests.set_claims('riley@acme.test', 'acme-test');
  perform set_config('role', 'authenticated', true);
  insert into _scope
    select 'riley_sees_deon', count(*) from public.routine_items
     where owner_membership_id = 'c0000000-0000-0000-0000-000000000004';
  perform set_config('role', 'postgres', true);
end;
$$;

select cmp_ok((select val from _scope where check_name = 'deon_sees_own'), '>', 0,
  'a rep sees their own routine items');
select is((select val from _scope where check_name = 'riley_sees_deon'), 0,
  'an other-org rep sees zero (security_invoker + RLS)');

-- 12: completed next_action absent
select is((select count(*) from routine_items where item_id = :'completed_na')::int, 0,
  'a completed next_action leaves the routine');

select * from finish();
rollback;
