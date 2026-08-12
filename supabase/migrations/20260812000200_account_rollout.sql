-- Rollout tracking (the "CA - California Rollout Tracker" spreadsheet).
--
-- Bianca's book gates a branch on four things before it can sell: a PK class
-- run, a merchandiser assigned, a display wall standing, and material in stock.
-- That is a different question from the opportunity pipeline
-- (IDENTIFIED -> ... -> DECISION), which tracks a deal rather than a door, so
-- it gets its own state instead of being forced into stage values.
--
-- Only THREE gates are stored here. The display wall already exists on accounts
-- as has_display_wall / display_last_verified_at, and the exception views and
-- the rep's routine are built on those columns. Storing the wall a second time
-- would create two answers to one question and guarantee they drift, so the
-- wall gate is derived in the view below.

create type rollout_gate_state as enum ('OK', 'PENDING', 'NO');

create table account_rollout (
  account_id         uuid primary key references accounts (id) on delete cascade,
  org_id             uuid not null references organizations (id),
  pk_state           rollout_gate_state not null default 'NO',
  merchandiser_state rollout_gate_state not null default 'NO',
  material_state     rollout_gate_state not null default 'NO',
  -- What the branch actually carries, verbatim from the tracker's PRODUCT
  -- column ("Ayous Flutted/Ayous Vjoint"). Free text on purpose: the range
  -- changes faster than a migration, and the tracker already treats it as a note.
  product            text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references memberships (id)
);

-- updated_at is the LWW version key the offline layer syncs on (D61), so it is
-- trigger-maintained like every other table rather than trusted from a client.
create trigger set_updated_at
  before update on account_rollout
  for each row execute function private.set_updated_at();

comment on table account_rollout is
  'Per-branch rollout gates. The display wall gate is NOT here: it derives from accounts.has_display_wall and display_last_verified_at.';

create index account_rollout_org_idx on account_rollout (org_id);

alter table account_rollout enable row level security;

-- Visibility follows the account itself — a rollout row is a fact about a
-- branch, so anyone who may see the branch may see how far along it is.
create policy account_rollout_select on account_rollout
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_id))
  );

create policy account_rollout_insert on account_rollout
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_id))
  );

create policy account_rollout_update on account_rollout
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_id))
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_id))
  );

grant select, insert, update on account_rollout to authenticated;

-- The four gates in one row per account, with the wall derived rather than
-- stored. An account with no rollout row reads as 'NO' across the board, which
-- is the truthful state for a branch nobody has started.
create view account_rollout_status
  with (security_invoker = true) as
select
  a.id            as account_id,
  a.org_id,
  a.owner_id,
  a.territory_id,
  a.name,
  a.parent_account_id,
  coalesce(r.pk_state, 'NO')           as pk_state,
  coalesce(r.merchandiser_state, 'NO') as merchandiser_state,
  -- A wall that exists but has never been verified is in flight, not done.
  case
    when a.has_display_wall and a.display_last_verified_at is not null then 'OK'
    when a.has_display_wall then 'PENDING'
    else 'NO'
  end::rollout_gate_state              as display_wall_state,
  coalesce(r.material_state, 'NO')     as material_state,
  r.product,
  r.notes,
  -- How many of the four are done. Deliberately a count and not a "stage":
  -- the tracker shows these gates completed out of order (walls up with no
  -- merchandiser behind them), so collapsing them to a single furthest-stage
  -- would hide exactly the problem the book exists to surface.
  (
    (case when coalesce(r.pk_state, 'NO') = 'OK' then 1 else 0 end)
    + (case when coalesce(r.merchandiser_state, 'NO') = 'OK' then 1 else 0 end)
    + (case when a.has_display_wall and a.display_last_verified_at is not null then 1 else 0 end)
    + (case when coalesce(r.material_state, 'NO') = 'OK' then 1 else 0 end)
  )                                     as gates_done
from accounts a
left join account_rollout r on r.account_id = a.id
where a.account_type in ('DEALER', 'DISTRIBUTOR');

comment on view account_rollout_status is
  'Four rollout gates per account. gates_done is a count, not a stage: gates complete out of order and the gaps are the point.';

grant select on account_rollout_status to authenticated;

-- Chain-wide counts for the manager funnel. security_invoker keeps it honest:
-- a rep sees their own branches, a manager their chain, an admin the org.
create view dashboard_rollout
  with (security_invoker = true) as
select
  org_id,
  count(*)                                                as branches,
  count(*) filter (where pk_state = 'OK')                 as pk_done,
  count(*) filter (where merchandiser_state = 'OK')       as merchandiser_done,
  count(*) filter (where display_wall_state = 'OK')       as display_wall_done,
  count(*) filter (where material_state = 'OK')           as material_done,
  count(*) filter (where gates_done = 4)                  as fully_through,
  count(*) filter (where gates_done = 0)                  as not_started
from account_rollout_status
group by org_id;

grant select on dashboard_rollout to authenticated;
