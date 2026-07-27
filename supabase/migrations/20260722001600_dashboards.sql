-- Phase 5 · migration 16: dashboards + weekly review (spec §15/§16, source PDF §4).
--
-- Everything here is DERIVED (D13: Postgres does the derivation, Vercel only
-- triggers). All views are SECURITY INVOKER, so one view serves every audience:
-- a rep sees their own numbers, a manager their chain, an admin the org — the
-- same RLS that guards the base tables shapes the dashboard.
--
-- D64 (locked 2026-07-27): `opportunity_stage_events` is the single new table in
-- this phase. Both source documents require "opportunities advanced" /
-- "opportunities that advanced" as a headline metric, and stage transitions are
-- not recoverable from `updated_at` (which moves on any edit). The table is
-- APPEND-ONLY and TRIGGER-WRITTEN: no client may insert, update or delete it, so
-- it adds no state a human maintains — it is the audit trail of a write that
-- already happens. This preserves the Phase 5 gate in spirit ("no separate
-- manual reporting", spec §15) while making the metric truthful.

-- ── Stage transition log ────────────────────────────────────────────────────

create table opportunity_stage_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations (id),
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  from_stage     opportunity_stage,          -- null = opportunity created
  to_stage       opportunity_stage not null,
  changed_by     uuid references memberships (id),
  occurred_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index opportunity_stage_events_org_time_idx
  on opportunity_stage_events (org_id, occurred_at desc);
create index opportunity_stage_events_opportunity_idx
  on opportunity_stage_events (opportunity_id);

create trigger set_updated_at
  before update on opportunity_stage_events
  for each row execute function private.set_updated_at();

create or replace function private.record_stage_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.opportunity_stage_events
      (org_id, opportunity_id, from_stage, to_stage, changed_by)
    values (new.org_id, new.id, null, new.stage, private.active_membership_id());
  elsif new.stage is distinct from old.stage then
    insert into public.opportunity_stage_events
      (org_id, opportunity_id, from_stage, to_stage, changed_by)
    values (new.org_id, new.id, old.stage, new.stage, private.active_membership_id());
  end if;
  return null;
end;
$$;

create trigger record_stage_event
  after insert or update of stage on opportunities
  for each row execute function private.record_stage_event();

-- Backfill: existing opportunities get their creation event so the log is
-- complete from day one rather than starting mid-history.
insert into opportunity_stage_events (org_id, opportunity_id, from_stage, to_stage, occurred_at)
select o.org_id, o.id, null, o.stage, o.created_at
from opportunities o;

alter table opportunity_stage_events enable row level security;

create or replace function private.can_see_opportunity(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.opportunities o
    where o.id = p_opportunity_id
      and o.org_id = private.jwt_org_id()
      and (
        o.owner_id in (select private.visible_membership_ids())
        or private.is_admin()
      )
  );
$$;

grant execute on function private.can_see_opportunity(uuid) to authenticated;

-- Read-only for clients; the trigger (definer) is the only writer.
create policy opportunity_stage_events_select on opportunity_stage_events
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_opportunity(opportunity_id))
  );

-- ── Commercial overview: pipeline (spec §15, PDF §4) ────────────────────────

create view dashboard_pipeline (
  org_id, owner_id, territory_id, stage, opportunity_count,
  total_value, weighted_value, oldest_updated_at
) with (security_invoker = true) as
select
  o.org_id,
  o.owner_id,
  o.territory_id,
  o.stage,
  count(*),
  coalesce(sum(o.estimated_revenue), 0),
  -- weighted pipeline = value × probability (spec §15 "Weighted pipeline")
  coalesce(sum(o.estimated_revenue * coalesce(o.probability, 0) / 100.0), 0),
  min(o.updated_at)
from opportunities o
group by o.org_id, o.owner_id, o.territory_id, o.stage;

-- ── Activity mix (spec §15 "Activity", PDF "activity by salesperson/territory")

create view dashboard_activity (
  org_id, owner_id, territory_id, activity_type, week_start,
  activity_count, planned_count
) with (security_invoker = true) as
select
  a.org_id,
  a.owner_id,
  acc.territory_id,
  a.activity_type,
  date_trunc('week', a.occurred_at)::date,
  count(*),
  count(*) filter (where a.was_planned)
from activities a
join accounts acc on acc.id = a.primary_account_id
group by a.org_id, a.owner_id, acc.territory_id, a.activity_type,
         date_trunc('week', a.occurred_at)::date;

-- ── Network development (spec §15 "Network Development") ────────────────────

create view dashboard_network_growth (
  org_id, week_start, account_type, new_accounts
) with (security_invoker = true) as
select
  a.org_id,
  date_trunc('week', a.created_at)::date,
  a.account_type,
  count(*)
from accounts a
group by a.org_id, date_trunc('week', a.created_at)::date, a.account_type;

create view dashboard_relationship_growth (
  org_id, week_start, relationship_type, new_relationships
) with (security_invoker = true) as
select
  r.org_id,
  date_trunc('week', r.created_at)::date,
  r.relationship_type,
  count(*)
from account_relationships r
group by r.org_id, date_trunc('week', r.created_at)::date, r.relationship_type;

-- ── Stage flow: what actually advanced (D64) ───────────────────────

create view dashboard_stage_flow (
  org_id, owner_id, week_start, advanced, won, lost, created
) with (security_invoker = true) as
select
  e.org_id,
  o.owner_id,
  date_trunc('week', e.occurred_at)::date,
  count(*) filter (
    where e.from_stage is not null and e.to_stage not in ('WON', 'LOST', 'ON_HOLD')
  ),
  count(*) filter (where e.to_stage = 'WON'),
  count(*) filter (where e.to_stage = 'LOST'),
  count(*) filter (where e.from_stage is null)
from opportunity_stage_events e
join opportunities o on o.id = e.opportunity_id
group by e.org_id, o.owner_id, date_trunc('week', e.occurred_at)::date;

-- ── Planned vs actual (D46 — the manager's real question) ───────────────────

create view dashboard_planned_vs_actual (
  org_id, owner_id, week_start, planned_total, planned_done, unplanned
) with (security_invoker = true) as
with planned as (
  select
    na.org_id                                as org_id,
    na.owner_id                              as owner_id,
    date_trunc('week', na.due_date)::date    as week_start,
    count(*)                                 as planned_total,
    count(*) filter (
      where exists (select 1 from activities a where a.planned_action_id = na.id)
    )                                        as planned_done
  from next_actions na
  group by na.org_id, na.owner_id, date_trunc('week', na.due_date)::date
),
actual as (
  select
    a.org_id                                  as org_id,
    a.owner_id                                as owner_id,
    date_trunc('week', a.occurred_at)::date   as week_start,
    count(*) filter (where not a.was_planned) as unplanned
  from activities a
  group by a.org_id, a.owner_id, date_trunc('week', a.occurred_at)::date
)
select
  coalesce(p.org_id, x.org_id),
  coalesce(p.owner_id, x.owner_id),
  coalesce(p.week_start, x.week_start),
  coalesce(p.planned_total, 0),
  coalesce(p.planned_done, 0),
  coalesce(x.unplanned, 0)
from planned p
full outer join actual x
  on  p.org_id     = x.org_id
  and p.owner_id   = x.owner_id
  and p.week_start = x.week_start;

-- ── Rep scorecard (spec §15 "Sales Representative") ─────────────────────────

create view dashboard_rep_scorecard (
  org_id, membership_id, rep_name, territory_id, territory_name,
  activities_30d, open_opportunities, pipeline_value, weighted_value,
  open_next_actions, overdue_next_actions, quotes_outstanding, last_activity_at
) with (security_invoker = true) as
select
  m.org_id,
  m.id,
  coalesce(u.full_name, u.email),
  m.territory_id,
  t.name,
  (select count(*) from activities a
    where a.owner_id = m.id and a.occurred_at > now() - interval '30 days'),
  (select count(*) from opportunities o
    where o.owner_id = m.id and o.stage not in ('WON', 'LOST')),
  (select coalesce(sum(o.estimated_revenue), 0) from opportunities o
    where o.owner_id = m.id and o.stage not in ('WON', 'LOST')),
  (select coalesce(sum(o.estimated_revenue * coalesce(o.probability, 0) / 100.0), 0)
     from opportunities o
    where o.owner_id = m.id and o.stage not in ('WON', 'LOST')),
  (select count(*) from next_actions na
    where na.owner_id = m.id and na.completed_at is null),
  (select count(*) from next_actions na
    where na.owner_id = m.id and na.completed_at is null and na.due_date < current_date),
  (select count(*) from opportunities o
    where o.owner_id = m.id and o.stage = 'QUOTE'),
  (select max(a.occurred_at) from activities a where a.owner_id = m.id)
from memberships m
join users u on u.id = m.user_id
left join territories t on t.id = m.territory_id
where m.status = 'active'
  and m.role in ('rep', 'manager');

-- ── Territory rollup (spec §15 "Territory") ─────────────────────────────────

create view dashboard_territory (
  org_id, territory_id, territory_name, account_count, strategic_accounts,
  accounts_with_activity_30d, open_opportunities, pipeline_value, project_count
) with (security_invoker = true) as
select
  t.org_id,
  t.id,
  t.name,
  (select count(*) from accounts a where a.territory_id = t.id),
  (select count(*) from accounts a
    where a.territory_id = t.id and a.strategic_importance = 'STRATEGIC'),
  (select count(distinct a.id) from accounts a
    where a.territory_id = t.id
      and exists (select 1 from activities act
                   where act.primary_account_id = a.id
                     and act.occurred_at > now() - interval '30 days')),
  (select count(*) from opportunities o
    where o.territory_id = t.id and o.stage not in ('WON', 'LOST')),
  (select coalesce(sum(o.estimated_revenue), 0) from opportunities o
    where o.territory_id = t.id and o.stage not in ('WON', 'LOST')),
  (select count(distinct ps.project_id)
     from project_stakeholders ps
     join accounts a on a.id = ps.account_id
    where a.territory_id = t.id)
from territories t;

-- ── Weekly commercial review inputs (spec §16, PDF §4) ──────────────────────
-- Windows are deliberately generous (±14 days) with a week_start column, so the
-- app can render "last week" on a Monday or "this week" on a Friday from the
-- same view without a second round trip.

create view weekly_review_recent_activity (
  org_id, owner_id, activity_id, occurred_at, week_start, activity_type,
  account_name, account_type, what_happened, key_information,
  commercial_potential, outcomes, was_planned, follow_up_required
) with (security_invoker = true) as
select
  a.org_id,
  a.owner_id,
  a.id,
  a.occurred_at,
  date_trunc('week', a.occurred_at)::date,
  a.activity_type,
  acc.name,
  acc.account_type,
  a.what_happened,
  a.key_information,
  a.commercial_potential,
  a.outcomes,
  a.was_planned,
  a.follow_up_required
from activities a
join accounts acc on acc.id = a.primary_account_id
where a.occurred_at > now() - interval '14 days';

create view weekly_review_upcoming (
  org_id, owner_id, next_action_id, action, due_date, week_start,
  account_name, objective, opportunity_name
) with (security_invoker = true) as
select
  na.org_id,
  na.owner_id,
  na.id,
  na.action,
  na.due_date,
  date_trunc('week', na.due_date)::date,
  acc.name,
  na.objective,
  o.name
from next_actions na
left join accounts acc on acc.id = na.account_id
left join opportunities o on o.id = na.opportunity_id
where na.completed_at is null
  and na.due_date between current_date - 7 and current_date + 14;

-- New commercial objects in the review window (spec §16 "New projects / New
-- opportunities / New relationships").
create view weekly_review_new_objects (
  org_id, owner_id, object_type, object_id, name, created_at
) with (security_invoker = true) as
select o.org_id, o.owner_id, 'opportunity'::text, o.id, o.name, o.created_at
  from opportunities o
 where o.created_at > now() - interval '14 days'
union all
select a.org_id, a.owner_id, 'account'::text, a.id, a.name, a.created_at
  from accounts a
 where a.created_at > now() - interval '14 days'
union all
select p.org_id, p.created_by, 'project'::text, p.id, p.name, p.created_at
  from projects p
 where p.created_at > now() - interval '14 days';
