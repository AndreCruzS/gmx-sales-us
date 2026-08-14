-- Month by month, per CUSTOMER — dealer or distributor.
--
-- dashboard_won_monthly was dealer-only for the same reason the sales view was,
-- and it has to widen with it: picking Boise Cascade on the home page and
-- seeing an empty year would be worse than not being able to pick it at all.
--
-- Same customer rule as dashboard_customer_sales, and the same date rule as
-- before: the month a deal became a sale is the stage event that made it one,
-- not a plan date and not the row's last touch. A deal won more than once
-- counts once; a deal since lost does not count at all.

drop view if exists dashboard_won_monthly;

create view dashboard_won_monthly (
  org_id, owner_id, customer_id, customer_name, customer_type,
  month, unit, won_qty, won_value, deals
) with (security_invoker = true) as
with last_won as (
  select distinct on (e.opportunity_id)
    e.opportunity_id as opportunity_id,
    e.occurred_at    as occurred_at
  from opportunity_stage_events e
  where e.to_stage = 'WON'
  order by e.opportunity_id, e.occurred_at desc
),
resolved as (
  select
    o.*,
    w.occurred_at as won_at,
    coalesce(
      case when pa.account_type in ('DEALER', 'DISTRIBUTOR') then pa.id end,
      o.dealer_id,
      o.distributor_id
    ) as customer_id
  from last_won w
  join opportunities o on o.id = w.opportunity_id and o.stage = 'WON'
  left join accounts pa on pa.id = o.primary_account_id
)
select
  r.org_id,
  r.owner_id,
  c.id,
  c.name,
  c.account_type::text,
  date_trunc('month', r.won_at)::date,
  coalesce(max(r.quantity_unit), 'LF'),
  coalesce(sum(r.estimated_quantity), 0),
  coalesce(sum(r.estimated_revenue), 0),
  count(*)
from resolved r
join accounts c
  on c.id = r.customer_id
 and c.account_type in ('DEALER', 'DISTRIBUTOR')
group by r.org_id, r.owner_id, c.id, c.name, c.account_type,
         date_trunc('month', r.won_at)::date;

comment on view dashboard_won_monthly is
  'Won volume and value per customer per month, dated by the stage event that '
  'made it a sale. Customers are dealers and distributors alike.';

grant select on dashboard_won_monthly to authenticated;
