-- Four states for a planned visit, not two.
--
-- The demo's bar (05-manager.html, .pva-track) is not a progress bar. It reads
-- a rep's week as four different facts, and a manager acts differently on each:
--
--   done and logged  — the visit happened and there is a note against it
--   done, owes a note — it happened, nobody wrote down what came of it
--   never happened   — it was planned, the day is gone, nothing was recorded
--   still to come    — planned, and the day has not arrived yet
--
-- Collapsing the last two into one "outstanding" number is the mistake worth
-- avoiding: mileage is reimbursed, so a visit that was planned and never
-- happened is a cost as well as a gap, while one still to come is neither.
--
-- planned_owed and planned_missed are appended (create or replace view keeps
-- the existing columns in place); planned_left stays derived — total minus done
-- minus missed — so the four can never add up to more than the plan.

create or replace view dashboard_plan_by_channel (
  org_id, owner_id, week_start,
  account_id, account_name, account_type,
  distributor_id, distributor_name, distributor_options,
  planned_total, planned_done, planned_owed, planned_missed
--   security_invoker MUST be restated. CREATE OR REPLACE VIEW rewrites the
--   view's options, so omitting it here silently drops the flag and the view
--   starts running as its owner — which means no RLS, and one org reading
--   another's plan. Test 14/10 exists precisely to catch that.
) with (security_invoker = true) as
with link as (
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
    l.account_id                           as account_id,
    count(*)                               as options,
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
  ),
  -- Done, but nothing was written down. The activity exists and its one note
  -- field (D45's what_happened) is empty — which is precisely the state the
  -- rep's own debrief prompt exists to clear.
  count(*) filter (
    where exists (
      select 1 from activities a
       where a.planned_action_id = na.id
         and coalesce(btrim(a.what_happened), '') = ''
    )
  ),
  -- Never happened: the day is behind us and nothing was ever recorded against
  -- the commitment. Today is not yet a miss — the rep still has the afternoon.
  count(*) filter (
    where na.due_date < current_date
      and not exists (select 1 from activities a where a.planned_action_id = na.id)
  )
from next_actions na
left join accounts acc on acc.id = na.account_id
left join supply s on s.account_id = na.account_id
group by
  na.org_id, na.owner_id, date_trunc('week', na.due_date)::date,
  na.account_id, acc.name, acc.account_type,
  s.options, s.distributor_id, s.distributor_name;

comment on view dashboard_plan_by_channel is
  'Weekly plan per rep and per account, with the account''s distributor resolved '
  'from stated supply relationships, and the plan split four ways: done, done '
  'but unwritten, never happened, and (by subtraction) still to come.';
