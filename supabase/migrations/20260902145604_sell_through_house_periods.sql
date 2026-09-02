-- The sell-out side of the stock ledger, by HOUSE (Andre, 2026-09-02): the
-- stock-position read subtracts what a distributor has sold through (the
-- return) from what GMX shipped them (our sell-out, the synced orders). The
-- periods view groups by region; this one groups by the distributor the
-- return belongs to — a handful of rows per house per period, so the desk
-- never ships raw rows to answer a subtraction.

create view sell_through_house_periods
  with (security_invoker = true) as
select
  org_id,
  distributor_id,
  distributor_name,
  period,
  period_kind,
  unit,
  sum(quantity)::numeric as quantity
from sell_through_rows
group by org_id, distributor_id, distributor_name, period, period_kind, unit;

grant select on sell_through_house_periods to authenticated;
