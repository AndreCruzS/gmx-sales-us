-- Phase 1 · migration 6: the loop — projects, opportunities, activities,
-- joins, next_actions, and the opportunity stage gate (D5, D6, D45–D48, Rule 3).
--
-- Creation order handles the activities ↔ next_actions circular reference:
-- activities.planned_action_id is added after next_actions exists.

-- Project ≠ Opportunity (D5). Projects are convergence points with no owner in
-- the spec; created_by is attribution, not an RLS ownership boundary.
create table projects (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references organizations (id),
  name                        text not null,
  location                    text,
  project_type                text,
  estimated_construction_date date,
  estimated_completion_date   date,
  status                      project_status not null default 'PLANNING',
  estimated_size              text,
  notes                       text,
  created_by                  uuid references memberships (id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (org_id, name)
);

create trigger set_updated_at
  before update on projects
  for each row execute function private.set_updated_at();

create table project_stakeholders (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations (id),
  project_id       uuid not null references projects (id) on delete cascade,
  account_id       uuid not null references accounts (id),
  stakeholder_role project_stakeholder_role not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, project_id, account_id, stakeholder_role)
);

create trigger set_updated_at
  before update on project_stakeholders
  for each row execute function private.set_updated_at();

create table opportunities (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations (id),
  name                 text not null,
  project_id           uuid references projects (id),
  primary_account_id   uuid not null references accounts (id),
  territory_id         uuid not null references territories (id),
  owner_id             uuid not null references memberships (id),
  product              text,
  application          text,
  estimated_quantity   numeric,
  quantity_unit        text,
  estimated_revenue    numeric(14, 2),
  probability          smallint,
  expected_close_date  date,
  -- channel: they run the full sale and hand it to a dealer (spec §10)
  distributor_id       uuid references accounts (id),
  dealer_id            uuid references accounts (id),
  -- influencers
  architect_id         uuid references accounts (id),
  contractor_id        uuid references accounts (id),
  builder_id           uuid references accounts (id),
  developer_id         uuid references accounts (id),
  competitor           text,
  alternative_product  text,
  risk                 text,
  stage                opportunity_stage not null default 'IDENTIFIED',
  current_status       text,
  current_blocker      text,
  lead_source          lead_source_value not null, -- D6: on Opportunity too
  source_detail        text,
  referring_account_id uuid references accounts (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (probability is null or probability between 0 and 100),
  check (lead_source <> 'OTHER' or source_detail is not null),                          -- D8
  check (not private.is_referral_lead_source(lead_source)
         or referring_account_id is not null)                                           -- D7
);

create trigger set_updated_at
  before update on opportunities
  for each row execute function private.set_updated_at();

create table activities (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations (id),
  activity_type      activity_type not null,
  primary_account_id uuid not null references accounts (id),
  owner_id           uuid not null references memberships (id),
  occurred_at        timestamptz not null default now(),
  location           text,
  purpose            text,
  -- Planned vs actual is first-class (D46); planned_action_id is added below
  -- once next_actions exists. planned_not_done is derived, never stored.
  was_planned        boolean not null default false,
  objective          visit_objective,
  objective_detail   text,
  -- D45 default capture: what_happened is the one note; everything else is
  -- optional enrichment (AI or at-desk).
  what_happened      text,
  key_information    text,
  commercial_potential text,
  outcomes           activity_outcome[] not null default '{}',
  follow_up_required boolean not null default false, -- D45 flag; Rule 3 surfaced
                                                     -- via exception views (spec §3
                                                     -- allows app-level guard)
  opportunity_id     uuid references opportunities (id), -- Rule 2 linkage
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger set_updated_at
  before update on activities
  for each row execute function private.set_updated_at();

create table activity_accounts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id),
  activity_id uuid not null references activities (id) on delete cascade,
  account_id  uuid not null references accounts (id),
  role        activity_account_role not null default 'INVOLVED',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, activity_id, account_id)
);

create trigger set_updated_at
  before update on activity_accounts
  for each row execute function private.set_updated_at();

create table activity_contacts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id),
  activity_id uuid not null references activities (id) on delete cascade,
  contact_id  uuid not null references contacts (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, activity_id, contact_id)
);

create trigger set_updated_at
  before update on activity_contacts
  for each row execute function private.set_updated_at();

-- The agenda AND half the exception engine. due_date is NOT NULL: a next action
-- without a date is exactly what Rule 3 forbids.
create table next_actions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations (id),
  action            text not null,
  owner_id          uuid not null references memberships (id),
  due_date          date not null,
  completed_at      timestamptz,
  account_id        uuid references accounts (id),
  project_id        uuid references projects (id),
  opportunity_id    uuid references opportunities (id),
  activity_id       uuid references activities (id), -- spawned-from (Rule 3 linkage)
  objective         visit_objective, -- required at scheduling for visits (D48)
  objective_detail  text,
  calendar_event_id text, -- Google Calendar projection handle (D15)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (objective is distinct from 'OTHER' or objective_detail is not null)
);

create trigger set_updated_at
  before update on next_actions
  for each row execute function private.set_updated_at();

-- Close the circular reference (D46 planned-vs-actual linkage).
alter table activities
  add column planned_action_id uuid references next_actions (id);

-- Opportunity stage gate (source PDF: EVERY STAGE REQUIRES current status ·
-- next action · next-action date). Deferred so the app/outbox can insert an
-- opportunity and its next_action in one transaction. WON/LOST are exempt —
-- a closed deal needs no next action; ON_HOLD still requires one (revisit date).
-- SECURITY DEFINER: the check must see next_actions regardless of caller RLS.
create or replace function private.enforce_opportunity_stage_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_status is null then
    raise exception 'opportunity % requires current_status at every stage', new.id
      using errcode = '23514';
  end if;

  if new.stage not in ('WON', 'LOST') then
    if not exists (
      select 1
      from public.next_actions na
      where na.opportunity_id = new.id
        and na.completed_at is null
    ) then
      raise exception
        'opportunity % requires an open next action with a date (stage %)',
        new.id, new.stage
        using errcode = '23514';
    end if;
  end if;

  return null;
end;
$$;

create constraint trigger opportunity_stage_gate
  after insert or update of stage, current_status on opportunities
  deferrable initially deferred
  for each row execute function private.enforce_opportunity_stage_gate();
