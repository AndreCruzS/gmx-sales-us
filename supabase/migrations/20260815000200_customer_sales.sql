-- A customer is whoever GMX sells to — and that is a dealer OR a distributor.
--
-- dashboard_dealer_sales only ever counted dealers, so every linear foot sold
-- to a distributor was invisible on a screen whose whole job is "what are we
-- selling and to whom". Her own ON GOING QUOTES sheet settles it: the column is
-- headed "Dealer / Branch" and the rows say Boise Cascade and Valencia Lumber
-- — a distributor and a dealer, in the same list, because she is recording who
-- she quoted.
--
-- WHO THE CUSTOMER IS, in order:
--   1. the account the deal is booked against, when that account is one of ours
--      to sell to (dealer or distributor);
--   2. otherwise the dealer it runs through — a jobsite deal booked against a
--      contractor is still volume through that door;
--   3. otherwise the distributor it runs through.
-- A deal against a contractor naming neither belongs to nobody and is left out
-- rather than guessed at.
--
-- customer_type rides along so a screen can say which kind it is looking at
-- without a second query or a second rule.

drop view if exists dashboard_dealer_sales;

create view dashboard_customer_sales (
  org_id, owner_id, customer_id, customer_name, customer_type, unit,
  won_qty, out_qty, open_qty,
  won_value, out_value, open_value
) with (security_invoker = true) as
with resolved as (
  select
    o.*,
    coalesce(
      case when pa.account_type in ('DEALER', 'DISTRIBUTOR') then pa.id end,
      o.dealer_id,
      o.distributor_id
    ) as customer_id
  from opportunities o
  left join accounts pa on pa.id = o.primary_account_id
  where o.stage <> 'LOST'
    and o.stage <> 'ON_HOLD'
)
select
  r.org_id,
  r.owner_id,
  c.id,
  c.name,
  c.account_type::text,
  -- One unit per customer row. The trade quotes in linear feet; anything else
  -- is reported under its own unit rather than added to a number it is not.
  coalesce(max(r.quantity_unit), 'LF'),
  coalesce(sum(r.estimated_quantity) filter (where r.stage = 'WON'), 0),
  coalesce(sum(r.estimated_quantity) filter (where r.stage in ('QUOTE', 'DECISION')), 0),
  coalesce(
    sum(r.estimated_quantity) filter (
      where r.stage in ('IDENTIFIED', 'QUALIFIED', 'DEVELOPMENT')
    ),
    0
  ),
  coalesce(sum(r.estimated_revenue) filter (where r.stage = 'WON'), 0),
  coalesce(sum(r.estimated_revenue) filter (where r.stage in ('QUOTE', 'DECISION')), 0),
  coalesce(
    sum(r.estimated_revenue) filter (
      where r.stage in ('IDENTIFIED', 'QUALIFIED', 'DEVELOPMENT')
    ),
    0
  )
from resolved r
join accounts c
  on c.id = r.customer_id
 and c.account_type in ('DEALER', 'DISTRIBUTOR')
group by r.org_id, r.owner_id, c.id, c.name, c.account_type;

comment on view dashboard_customer_sales is
  'Volume and value per customer — dealer or distributor — split won / out for '
  'quote / still open. GMX''s own book; the distributors'' report sees '
  'sell-through that never passed through a quote here.';

grant select on dashboard_customer_sales to authenticated;
