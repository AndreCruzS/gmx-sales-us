-- Team calendar · tests 20 (20261012100000_team_calendar.sql).
--
-- 1. One row per org; members read it, nobody but the service role writes.
-- 2. next_actions.calendar_origin only takes 'app' or 'google'.
-- 3. rep_calendars is gone.

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select has_table('public', 'team_calendars', 'team_calendars exists');
select hasnt_table('public', 'rep_calendars', 'rep_calendars is gone');
select col_is_pk('public', 'team_calendars', 'org_id', 'one calendar per org');

insert into team_calendars (org_id, google_calendar_id, owner_membership_id)
values ('11111111-1111-1111-1111-111111111111', 'cal-abc@group.calendar.google.com',
        'c0000000-0000-0000-0000-000000000001');

select tests.set_claims('tj@gmxgroup.com', 'gmx-us');
set local role authenticated;
select results_eq(
  $$ select google_calendar_id from team_calendars $$,
  $$ values ('cal-abc@group.calendar.google.com') $$,
  'an active member reads the org calendar');
-- The project's default grants give authenticated UPDATE on every table
-- (20260722001300_grants.sql); what keeps writes out is the absence of an
-- update policy, so the statement touches no row and raises nothing.
update team_calendars set summary = 'x';
select results_eq(
  $$ select summary from team_calendars $$,
  $$ values ('GMX Sales Team') $$,
  'authenticated cannot write team_calendars');
reset role;

select throws_like(
  $$ update next_actions set calendar_origin = 'outlook'
     where id = (select id from next_actions limit 1) $$,
  '%calendar_origin%',
  'calendar_origin rejects anything but app/google');
select lives_ok(
  $$ update next_actions set calendar_origin = 'google'
     where id = (select id from next_actions limit 1) $$,
  'calendar_origin takes google');

select * from finish();
rollback;
