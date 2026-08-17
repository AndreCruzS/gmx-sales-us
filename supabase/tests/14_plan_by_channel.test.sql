-- Channel attribution · tests 14: dashboard_plan_by_channel
-- (20260814000100_plan_by_channel.sql).
--
-- The manager view splits a rep's week by the distributor behind each door, so
-- what these tests hold is the attribution itself — get it wrong and a chart
-- confidently tells a manager the wrong house is being neglected.
--
-- 1. Direction is read, not guessed. "A SUPPLIES B" and "B PURCHASES_FROM A"
--    mean the same thing and must resolve to the same distributor; a type that
--    states no direction (WORKS_WITH, REFERRED_BY) must resolve to none.
-- 2. Only a DISTRIBUTOR counts as one. A dealer that supplies a contractor is
--    upstream of it, but it is not the house.
-- 3. Ambiguity is reported, never resolved by picking. Two distributors on one
--    door leaves distributor_id null with distributor_options = 2.
-- 4. RLS still owns visibility: the view is security_invoker, so a rep sees
--    their own plan and not another org's.
--
-- Seeded fixtures (supabase/seed.sql):
-- org         = 11111111-1111-1111-1111-111111111111
-- deon        = c0000000-0000-0000-0000-000000000004 (deon@gmxgroup.com, rep)
-- anaheim     = d0000000-0000-0000-0000-000000000001 (dealer, supplied by Boise)
-- orange      = d0000000-0000-0000-0000-000000000002 (dealer, supplied by Hardwoods)
-- boise       = d0000000-0000-0000-0000-000000000005 (distributor)
-- hardwoods   = d0000000-0000-0000-0000-000000000006 (distributor)
-- abc         = d0000000-0000-0000-0000-000000000004 (contractor, no distributor)

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;

-- 1. A stated "SUPPLIES" puts the visit under that distributor.
select is(
  (select distributor_name from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000001' limit 1),
  'Boise Cascade',
  'a dealer supplied by Boise reports Boise'
);

-- 2. A different door under a different house is kept apart — this is the case
--    the banner lens cannot see, since both are Ganahl.
select is(
  (select distributor_name from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000002' limit 1),
  'Hardwoods Specialty',
  'two branches of one banner can run through two houses'
);

-- 3. Exactly one distributor found is what makes the id trustworthy.
select is(
  (select distributor_options from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000001' limit 1),
  1::bigint,
  'one house found is reported as one'
);

-- 4. The reverse phrasing is the same fact. Stated as the dealer purchasing,
--    rather than the distributor supplying, it must resolve identically.
--    Rewiring the fixture is done with the role reset: a rep has no DELETE on
--    account_relationships, and a blocked delete removes nothing while
--    reporting nothing — which would leave the next assertions quietly
--    measuring the rows they meant to replace.
reset role;
delete from account_relationships
 where account_a_id = 'd0000000-0000-0000-0000-000000000005'
   and account_b_id = 'd0000000-0000-0000-0000-000000000001';
insert into account_relationships (org_id, account_a_id, relationship_type,
                                   account_b_id, strength, created_by)
values ('11111111-1111-1111-1111-111111111111',
        'd0000000-0000-0000-0000-000000000001', 'PURCHASES_FROM',
        'd0000000-0000-0000-0000-000000000005', 'STRONG',
        'c0000000-0000-0000-0000-000000000004');
set local role authenticated;

select is(
  (select distributor_name from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000001' limit 1),
  'Boise Cascade',
  '"dealer purchases from house" resolves the same as "house supplies dealer"'
);

-- 5. Two houses on one door is ambiguity, and it is reported as such.
reset role;
insert into account_relationships (org_id, account_a_id, relationship_type,
                                   account_b_id, strength, created_by)
values ('11111111-1111-1111-1111-111111111111',
        'd0000000-0000-0000-0000-000000000006', 'SUPPLIES',
        'd0000000-0000-0000-0000-000000000001', 'MODERATE',
        'c0000000-0000-0000-0000-000000000004');
set local role authenticated;

select is(
  (select distributor_options from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000001' limit 1),
  2::bigint,
  'two houses on one door are counted, not merged'
);

-- 6. …and no id is offered, because there is no single right answer.
select is(
  (select distributor_id from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000001' limit 1),
  null::uuid,
  'an ambiguous door names no distributor rather than picking one'
);

-- 7. A relationship that states no direction is not a supply chain.
reset role;
delete from account_relationships
 where account_b_id = 'd0000000-0000-0000-0000-000000000001'
    or account_a_id = 'd0000000-0000-0000-0000-000000000001';
insert into account_relationships (org_id, account_a_id, relationship_type,
                                   account_b_id, strength, created_by)
values ('11111111-1111-1111-1111-111111111111',
        'd0000000-0000-0000-0000-000000000005', 'WORKS_WITH',
        'd0000000-0000-0000-0000-000000000001', 'STRONG',
        'c0000000-0000-0000-0000-000000000004');
set local role authenticated;

select is(
  (select distributor_options from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000001' limit 1),
  0::bigint,
  'WORKS_WITH states no direction and so supplies no distributor'
);

-- 8. Only a DISTRIBUTOR is a distributor. ABC buys from Ganahl Anaheim, which
--    is upstream of it — but a dealer is not the house.
select is(
  (select distributor_options from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000004' limit 1),
  0::bigint,
  'an upstream DEALER is not counted as the distributor'
);

-- 9. The kept half of the plan is counted from the activity that closed it.
select is(
  (select planned_done from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000002'
      and week_start = date_trunc('week', current_date)::date),
  1::bigint,
  'a planned action with an activity against it counts as done'
);

-- 10. security_invoker: another org's plan is not in this rep's view.
select is(
  (select count(*) from dashboard_plan_by_channel
    where account_id = 'd2000000-0000-0000-0000-000000000002'),
  0::bigint,
  'RLS still scopes the view — org2 plan is invisible to a gmx-us rep'
);

-- ── The four states of a planned visit ──────────────────────────────────────
-- Collapsing "never happened" into "still to come" is the mistake these hold
-- against: mileage is reimbursed, so a visit that was planned and never made is
-- a cost, while one still ahead is not yet anything.

-- 11. A visit closed with a note is done and NOT owed.
select is(
  (select planned_owed from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000002'
      and week_start = date_trunc('week', current_date)::date),
  0::bigint,
  'an activity carrying a note owes nothing'
);

-- 12. A visit closed with an EMPTY note is done and owed. The seed has one, so
--     the state is exercised by the demo data as well as by this assertion.
select is(
  (select planned_owed from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000001'
      and week_start = date_trunc('week', current_date)::date),
  1::bigint,
  'an activity with no what_happened is done but owes a note'
);

-- 13. Whitespace is not a debrief.
reset role;
update activities set what_happened = '   '
 where id = 'ac000000-0000-0000-0000-000000000003';
set local role authenticated;
select is(
  (select planned_owed from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000002'
      and week_start = date_trunc('week', current_date)::date),
  1::bigint,
  'a note of only spaces still owes a note'
);

-- 14. Today is not yet a miss — the rep still has the afternoon. A commitment
--     dated today with nothing against it counts as still to come, not lost.
--
--     Measured as a DELTA rather than against a fixed number. The seed's own
--     misses depend on how far into the week the suite runs (on a Monday nothing
--     has gone past yet), so an absolute figure here would assert the calendar
--     instead of the rule.
reset role;
create temp table _missed_before as
select coalesce(planned_missed, 0) as val from dashboard_plan_by_channel
 where account_id = 'd0000000-0000-0000-0000-000000000002'
   and week_start = date_trunc('week', current_date)::date;
grant select on _missed_before to authenticated;

insert into next_actions (id, org_id, action, owner_id, due_date, account_id, objective)
values ('f1000000-0000-0000-0000-0000000000c1',
        '11111111-1111-1111-1111-111111111111',
        'Late call', 'c0000000-0000-0000-0000-000000000004',
        current_date, 'd0000000-0000-0000-0000-000000000002',
        'RELATIONSHIP_MAINTENANCE');
set local role authenticated;
select is(
  (select planned_missed from dashboard_plan_by_channel
    where account_id = 'd0000000-0000-0000-0000-000000000002'
      and week_start = date_trunc('week', current_date)::date),
  (select val from _missed_before),
  'a commitment due today is not counted as never happened'
);

select * from finish();
rollback;
