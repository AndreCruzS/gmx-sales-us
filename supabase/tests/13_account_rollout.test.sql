-- Rollout tracking · tests 13: account_rollout and the derived gate view
-- (20260812000200_account_rollout.sql).
--
-- Two things carry the design and so are what these tests hold:
--
-- 1. The display wall gate is DERIVED, never stored. accounts already carries
--    has_display_wall / display_last_verified_at, and the exception views and
--    the rep's routine read those. A stored copy would drift, so the view must
--    answer from the account columns alone — including when there is no
--    account_rollout row at all.
--
-- 2. gates_done is a COUNT, not a furthest-stage. The real tracker has walls
--    standing with no merchandiser behind them; a stage would report such a
--    branch as further along than it is and hide the gap that is the whole
--    point of the book.
--
-- Seeded fixtures (supabase/seed.sql):
-- org        = 11111111-1111-1111-1111-111111111111
-- membership = c0000000-0000-0000-0000-000000000004 (deon@gmxgroup.com, rep)
-- account    = d0000000-0000-0000-0000-000000000004 (ABC Construction, owner Deon)

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;

-- The rollout view only concerns channel accounts; make the fixture a dealer
-- with a wall that is up but never verified.
update accounts
   set account_type = 'DEALER',
       has_display_wall = true,
       display_last_verified_at = null
 where id = 'd0000000-0000-0000-0000-000000000004';

-- 1. With no account_rollout row the branch reads as untouched, not missing.
select is(
  (select pk_state::text from account_rollout_status
    where account_id = 'd0000000-0000-0000-0000-000000000004'),
  'NO',
  'an account with no rollout row reads NO rather than dropping out of the view'
);

-- 2. A wall that exists but has never been verified is in flight.
select is(
  (select display_wall_state::text from account_rollout_status
    where account_id = 'd0000000-0000-0000-0000-000000000004'),
  'PENDING',
  'wall up but never verified is PENDING, not done'
);

-- 3. ...and it counts for nothing until it is verified.
select is(
  (select gates_done from account_rollout_status
    where account_id = 'd0000000-0000-0000-0000-000000000004'),
  0,
  'an unverified wall does not count towards gates_done'
);

-- 4. Verifying the wall moves the derived gate with no rollout row involved.
update accounts
   set display_last_verified_at = now()
 where id = 'd0000000-0000-0000-0000-000000000004';

select is(
  (select display_wall_state::text from account_rollout_status
    where account_id = 'd0000000-0000-0000-0000-000000000004'),
  'OK',
  'the wall gate derives from the account columns, with nothing stored'
);

select is(
  (select gates_done from account_rollout_status
    where account_id = 'd0000000-0000-0000-0000-000000000004'),
  1,
  'a verified wall counts once'
);

-- 5. A rep may record the gates they own.
insert into account_rollout (account_id, org_id, pk_state, merchandiser_state, material_state)
values (
  'd0000000-0000-0000-0000-000000000004',
  '11111111-1111-1111-1111-111111111111',
  'OK', 'NO', 'OK'
);

-- 6. Gates out of order are reported as they are, not collapsed to a stage.
--    PK done, material in, wall verified, but no merchandiser: three of four.
select is(
  (select gates_done from account_rollout_status
    where account_id = 'd0000000-0000-0000-0000-000000000004'),
  3,
  'gates_done counts completed gates even when they complete out of order'
);

select is(
  (select merchandiser_state::text from account_rollout_status
    where account_id = 'd0000000-0000-0000-0000-000000000004'),
  'NO',
  'the missing middle gate is still reported as missing'
);

-- 7. The aggregate the manager funnel reads.
-- Ganahl Anaheim is genuinely through all four in the seed; the three-gate
-- fixture above is not. If the aggregate counted a partial branch this would
-- read 2 rather than 1.
select is(
  (select fully_through from dashboard_rollout
    where org_id = '11111111-1111-1111-1111-111111111111'),
  1::bigint,
  'a branch three gates in is not counted as fully through'
);

select ok(
  (select branches from dashboard_rollout
    where org_id = '11111111-1111-1111-1111-111111111111') >= 1,
  'the funnel counts the channel accounts this member can see'
);

-- 8. The storage table refuses to hold a wall column, so it cannot drift.
select hasnt_column(
  'public', 'account_rollout', 'display_wall_state',
  'the display wall is derived, so it must not be storable here'
);

-- 9. Cross-org isolation: another org's rollout row is invisible.
select is(
  (select count(*) from account_rollout_status
    where org_id = '22222222-2222-2222-2222-222222222222'),
  0::bigint,
  'RLS keeps another org''s rollout out of the view'
);

-- ── Three states, not two ───────────────────────────────────────────────────
-- Her sheet records ok / pending / no, and counting only the "ok"s made a
-- branch with a merchandiser being hired look like one where nobody had
-- started. Pending is its own count.
select is(
  (select merchandiser_pending from dashboard_rollout
    where org_id = '11111111-1111-1111-1111-111111111111'),
  1::bigint,
  'a gate in progress is counted as pending, not as done and not as nothing'
);

select is(
  (select merchandiser_done from dashboard_rollout
    where org_id = '11111111-1111-1111-1111-111111111111'),
  1::bigint,
  'a pending gate is never counted among the done'
);

-- A distributor is not a branch. The tracker's sections are dealer banners,
-- and counting the houses would inflate every denominator on the book.
select is(
  (select count(*) from account_rollout_status
    where account_id = 'd0000000-0000-0000-0000-000000000005'),
  0::bigint,
  'a DISTRIBUTOR never appears as a rollout branch'
);

select * from finish();
rollback;
