-- Sell-through · tests 16: distributor_branches, sell_through_uploads,
-- sell_through and sell_through_rows (20260815000400_sell_through.sql).
--
-- This is somebody else's data about our business, so what these tests hold is
-- the handful of rules that decide whether a number on a manager's screen can
-- be trusted:
--
-- 1. A BRANCH IS NOT AN ACCOUNT. It is a location in the distributor's network.
--    It must never appear in a rep's account list, and adding Boise's whole
--    footprint must cost the rep nothing.
-- 2. THE CHAIN RESOLVES. rep → distributor → branch → dealer, from one view, so
--    the three tabs cannot disagree about a month.
-- 3. A REP SEES THEIR OWN DEALERS AND NO OTHERS. The fan-out is keyed on the
--    DEALER, because the dealer is what a rep is answerable for.
-- 4. AN UNMATCHED ROW IS ADMIN-ONLY. Nobody can be held to a number whose owner
--    is unknown; it is a data-quality queue, not a result.
-- 5. RELOADING A MONTH CANNOT DOUBLE IT. Rows belong to an upload, and the
--    upload is the unit of replacement.
--
-- Seeded fixtures (supabase/seed.sql):
-- deon        = c0000000-0000-0000-0000-000000000004 (SoCal)
-- tj          = c0000000-0000-0000-0000-000000000003 (Buffalo, no CA dealers)
-- boise       = d0000000-0000-0000-0000-000000000005
-- hardwoods   = d0000000-0000-0000-0000-000000000006
-- valencia    = d0000000-0000-0000-0000-000000000300 (buys from BOTH houses)

begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- ── 1. A branch is not an account ───────────────────────────────────────────

select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;

select is(
  (select count(*) from accounts where name like 'Boise Cascade - %'),
  0::bigint,
  'a distributor branch never becomes an account'
);

select is(
  (select count(*) from distributor_branches
    where distributor_id = 'd0000000-0000-0000-0000-000000000005'),
  8::bigint,
  'Boise''s branch network is visible with the distributor we sell to'
);

-- ── 2. The chain resolves ───────────────────────────────────────────────────

-- Named the way BOISE names it, because that is how the branch is stored: their
-- report has no code column, so the loader can only match on name.
select is(
  (select distributor_name from sell_through_rows
    where branch_name = 'Riverside Branch' limit 1),
  'Boise Cascade',
  'a branch rolls up to the distributor it belongs to'
);

-- Boise reports the BANNER, not the yard: "GANLUGG - GANAHL LUMBER" with no way
-- to know which of Ganahl's nine yards bought it. So the account this attributes
-- to is the banner, and the rep is whoever owns that.
select is(
  (select rep_name from sell_through_rows
    where dealer_name = 'Ganahl Lumber (Banner)' limit 1),
  'Deon Rep',
  'a row is attributed to the rep who owns the dealer'
);

-- A dealer served by two houses is counted under both, and summed once per
-- house — this is the case that would silently double if the chain were wrong.
-- Valencia Lumber & Panel takes cladding off Boise's Riverside yard and off
-- Hardwoods' Los Angeles one.
select is(
  (select count(distinct distributor_name) from sell_through_rows
    where dealer_id = 'd0000000-0000-0000-0000-000000000300'),
  2::bigint,
  'a dealer buying from two houses appears under each of them'
);

-- ── 3. A rep sees their own dealers, and no others ──────────────────────────

select isnt(
  (select count(*) from sell_through),
  0::bigint,
  'a rep sees the sell-through for the dealers they own'
);

select is(
  (select count(*) from sell_through st
    join accounts a on a.id = st.dealer_id
    where a.owner_id <> 'c0000000-0000-0000-0000-000000000004'),
  0::bigint,
  'and never a row for somebody else''s dealer'
);

-- ── 4. An unmatched row is admin-only ───────────────────────────────────────

select is(
  (select count(*) from sell_through where dealer_id is null),
  0::bigint,
  'a rep is not shown volume whose dealer nobody could identify'
);

-- TJ has a book of his own — Russin's Montgomery yard selling to Buffalo Lumber
-- Co — and owns no Californian dealer. So this is the leak test in its strongest
-- form: he sees his own rows, and not one of the Californian ones sitting beside
-- them. Asserting he sees NOTHING would have passed just as happily with a view
-- that returned nothing to anybody.
reset role;
select tests.clear_auth();
select tests.set_claims('tj@gmxgroup.com', 'gmx-us');
set local role authenticated;

select isnt(
  (select count(*) from sell_through),
  0::bigint,
  'a peer sees his own patch'
);

select is(
  (select count(*) from sell_through st
    join distributor_branches b on b.id = st.branch_id
    where b.state <> 'NY'),
  0::bigint,
  'and not one row of anybody else''s, however many sit beside his'
);

-- The admin who uploaded the file sees all of it, unmatched included.
reset role;
select tests.clear_auth();
select tests.set_claims('bianca@gmxgroup.com', 'gmx-us');
set local role authenticated;

-- Boise's real report is full of these: every customer outside a territory GMX
-- covers — Lee Roy Jordan in Dallas, Maximus in Memphis — has volume and no
-- account. Asserted as "there are some and an admin can see them" rather than a
-- count, which would only be measuring how many the fixture happens to carry.
select isnt(
  (select count(*) from sell_through where dealer_id is null),
  0::bigint,
  'an admin sees the unmatched rows, because somebody has to map them'
);

-- The invariant, not a number: what the upload CLAIMS it could not match is what
-- it actually holds. A hardcoded figure here would pass while the counter drifted.
select is(
  (select u.unmatched_count from sell_through_uploads u
    where u.distributor_id = 'd0000000-0000-0000-0000-000000000005'
      and u.period = (date_trunc('month', current_date) - interval '1 month')::date),
  (select count(*)::int from sell_through st
    join sell_through_uploads u on u.id = st.upload_id
    where u.distributor_id = 'd0000000-0000-0000-0000-000000000005'
      and u.period = (date_trunc('month', current_date) - interval '1 month')::date
      and st.dealer_id is null),
  'the upload says how many rows it could not match'
);

-- ── 5. Reloading a month cannot double it ───────────────────────────────────
-- Deleting the upload takes its rows with it, so a reload replaces rather than
-- adds. Without this the second load of a month would quietly double the book.

reset role;
select tests.clear_auth();

with gone as (
  delete from sell_through_uploads
   where distributor_id = 'd0000000-0000-0000-0000-000000000005'
     and period = (date_trunc('month', current_date) - interval '1 month')::date
  returning id
)
select count(*) from gone;

select is(
  (select count(*) from sell_through st
    join distributor_branches b on b.id = st.branch_id
    where b.distributor_id = 'd0000000-0000-0000-0000-000000000005'
      and st.period = (date_trunc('month', current_date) - interval '1 month')::date),
  0::bigint,
  'deleting an upload takes its rows with it, so a month can be reloaded'
);

select * from finish();
rollback;
