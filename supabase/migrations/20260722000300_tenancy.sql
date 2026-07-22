-- Phase 1 · migration 3: tenancy — organizations, org_integrations (D16, D20)

create table organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null unique,
  workspace_domain text unique, -- validated against sign-in email domain (D19/D25)
  status           org_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger set_updated_at
  before update on organizations
  for each row execute function private.set_updated_at();

-- Per-tenant credentials. credential_ref names a Supabase Vault secret —
-- the secret material itself never lives in a column (D20).
create table org_integrations (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations (id),
  provider         integration_provider not null,
  credential_ref   text not null,
  config           jsonb not null default '{}',
  status           text not null default 'unverified',
  last_verified_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, provider)
);

create trigger set_updated_at
  before update on org_integrations
  for each row execute function private.set_updated_at();
