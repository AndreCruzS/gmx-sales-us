-- Phase 3 tests · 07: exception engine gate — every exception fires on a
-- fixture and clears when resolved (build brief §3 gate). Runs as postgres
-- (invoker views see everything for the owner); RLS scoping asserted at the end.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

-- Shorthand: count a specific exception for a specific subject.
create function pg_temp.exc(p_type text, p_subject uuid) returns int
language sql as $$
  select count(*)::int from public.exceptions
  where exception_type = p_type and subject_id = p_subject;
$$;

-- ── Snapshot scan: seeded org2 project has no dealer stakeholder ────────────
select private.scan_exceptions();
select is(
  (select count(*)::int from exception_snapshots
    where exception_type = 'PROJECT_NO_DEALER'
      and subject_id = 'e0000000-0000-0000-0000-000000000002'
      and cleared_at is null),
  1, 'scan opens a snapshot row for a firing exception'
);

-- ── 1. Opportunity without next action ──────────────────────────────────────
update next_actions set completed_at = now()
 where opportunity_id = 'f0000000-0000-0000-0000-000000000001'
   and completed_at is null;
select is(pg_temp.exc('OPPORTUNITY_NO_NEXT_ACTION', 'f0000000-0000-0000-0000-000000000001'),
  1, 'OPPORTUNITY_NO_NEXT_ACTION fires when the last open action completes');

insert into next_actions (id, org_id, action, owner_id, due_date, opportunity_id)
values ('f1000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
        'Re-engage after sample', 'c0000000-0000-0000-0000-000000000004',
        current_date + 10, 'f0000000-0000-0000-0000-000000000001');
select is(pg_temp.exc('OPPORTUNITY_NO_NEXT_ACTION', 'f0000000-0000-0000-0000-000000000001'),
  0, 'OPPORTUNITY_NO_NEXT_ACTION clears when an open action exists');

-- ── 2. Overdue follow-up ────────────────────────────────────────────────────
insert into next_actions (id, org_id, action, owner_id, due_date, account_id)
values ('f1000000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111',
        'Chase PK quote', 'c0000000-0000-0000-0000-000000000003',
        current_date - 1, 'd0000000-0000-0000-0000-000000000003');
select is(pg_temp.exc('OVERDUE_FOLLOW_UP', 'f1000000-0000-0000-0000-0000000000b2'),
  1, 'OVERDUE_FOLLOW_UP fires past the due date');

update next_actions set completed_at = now()
 where id = 'f1000000-0000-0000-0000-0000000000b2';
select is(pg_temp.exc('OVERDUE_FOLLOW_UP', 'f1000000-0000-0000-0000-0000000000b2'),
  0, 'OVERDUE_FOLLOW_UP clears on completion');

-- ── 3. Quote without follow-up (window default 5 days; open NA is due +10) ──
update opportunities set stage = 'QUOTE'
 where id = 'f0000000-0000-0000-0000-000000000001';
select is(pg_temp.exc('QUOTE_NO_FOLLOW_UP', 'f0000000-0000-0000-0000-000000000001'),
  1, 'QUOTE_NO_FOLLOW_UP fires when no follow-up is scheduled inside the window');

insert into next_actions (id, org_id, action, owner_id, due_date, opportunity_id)
values ('f1000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111',
        'Call about the quote', 'c0000000-0000-0000-0000-000000000004',
        current_date + 1, 'f0000000-0000-0000-0000-000000000001');
select is(pg_temp.exc('QUOTE_NO_FOLLOW_UP', 'f0000000-0000-0000-0000-000000000001'),
  0, 'QUOTE_NO_FOLLOW_UP clears once a prompt follow-up is scheduled');

-- ── 4. Strategic account quiet (seeded banner has no activities) ────────────
select is(pg_temp.exc('STRATEGIC_ACCOUNT_QUIET', 'd0000000-0000-0000-0000-000000000000'),
  1, 'STRATEGIC_ACCOUNT_QUIET fires for a quiet strategic account');

insert into activities (id, org_id, activity_type, primary_account_id, owner_id, what_happened)
values ('ac000000-0000-0000-0000-0000000000b4', '11111111-1111-1111-1111-111111111111',
        'PHONE_CALL', 'd0000000-0000-0000-0000-000000000000',
        'c0000000-0000-0000-0000-000000000004', 'Checked in with banner HQ');
select is(pg_temp.exc('STRATEGIC_ACCOUNT_QUIET', 'd0000000-0000-0000-0000-000000000000'),
  0, 'STRATEGIC_ACCOUNT_QUIET clears after fresh activity');

-- ── 5. Opportunity stale (backdate updated_at; org2 opp has no activities) ──
-- Flush the deferred stage-gate event queued by test 3 (the QUOTE update
-- passes the gate — an open next action exists) so ALTER TABLE isn't blocked
-- by pending trigger events.
set constraints all immediate;
set constraints all deferred;
alter table opportunities disable trigger set_updated_at;
update opportunities set updated_at = now() - interval '30 days'
 where id = 'f0000000-0000-0000-0000-000000000002';
alter table opportunities enable trigger set_updated_at;
select is(pg_temp.exc('OPPORTUNITY_STALE', 'f0000000-0000-0000-0000-000000000002'),
  1, 'OPPORTUNITY_STALE fires after the inactivity window');

insert into activities (id, org_id, activity_type, primary_account_id, owner_id,
                        what_happened, opportunity_id)
values ('ac200000-0000-0000-0000-0000000000b5', '22222222-2222-2222-2222-222222222222',
        'PHONE_CALL', 'd2000000-0000-0000-0000-000000000001',
        'c0000000-0000-0000-0000-000000000007', 'Revived the decking deal',
        'f0000000-0000-0000-0000-000000000002');
select is(pg_temp.exc('OPPORTUNITY_STALE', 'f0000000-0000-0000-0000-000000000002'),
  0, 'OPPORTUNITY_STALE clears on linked activity');

-- ── 6. Project without dealer (org2 project seeded with contractor only) ────
select is(pg_temp.exc('PROJECT_NO_DEALER', 'e0000000-0000-0000-0000-000000000002'),
  1, 'PROJECT_NO_DEALER fires without a dealer stakeholder');

insert into project_stakeholders (org_id, project_id, account_id, stakeholder_role)
values ('22222222-2222-2222-2222-222222222222', 'e0000000-0000-0000-0000-000000000002',
        'd2000000-0000-0000-0000-000000000001', 'DEALER');
select is(pg_temp.exc('PROJECT_NO_DEALER', 'e0000000-0000-0000-0000-000000000002'),
  0, 'PROJECT_NO_DEALER clears when a dealer is assigned');

-- …and the scan closes the snapshot it opened earlier.
select private.scan_exceptions();
select is(
  (select count(*)::int from exception_snapshots
    where exception_type = 'PROJECT_NO_DEALER'
      and subject_id = 'e0000000-0000-0000-0000-000000000002'
      and cleared_at is not null),
  1, 'scan clears the snapshot row once the exception resolves'
);

-- ── 7. Contractor relationship not updated ──────────────────────────────────
update account_relationships set last_confirmed_at = now() - interval '100 days'
 where id = 'd3000000-0000-0000-0000-000000000001';
select is(pg_temp.exc('CONTRACTOR_RELATIONSHIP_STALE', 'd3000000-0000-0000-0000-000000000001'),
  1, 'CONTRACTOR_RELATIONSHIP_STALE fires past the confirmation window');

update account_relationships set last_confirmed_at = now()
 where id = 'd3000000-0000-0000-0000-000000000001';
select is(pg_temp.exc('CONTRACTOR_RELATIONSHIP_STALE', 'd3000000-0000-0000-0000-000000000001'),
  0, 'CONTRACTOR_RELATIONSHIP_STALE clears on reconfirmation');

-- ── 8. New account with no follow-up (seeded Ganahl Orange has none) ────────
select is(pg_temp.exc('NEW_ACCOUNT_NO_FOLLOW_UP', 'd0000000-0000-0000-0000-000000000002'),
  1, 'NEW_ACCOUNT_NO_FOLLOW_UP fires for a fresh account with no next action');

insert into next_actions (id, org_id, action, owner_id, due_date, account_id)
values ('f1000000-0000-0000-0000-0000000000b8', '11111111-1111-1111-1111-111111111111',
        'Intro visit to Orange branch', 'c0000000-0000-0000-0000-000000000004',
        current_date + 3, 'd0000000-0000-0000-0000-000000000002');
select is(pg_temp.exc('NEW_ACCOUNT_NO_FOLLOW_UP', 'd0000000-0000-0000-0000-000000000002'),
  0, 'NEW_ACCOUNT_NO_FOLLOW_UP clears once a next action is scheduled');

-- ── 9. Next week not planned (D47) — deadline weekday is org-configurable ───
update organizations set settings = settings || '{"planning_deadline_isodow": 1}'
 where id = '11111111-1111-1111-1111-111111111111';
select is(pg_temp.exc('NEXT_WEEK_NOT_PLANNED', 'c0000000-0000-0000-0000-000000000003'),
  1, 'NEXT_WEEK_NOT_PLANNED fires for a rep with an empty next week');

insert into next_actions (id, org_id, action, owner_id, due_date, account_id)
values ('f1000000-0000-0000-0000-0000000000b9', '11111111-1111-1111-1111-111111111111',
        'Planned: Buffalo dealer loop', 'c0000000-0000-0000-0000-000000000003',
        date_trunc('week', current_date)::date + 8,
        'd0000000-0000-0000-0000-000000000003');
select is(pg_temp.exc('NEXT_WEEK_NOT_PLANNED', 'c0000000-0000-0000-0000-000000000003'),
  0, 'NEXT_WEEK_NOT_PLANNED clears once next week has agenda items');

update organizations set settings = settings || '{"planning_deadline_isodow": 8}'
 where id = '11111111-1111-1111-1111-111111111111';
select is(
  (select count(*)::int from exceptions e
    where e.exception_type = 'NEXT_WEEK_NOT_PLANNED'
      and e.org_id = '11111111-1111-1111-1111-111111111111'),
  0, 'NEXT_WEEK_NOT_PLANNED never fires before the org deadline weekday'
);

-- ── 10. Strategic account without champion (D50) ────────────────────────────
select is(pg_temp.exc('NO_CHAMPION', 'd0000000-0000-0000-0000-000000000000'),
  1, 'NO_CHAMPION fires for a strategic account with no champion');

insert into contacts (org_id, account_id, name, is_champion)
values ('11111111-1111-1111-1111-111111111111',
        'd0000000-0000-0000-0000-000000000000', 'Banner Champion', true);
select is(pg_temp.exc('NO_CHAMPION', 'd0000000-0000-0000-0000-000000000000'),
  0, 'NO_CHAMPION clears when a champion is elected');

-- ── 11. Display wall not verified (D52) — tighten the org window to 1 month ─
update organizations set settings = settings || '{"display_verify_months": 1}'
 where id = '11111111-1111-1111-1111-111111111111';
select is(pg_temp.exc('DISPLAY_NOT_VERIFIED', 'd0000000-0000-0000-0000-000000000001'),
  1, 'DISPLAY_NOT_VERIFIED fires past the org verification window');

update accounts set display_last_verified_at = now()
 where id = 'd0000000-0000-0000-0000-000000000001';
select is(pg_temp.exc('DISPLAY_NOT_VERIFIED', 'd0000000-0000-0000-0000-000000000001'),
  0, 'DISPLAY_NOT_VERIFIED clears on verification');

-- ── RLS scoping: exceptions views are security_invoker ──────────────────────
-- The banner account (owner Deon, SoCal) still fires NEW_ACCOUNT_NO_FOLLOW_UP.
create temp table _scope (check_name text primary key, val int);
grant select, insert on _scope to authenticated;

do $$
begin
  perform tests.set_claims('tj@gmxgroup.com', 'gmx-us');
  perform set_config('role', 'authenticated', true);
  insert into _scope
    select 'tj_sees_deons', count(*) from public.exceptions
     where owner_membership_id = 'c0000000-0000-0000-0000-000000000004';
  perform set_config('role', 'postgres', true);

  perform tests.set_claims('bianca@gmxgroup.com', 'gmx-us');
  perform set_config('role', 'authenticated', true);
  insert into _scope
    select 'admin_sees_deons', count(*) from public.exceptions
     where owner_membership_id = 'c0000000-0000-0000-0000-000000000004';
  perform set_config('role', 'postgres', true);
end;
$$;

select is((select val from _scope where check_name = 'tj_sees_deons'), 0,
  'a rep sees no peer-owned exceptions (security_invoker + RLS)');
select cmp_ok((select val from _scope where check_name = 'admin_sees_deons'), '>', 0,
  'admin sees org-wide exceptions');

select * from finish();
rollback;
