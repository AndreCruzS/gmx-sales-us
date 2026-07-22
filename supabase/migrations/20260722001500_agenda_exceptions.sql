-- Phase 3 · migration 15: exception engine (spec §8, D47/D50/D52) + snapshots.
--
-- Every exception is a SECURITY INVOKER view: the caller's RLS decides which
-- rows they see (rep = own scope, manager = chain, admin = org). Thresholds
-- are per-org via organizations.settings jsonb, with defaults inline.
-- private.scan_exceptions() materializes an org-wide snapshot (security
-- definer) for alerting; pg_cron triggers it hourly (D13: Postgres does the
-- derivation).

alter table organizations
  add column settings jsonb not null default '{}';

-- 1. Opportunity without next action (spec §8; post-stage-gate drift:
--    completing the last open action reopens the gap).
create view exception_opportunity_no_next_action
  with (security_invoker = true) as
select
  'OPPORTUNITY_NO_NEXT_ACTION'::text as exception_type,
  o.org_id,
  'opportunity'::text as subject_type,
  o.id as subject_id,
  o.owner_id as owner_membership_id,
  o.name as title,
  'stage ' || o.stage || ' with no open next action' as detail,
  o.updated_at as since
from opportunities o
where o.stage not in ('WON', 'LOST')
  and not exists (
    select 1 from next_actions na
    where na.opportunity_id = o.id and na.completed_at is null
  );

-- 2. Overdue follow-up.
create view exception_overdue_follow_up (exception_type, org_id, subject_type, subject_id, owner_membership_id, title, detail, since)
  with (security_invoker = true) as
select
  'OVERDUE_FOLLOW_UP'::text,
  na.org_id,
  'next_action'::text,
  na.id,
  na.owner_id,
  na.action,
  'due ' || na.due_date::text,
  na.due_date::timestamptz
from next_actions na
where na.completed_at is null
  and na.due_date < current_date;

-- 3. Quote without follow-up: QUOTE-stage opportunity with no follow-up
--    scheduled inside the org's window (default 5 days).
create view exception_quote_no_follow_up (exception_type, org_id, subject_type, subject_id, owner_membership_id, title, detail, since)
  with (security_invoker = true) as
select
  'QUOTE_NO_FOLLOW_UP'::text,
  o.org_id,
  'opportunity'::text,
  o.id,
  o.owner_id,
  o.name,
  'quote outstanding with no follow-up scheduled within '
    || coalesce((org.settings ->> 'quote_followup_days')::int, 5) || ' days',
  o.updated_at
from opportunities o
join organizations org on org.id = o.org_id
where o.stage = 'QUOTE'
  and not exists (
    select 1 from next_actions na
    where na.opportunity_id = o.id
      and na.completed_at is null
      and na.due_date <= current_date
        + coalesce((org.settings ->> 'quote_followup_days')::int, 5)
  );

-- 4. Strategic account without recent activity (default 30 days).
create view exception_strategic_account_quiet (exception_type, org_id, subject_type, subject_id, owner_membership_id, title, detail, since)
  with (security_invoker = true) as
select
  'STRATEGIC_ACCOUNT_QUIET'::text,
  a.org_id,
  'account'::text,
  a.id,
  a.owner_id,
  a.name,
  'no activity in '
    || coalesce((org.settings ->> 'strategic_quiet_days')::int, 30) || ' days',
  a.updated_at
from accounts a
join organizations org on org.id = a.org_id
where a.strategic_importance = 'STRATEGIC'
  and not exists (
    select 1 from activities act
    where act.primary_account_id = a.id
      and act.occurred_at > now()
        - make_interval(days => coalesce((org.settings ->> 'strategic_quiet_days')::int, 30))
  )
  and not exists (
    select 1
    from activity_accounts aa
    join activities act2 on act2.id = aa.activity_id
    where aa.account_id = a.id
      and act2.occurred_at > now()
        - make_interval(days => coalesce((org.settings ->> 'strategic_quiet_days')::int, 30))
  );

-- 5. Opportunity inactive beyond a defined period (default 21 days).
create view exception_opportunity_stale (exception_type, org_id, subject_type, subject_id, owner_membership_id, title, detail, since)
  with (security_invoker = true) as
select
  'OPPORTUNITY_STALE'::text,
  o.org_id,
  'opportunity'::text,
  o.id,
  o.owner_id,
  o.name,
  'no linked activity or edit in '
    || coalesce((org.settings ->> 'opportunity_stale_days')::int, 21) || ' days',
  o.updated_at
from opportunities o
join organizations org on org.id = o.org_id
where o.stage not in ('WON', 'LOST')
  and o.updated_at < now()
    - make_interval(days => coalesce((org.settings ->> 'opportunity_stale_days')::int, 21))
  and not exists (
    select 1 from activities act
    where act.opportunity_id = o.id
      and act.occurred_at > now()
        - make_interval(days => coalesce((org.settings ->> 'opportunity_stale_days')::int, 21))
  );

-- 6. Project without assigned dealer.
create view exception_project_no_dealer (exception_type, org_id, subject_type, subject_id, owner_membership_id, title, detail, since)
  with (security_invoker = true) as
select
  'PROJECT_NO_DEALER'::text,
  p.org_id,
  'project'::text,
  p.id,
  p.created_by,
  p.name,
  'status ' || p.status || ' with no dealer stakeholder',
  p.updated_at
from projects p
where p.status not in ('COMPLETED', 'CANCELLED')
  and not exists (
    select 1 from project_stakeholders ps
    where ps.project_id = p.id and ps.stakeholder_role = 'DEALER'
  );

-- 7. Contractor relationship not updated (default 90 days since confirmed).
create view exception_contractor_relationship_stale (exception_type, org_id, subject_type, subject_id, owner_membership_id, title, detail, since)
  with (security_invoker = true) as
select
  'CONTRACTOR_RELATIONSHIP_STALE'::text,
  r.org_id,
  'account_relationship'::text,
  r.id,
  r.created_by,
  ca.name || ' — ' || r.relationship_type || ' — ' || cb.name,
  'not confirmed in '
    || coalesce((org.settings ->> 'contractor_relationship_days')::int, 90) || ' days',
  coalesce(r.last_confirmed_at, r.created_at)
from account_relationships r
join organizations org on org.id = r.org_id
join accounts ca on ca.id = r.account_a_id
join accounts cb on cb.id = r.account_b_id
where (ca.account_type = 'CONTRACTOR' or cb.account_type = 'CONTRACTOR')
  and coalesce(r.last_confirmed_at, r.created_at) < now()
    - make_interval(days => coalesce((org.settings ->> 'contractor_relationship_days')::int, 90));

-- 8. New account with no follow-up (default: first 30 days).
create view exception_new_account_no_follow_up (exception_type, org_id, subject_type, subject_id, owner_membership_id, title, detail, since)
  with (security_invoker = true) as
select
  'NEW_ACCOUNT_NO_FOLLOW_UP'::text,
  a.org_id,
  'account'::text,
  a.id,
  a.owner_id,
  a.name,
  'created ' || a.created_at::date || ' with no next action scheduled',
  a.created_at
from accounts a
join organizations org on org.id = a.org_id
where a.created_at > now()
    - make_interval(days => coalesce((org.settings ->> 'new_account_days')::int, 30))
  and not exists (
    select 1 from next_actions na where na.account_id = a.id
  );

-- 9. Next week not planned (D47): reps must have next week's agenda ready by
--    Friday. planning_deadline_isodow (default 5 = Friday) is org-configurable,
--    which also makes the rule deterministic under test.
create view exception_next_week_not_planned (exception_type, org_id, subject_type, subject_id, owner_membership_id, title, detail, since)
  with (security_invoker = true) as
select
  'NEXT_WEEK_NOT_PLANNED'::text,
  m.org_id,
  'membership'::text,
  m.id,
  m.id,
  coalesce(u.full_name, u.email),
  'no agenda items scheduled for next week',
  date_trunc('week', now())::timestamptz
from memberships m
join organizations org on org.id = m.org_id
join users u on u.id = m.user_id
where m.role = 'rep'
  and m.status = 'active'
  and extract(isodow from now())
    >= coalesce((org.settings ->> 'planning_deadline_isodow')::int, 5)
  and not exists (
    select 1 from next_actions na
    where na.owner_id = m.id
      and na.due_date >= (date_trunc('week', current_date)::date + 7)
      and na.due_date <  (date_trunc('week', current_date)::date + 14)
  );

-- 10. Strategic account without champion (D50).
create view exception_no_champion (exception_type, org_id, subject_type, subject_id, owner_membership_id, title, detail, since)
  with (security_invoker = true) as
select
  'NO_CHAMPION'::text,
  a.org_id,
  'account'::text,
  a.id,
  a.owner_id,
  a.name,
  'strategic account with no elected champion',
  a.updated_at
from accounts a
where a.strategic_importance = 'STRATEGIC'
  and not exists (
    select 1 from contacts c where c.account_id = a.id and c.is_champion
  );

-- 11. Display wall not verified in N months (D52, default 6).
create view exception_display_not_verified (exception_type, org_id, subject_type, subject_id, owner_membership_id, title, detail, since)
  with (security_invoker = true) as
select
  'DISPLAY_NOT_VERIFIED'::text,
  a.org_id,
  'account'::text,
  a.id,
  a.owner_id,
  a.name,
  case
    when a.display_last_verified_at is null then 'display wall never verified'
    else 'display wall last verified ' || a.display_last_verified_at::date
  end,
  coalesce(a.display_last_verified_at, a.created_at)
from accounts a
join organizations org on org.id = a.org_id
where a.has_display_wall
  and (
    a.display_last_verified_at is null
    or a.display_last_verified_at < now()
      - make_interval(months => coalesce((org.settings ->> 'display_verify_months')::int, 6))
  );

-- The union the app queries: "Requires Attention" (spec §3 home + §14).
create view exceptions
  with (security_invoker = true) as
select * from exception_opportunity_no_next_action
union all select * from exception_overdue_follow_up
union all select * from exception_quote_no_follow_up
union all select * from exception_strategic_account_quiet
union all select * from exception_opportunity_stale
union all select * from exception_project_no_dealer
union all select * from exception_contractor_relationship_stale
union all select * from exception_new_account_no_follow_up
union all select * from exception_next_week_not_planned
union all select * from exception_no_champion
union all select * from exception_display_not_verified;

-- Snapshot for alerting/trending: the cron scan upserts open exceptions and
-- closes resolved ones. History is kept (cleared rows stay).
create table exception_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations (id),
  exception_type      text not null,
  subject_type        text not null,
  subject_id          uuid not null,
  owner_membership_id uuid references memberships (id),
  title               text,
  detail              text,
  detected_at         timestamptz not null default now(),
  cleared_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index exception_snapshots_open_unique
  on exception_snapshots (org_id, exception_type, subject_id)
  where cleared_at is null;
create index exception_snapshots_org_open_idx
  on exception_snapshots (org_id, detected_at)
  where cleared_at is null;

create trigger set_updated_at
  before update on exception_snapshots
  for each row execute function private.set_updated_at();

alter table exception_snapshots enable row level security;

create policy exception_snapshots_select on exception_snapshots
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_membership_id in (select private.visible_membership_ids())
      or (select private.is_admin())
    )
  );
-- no client writes: the scan owns this table.

-- The scan (security definer: snapshots are org-wide, beyond any one caller's
-- RLS scope). Reads the same views — definer bypasses invoker RLS.
create or replace function private.scan_exceptions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- close exceptions that no longer fire
  update public.exception_snapshots s
     set cleared_at = now()
   where s.cleared_at is null
     and not exists (
       select 1 from public.exceptions e
       where e.org_id = s.org_id
         and e.exception_type = s.exception_type
         and e.subject_id = s.subject_id
     );

  -- open newly-firing exceptions
  insert into public.exception_snapshots
    (org_id, exception_type, subject_type, subject_id, owner_membership_id, title, detail)
  select e.org_id, e.exception_type, e.subject_type, e.subject_id,
         e.owner_membership_id, e.title, e.detail
  from public.exceptions e
  on conflict (org_id, exception_type, subject_id) where cleared_at is null
  do nothing;
end;
$$;

revoke execute on function private.scan_exceptions() from public, anon, authenticated;

-- Hourly scan via pg_cron where available (hosted Supabase + local stack).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('exception-scan', '15 * * * *',
                          'select private.scan_exceptions()');
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end;
$$;
