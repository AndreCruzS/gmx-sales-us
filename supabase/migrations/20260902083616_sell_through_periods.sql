-- The catalogue of months — what the book actually holds.
--
-- Until now the desk asked for sell_through_rows newest-first with a blind
-- limit(2000) and kept whatever fit. With one distributor and two files that
-- was the whole book; with five distributors sending months it becomes a
-- truncation that cuts a period in half MID-FILE and silently corrupts even
-- the "this month" reading. The fix is to ask a real question: WHICH periods
-- exist (this view), then fetch rows for exactly the periods being read.
--
-- Grouped by region as well, not just period, so the same view is the
-- backbone of the month-by-month trend when the history arrives: one row per
-- period × region is 12 points a year, not 12 × 186 raw rows.
--
-- security_invoker like every sell-through view: RLS on the base table
-- scopes it to the caller's org.

create view sell_through_periods
  with (security_invoker = true) as
select
  org_id,
  period,
  period_kind,
  region_id,
  region_name,
  unit,
  sum(quantity)::numeric as quantity,
  count(*)::bigint as row_count
from sell_through_rows
group by org_id, period, period_kind, region_id, region_name, unit;

grant select on sell_through_periods to authenticated;
