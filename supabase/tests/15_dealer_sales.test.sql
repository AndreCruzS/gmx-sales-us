-- Dealer sales · tests 15: dashboard_dealer_sales
-- (20260814000300_dealer_sales.sql).
--
-- This is the view behind "SEE MORE" on the manager's bars, and the note that
-- asked for it is specific: a breakdown of SALES, BY DEALER, in LINEAR FEET.
-- What these tests hold is the three decisions that make it either true or
-- quietly misleading:
--
-- 1. Which account counts as the dealer. GMX sells through a distributor to a
--    dealer, so dealer_id wins when the channel is known; otherwise the deal's
--    own account counts, but only if it IS a dealer. A contractor deal with no
--    dealer named belongs to nobody and must not be invented.
-- 2. Won, out and open are kept apart. "30.000 LF won" and "20.000 LF out for
--    quote" are different sentences to a manager, and adding them would make a
--    dealer who has bought nothing look like one who has.
-- 3. LOST and ON_HOLD are answers, not volume.
--
-- Seeded fixtures (supabase/seed.sql):
-- deon      = c0000000-0000-0000-0000-000000000004
-- anaheim   = d0000000-0000-0000-0000-000000000001 (30,000 LF won, 24,000 open)
-- orange    = d0000000-0000-0000-0000-000000000002 (20,000 LF out for quote)
-- abc       = d0000000-0000-0000-0000-000000000004 (contractor)

begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;

-- 1. The unit is the trade's, not dollars.
select is(
  (select unit from dashboard_dealer_sales
    where dealer_id = 'd0000000-0000-0000-0000-000000000001'),
  'LF',
  'volume is reported in the unit the opportunity was quoted in'
);

-- 2. Won volume is what the dealer has actually taken — every WON deal on the
--    dealer, this year's 30,000 plus the two historical reorders.
select is(
  (select won_qty from dashboard_dealer_sales
    where dealer_id = 'd0000000-0000-0000-0000-000000000001'),
  61000::numeric,
  'a WON deal counts as won volume'
);

-- 3. A quote sitting with the buyer is NOT won. Orange has 11,000 taken and
--    20,000 priced and waiting; if the two were added the dealer would look
--    like it had bought nearly three times what it has.
select is(
  (select won_qty from dashboard_dealer_sales
    where dealer_id = 'd0000000-0000-0000-0000-000000000002'),
  11000::numeric,
  'volume out for quote is never counted as won'
);

-- 4. …it is out, which is its own sentence.
select is(
  (select out_qty from dashboard_dealer_sales
    where dealer_id = 'd0000000-0000-0000-0000-000000000002'),
  20000::numeric,
  'QUOTE stage volume is reported as out for quote'
);

-- 5. The channel decides the dealer: the Tower deal is booked against a
--    CONTRACTOR but names Ganahl Anaheim as the dealer, so the volume is
--    Anaheim's, not the contractor's.
select is(
  (select open_qty from dashboard_dealer_sales
    where dealer_id = 'd0000000-0000-0000-0000-000000000001'),
  24000::numeric,
  'dealer_id carries a contractor deal to the dealer it runs through'
);

-- 6. …and the contractor itself is not a dealer, so it has no row at all.
select is(
  (select count(*) from dashboard_dealer_sales
    where dealer_id = 'd0000000-0000-0000-0000-000000000004'),
  0::bigint,
  'a contractor never appears as a dealer'
);

-- 7. An answer is not volume.
reset role;
update opportunities set stage = 'LOST'
 where id = 'f0000000-0000-0000-0000-000000000003';
set local role authenticated;
select is(
  (select coalesce(sum(won_qty), 0) from dashboard_dealer_sales
    where dealer_id = 'd0000000-0000-0000-0000-000000000001'),
  31000::numeric,
  'a LOST deal stops counting as won volume — the 30,000 drops out'
);

-- 8. Value rides along for the dealers that have bought.
reset role;
update opportunities set stage = 'WON'
 where id = 'f0000000-0000-0000-0000-000000000003';
set local role authenticated;
select is(
  (select won_value from dashboard_dealer_sales
    where dealer_id = 'd0000000-0000-0000-0000-000000000001'),
  196000.00::numeric,
  'won value is reported beside won volume'
);

-- 9. security_invoker: org2's dealer volume is not in this rep's view.
select is(
  (select count(*) from dashboard_dealer_sales
    where dealer_id = 'd2000000-0000-0000-0000-000000000001'),
  0::bigint,
  'RLS scopes the view — another org''s dealer is invisible'
);

select * from finish();
rollback;
