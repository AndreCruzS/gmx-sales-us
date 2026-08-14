-- The week's plan, broken out by the channel it belongs to.
--
-- Leadership marked up the manager view (13 Aug 2026) asking for the "did they
-- do what they said" bars to split by DISTRIBUTOR — Boise, Hardwoods, Russin —
-- and for the team lens to switch between rep, distributor and dealer. This
-- view is the one place that attribution is decided, so the bars, the lens and
-- any later report all read the same numbers.
--
-- ATTRIBUTION. A visit is planned against an account. If that account is a
-- dealer, the distributor is whoever the trade says supplies it — which the
-- data already carries in account_relationships, as a stated direction:
--
--     "A SUPPLIES B"       → A is upstream of B
--     "A PURCHASES_FROM B" → B is upstream of A
--
-- (The same rule src/lib/domain/chain.ts applies on the account page. Only
-- those two types state a direction; WORKS_WITH and the professional roles do
-- not, and inverting them would be inventing a channel.)
--
-- A dealer supplied by two distributors is NOT silently filed under one of
-- them. `distributor_options` reports how many were found, and the id and name
-- are null unless the answer is unambiguous — a bar that splits a rep's week
-- between Boise and Hardwoods has to be right about which visit was whose, and
-- guessing would make the chart worse than not having it. The real per-dealer
-- sales figures still live in the distributors' shared spreadsheet; when that
-- lands it can settle the ambiguous ones properly.

create view dashboard_plan_by_channel (
  org_id, owner_id, week_start,
  account_id, account_name, account_type,
  distributor_id, distributor_name, distributor_options,
  planned_total, planned_done
) with (security_invoker = true) as
with link as (
  -- every stated supply direction, normalised to (downstream, upstream)
  select r.account_b_id as account_id, r.account_a_id as distributor_id
    from account_relationships r
   where r.relationship_type = 'SUPPLIES'
  union
  select r.account_a_id as account_id, r.account_b_id as distributor_id
    from account_relationships r
   where r.relationship_type = 'PURCHASES_FROM'
),
supply as (
  select
    l.account_id                        as account_id,
    count(*)                            as options,
    -- Only ever read when options = 1, so both aggregates come off the one
    -- surviving row; above that the columns below null them out anyway.
    (array_agg(d.id order by d.name))[1]   as distributor_id,
    (array_agg(d.name order by d.name))[1] as distributor_name
  from link l
  join accounts d
    on d.id = l.distributor_id
   and d.account_type = 'DISTRIBUTOR'
  group by l.account_id
)
select
  na.org_id,
  na.owner_id,
  date_trunc('week', na.due_date)::date,
  na.account_id,
  acc.name,
  acc.account_type,
  case when s.options = 1 then s.distributor_id end,
  case when s.options = 1 then s.distributor_name end,
  coalesce(s.options, 0),
  count(*),
  count(*) filter (
    where exists (select 1 from activities a where a.planned_action_id = na.id)
  )
from next_actions na
left join accounts acc on acc.id = na.account_id
left join supply s on s.account_id = na.account_id
group by
  na.org_id, na.owner_id, date_trunc('week', na.due_date)::date,
  na.account_id, acc.name, acc.account_type,
  s.options, s.distributor_id, s.distributor_name;

comment on view dashboard_plan_by_channel is
  'Weekly plan vs kept, per rep and per account, with the account''s distributor '
  'resolved from stated supply relationships. distributor_id is null unless '
  'exactly one distributor was found (see distributor_options).';

grant select on dashboard_plan_by_channel to authenticated;
