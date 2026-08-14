-- Month by month, and year to date.
--
-- The sticky note on the manager mockup asked for "análise de todo tipo de
-- dado — Month by Month, Year to date", and every screen so far answers only
-- "this week". The data to answer it has been here all along: D64's
-- opportunity_stage_events records every stage change with the moment it
-- happened, so the month a deal was WON is a fact rather than an estimate.
--
-- WHICH DATE. Not expected_close_date — that is a plan, and plans move. Not
-- updated_at — that moves every time anyone touches the row. The stage event
-- is the only one that means "this is when it became a sale".
--
-- WON ONCE. A deal that was won, reopened and won again has two events, and
-- summing them would sell the same timber twice; only the latest counts. A
-- deal that has since gone LOST is not a sale at all and drops out, because
-- the join is against its CURRENT stage rather than its history.

create view dashboard_won_monthly (
  org_id, owner_id, dealer_id, dealer_name, month, unit, won_qty, won_value, deals
) with (security_invoker = true) as
with last_won as (
  select distinct on (e.opportunity_id)
    e.opportunity_id as opportunity_id,
    e.occurred_at    as occurred_at
  from opportunity_stage_events e
  where e.to_stage = 'WON'
  order by e.opportunity_id, e.occurred_at desc
)
select
  o.org_id,
  o.owner_id,
  d.id,
  d.name,
  date_trunc('month', w.occurred_at)::date,
  coalesce(max(o.quantity_unit), 'LF'),
  coalesce(sum(o.estimated_quantity), 0),
  coalesce(sum(o.estimated_revenue), 0),
  count(*)
from last_won w
join opportunities o
  on o.id = w.opportunity_id
 and o.stage = 'WON'
join accounts d
  on d.id = coalesce(o.dealer_id, o.primary_account_id)
 and d.account_type = 'DEALER'
group by o.org_id, o.owner_id, d.id, d.name, date_trunc('month', w.occurred_at)::date;

comment on view dashboard_won_monthly is
  'Won volume and value per dealer per month, dated by the stage event that '
  'made it a sale. A deal won more than once counts once; a deal since lost '
  'does not count at all.';

grant select on dashboard_won_monthly to authenticated;
