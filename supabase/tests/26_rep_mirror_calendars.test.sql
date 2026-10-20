-- Rep mirror calendars · tests 26 (20261020140000_rep_mirror_calendars.sql).
--
-- A rep reads their own mirror's row and nobody else's; an admin reads all;
-- nobody writes it but the service role.

begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into rep_mirror_calendars (membership_id, org_id, google_calendar_id) values
  ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'cal-deon'),
  ('c0000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'cal-jason');

select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;

select is((select count(*) from rep_mirror_calendars), 1::bigint,
  'a rep reads one mirror');
select is((select google_calendar_id from rep_mirror_calendars), 'cal-deon',
  'and it is their own');
select throws_ok(
  $$ insert into rep_mirror_calendars (membership_id, org_id, google_calendar_id)
     values ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'x') $$,
  '42501', null, 'a rep cannot write a mirror row');

reset role;
select tests.set_claims('bianca@gmxgroup.com', 'gmx-us');
set local role authenticated;

select is((select count(*) from rep_mirror_calendars), 2::bigint,
  'an admin reads every rep''s');

reset role;
select tests.clear_auth();
select * from finish();
rollback;
