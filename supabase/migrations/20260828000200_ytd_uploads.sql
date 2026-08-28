-- A file can cover the YEAR SO FAR, and say what last year was.
--
-- Boise's own export (Cory Dalos, 24 Jun 2026) is one aggregate from January
-- to the day it was cut, with an LY column beside it — no months inside it to
-- recover. Bianca wants that data in the book anyway: who has bought the most
-- this year is a question a monthly file cannot answer until the year is over.
--
-- So an upload now says WHAT KIND of window it is. MONTH stays the default and
-- the monthly reading stays pure — YTD uploads never take part in the
-- latest/previous pair. The YTD reading compares against ly_quantity instead:
-- the same window, one year back, which is the only comparison such a file can
-- honestly make. The importer has recognised the "LY Qty" column since the
-- mapping was built; until now it threw the number away.

create type sell_period_kind as enum ('MONTH', 'YTD');

alter table sell_through_uploads
  add column if not exists period_kind sell_period_kind not null default 'MONTH';

comment on column sell_through_uploads.period_kind is
  'MONTH: the period is that month alone. YTD: January through the period, one '
  'aggregate — excluded from month-over-month reads, compared against '
  'ly_quantity instead.';

alter table sell_through
  add column if not exists ly_quantity numeric(14, 2);

comment on column sell_through.ly_quantity is
  'The same window one year earlier, from the file''s own LY column, in linear '
  'feet. Null when the file did not say. A row may carry quantity 0 with an LY '
  'figure: business that existed last year and stopped — the most actionable '
  'line in the file.';

-- The view gains the two facts at the END, so every existing reader keeps its
-- columns where they were. security_invoker restated: CREATE OR REPLACE VIEW
-- rewrites a view's options, and omitting it silently drops RLS.
drop view if exists sell_through_rows;

create view sell_through_rows (
  org_id, period,
  rep_id, rep_name,
  region_id, region_name,
  market_owner_id, market_owner_name,
  distributor_id, distributor_name,
  branch_id, branch_name, branch_city, branch_state,
  dealer_id, dealer_name, dealer_label,
  product, quantity, unit, value,
  ly_quantity, period_kind
) with (security_invoker = true) as
select
  st.org_id,
  st.period,
  case when b.territory_id is not null then owner.id else d.owner_id end,
  case
    when b.territory_id is not null
      then (select coalesce(ou.full_name, ou.email) from users ou where ou.id = owner.user_id)
    else coalesce(du.full_name, du.email)
  end,
  t.id,
  t.name,
  owner.id,
  (select coalesce(ou.full_name, ou.email) from users ou where ou.id = owner.user_id),
  dist.id,
  dist.name,
  b.id,
  b.name,
  b.city,
  b.state,
  d.id,
  d.name,
  st.dealer_label,
  st.product,
  st.quantity,
  st.unit,
  st.value,
  st.ly_quantity,
  u.period_kind
from sell_through st
join sell_through_uploads u on u.id = st.upload_id
join distributor_branches b on b.id = st.branch_id
join accounts dist on dist.id = b.distributor_id
left join territories t on t.id = b.territory_id
left join lateral (
  select m2.id, m2.user_id
    from memberships m2
   where m2.territory_id = t.id
     and m2.org_id = st.org_id
     and m2.role = 'rep'
   order by m2.created_at
   limit 1
) as owner on true
left join accounts d on d.id = st.dealer_id
left join memberships m on m.id = d.owner_id
left join users du on du.id = m.user_id;

comment on view sell_through_rows is
  'Sell-through with the whole chain attached, plus the window kind (month or '
  'year-to-date) and last year''s figure for the same window. RLS is inherited '
  'from sell_through.';

grant select on sell_through_rows to authenticated;
