-- HubSpot sync bridge · migration 1: substrate (spec 2026-08-05).
-- HubSpot is the pipeline system of record; these tables carry the ID links,
-- per-stream cursors, echo-suppression snapshots, and the never-drop error
-- log (same D62 posture as the outbox: failures are surfaced, not swallowed).

alter type integration_provider add value if not exists 'hubspot';

alter table accounts      add column hubspot_id text;
alter table contacts      add column hubspot_id text;
alter table opportunities add column hubspot_id text;
alter table activities    add column hubspot_id text;
alter table next_actions  add column hubspot_id text;

-- One HubSpot object per row per org; NULL = not yet linked.
create unique index accounts_hubspot_id_key      on accounts      (org_id, hubspot_id) where hubspot_id is not null;
create unique index contacts_hubspot_id_key      on contacts      (org_id, hubspot_id) where hubspot_id is not null;
create unique index opportunities_hubspot_id_key on opportunities (org_id, hubspot_id) where hubspot_id is not null;
create unique index activities_hubspot_id_key    on activities    (org_id, hubspot_id) where hubspot_id is not null;
create unique index next_actions_hubspot_id_key  on next_actions  (org_id, hubspot_id) where hubspot_id is not null;

-- stream examples: 'out:accounts', 'out:activities', 'in:deals'.
-- cursor is an ISO timestamp (outbound: our updated_at) or a ms-epoch string
-- (inbound: hs_lastmodifieddate) — text keeps both without casting games.
create table hubspot_sync_cursors (
  org_id     uuid not null references organizations (id),
  stream     text not null,
  cursor     text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, stream)
);

create trigger set_updated_at
  before update on hubspot_sync_cursors
  for each row execute function private.set_updated_at();

-- Last property values we synced, in HubSpot property space. A side that
-- still equals its snapshot has not really changed — that is the echo test.
-- created_at/updated_at (alongside synced_at) satisfy the repo-wide
-- created_at/updated_at + set_updated_at trigger convention (organizations,
-- org_integrations, hubspot_sync_errors below) — every public table carries
-- a trigger-maintained LWW version key (D61), not just the sync-state ones.
create table hubspot_sync_snapshots (
  org_id       uuid not null references organizations (id),
  entity_type  text not null check (entity_type in ('account', 'contact', 'opportunity')),
  entity_id    uuid not null,
  hubspot_id   text not null,
  synced_props jsonb not null,
  synced_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (org_id, entity_type, entity_id)
);

create trigger set_updated_at
  before update on hubspot_sync_snapshots
  for each row execute function private.set_updated_at();

create table hubspot_sync_errors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id),
  direction   text not null check (direction in ('outbound', 'inbound')),
  entity_type text not null,
  entity_id   uuid,
  hubspot_id  text,
  payload     jsonb not null,
  error       text not null,
  retry_count int  not null default 0,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger set_updated_at
  before update on hubspot_sync_errors
  for each row execute function private.set_updated_at();

-- Sync state is server-side machinery: RLS on, zero policies. Only the
-- service role (which bypasses RLS) reads or writes; admin visibility goes
-- through /api/hubspot/health, which checks the caller's membership role.
alter table hubspot_sync_cursors   enable row level security;
alter table hubspot_sync_snapshots enable row level security;
alter table hubspot_sync_errors    enable row level security;

-- Vault secrets are named by org_integrations.credential_ref (D20). PostgREST
-- cannot reach the vault schema, so the sync route fetches the token through
-- this function — executable by service_role alone.
create or replace function public.get_integration_secret(p_ref text)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_ref;
$$;

revoke all on function public.get_integration_secret(text) from public, anon, authenticated;
grant execute on function public.get_integration_secret(text) to service_role;
