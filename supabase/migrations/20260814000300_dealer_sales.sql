-- What each dealer is moving.
--
-- The markup on the manager view (13 Aug 2026) put a "SEE MORE" on every rep's
-- bar and said what it should open:
--
--   ESSE "SEE MORE" NOS DARIA "UM BREAKDOWN DE VENDAS" BY DEALER:
--     ganhou – 30.000 LF · vs 20.000 LF · abaixo 40.000 LF
--   Consta no relatório dos distribuidores.
--
-- So the unit is LINEAR FEET, not dollars, and the grain is the DEALER. Both
-- are already in this schema: opportunities carry estimated_quantity with a
-- quantity_unit beside it, and they name the dealer they run through. Nothing
-- new had to be invented — the figures were simply never read this way.
--
-- WHICH ACCOUNT IS THE DEALER. GMX sells through a distributor to a dealer, so
-- an opportunity names the dealer explicitly when the channel is known
-- (dealer_id). When it does not, the opportunity's own account is the dealer if
-- it is one — a deal booked straight against Ganahl Anaheim is Ganahl's volume.
-- A deal against a contractor with no dealer named is nobody's dealer volume
-- and is left out rather than guessed at.
--
-- WON vs OUT vs OPEN mirrors the three the note asks for: what they have taken,
-- what is priced and waiting on them, and what is still being worked. LOST and
-- ON_HOLD are answers, not volume, and are excluded.
--
-- This is GMX's own book. The distributors' shared spreadsheet sees sell-through
-- that never passed through a quote here, so it will add to this rather than
-- agree with it — which is the honest reason the screen names its source.

create view dashboard_dealer_sales (
  org_id, owner_id, dealer_id, dealer_name, unit,
  won_qty, out_qty, open_qty,
  won_value, out_value, open_value
) with (security_invoker = true) as
select
  o.org_id,
  o.owner_id,
  d.id,
  d.name,
  -- One unit per dealer row. The trade quotes in linear feet; anything else is
  -- reported under its own unit rather than added to a number it is not.
  coalesce(max(o.quantity_unit), 'LF'),
  coalesce(sum(o.estimated_quantity) filter (where o.stage = 'WON'), 0),
  coalesce(sum(o.estimated_quantity) filter (where o.stage in ('QUOTE', 'DECISION')), 0),
  coalesce(
    sum(o.estimated_quantity) filter (
      where o.stage in ('IDENTIFIED', 'QUALIFIED', 'DEVELOPMENT')
    ),
    0
  ),
  coalesce(sum(o.estimated_revenue) filter (where o.stage = 'WON'), 0),
  coalesce(sum(o.estimated_revenue) filter (where o.stage in ('QUOTE', 'DECISION')), 0),
  coalesce(
    sum(o.estimated_revenue) filter (
      where o.stage in ('IDENTIFIED', 'QUALIFIED', 'DEVELOPMENT')
    ),
    0
  )
from opportunities o
join accounts d
  on d.id = coalesce(o.dealer_id, o.primary_account_id)
 and d.account_type = 'DEALER'
where o.stage <> 'LOST'
  and o.stage <> 'ON_HOLD'
group by o.org_id, o.owner_id, d.id, d.name;

comment on view dashboard_dealer_sales is
  'Volume and value per dealer, split won / out for quote / still open. Counts '
  'GMX''s own book only — the distributors'' report sees sell-through that never '
  'passed through a quote here.';

grant select on dashboard_dealer_sales to authenticated;
