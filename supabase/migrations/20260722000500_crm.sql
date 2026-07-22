-- Phase 1 · migration 5: CRM spine — accounts, contacts, account_relationships
-- (D4, D6/D7/D8, D49, D50, D52)

create table accounts (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations (id),
  name                     text not null, -- business-card naming: brand + city (D51)
  account_type             account_type not null,
  website                  text,
  address                  text,
  city                     text,
  state                    text,
  territory_id             uuid not null references territories (id),
  owner_id                 uuid not null references memberships (id),
  strategic_importance     strategic_importance,
  relationship_status      relationship_status_value,
  -- Lead source lives on Account AND Opportunity (D6); required at creation —
  -- attribution entered a week later is fiction.
  lead_source              lead_source_value not null,
  source_detail            text,
  referring_account_id     uuid references accounts (id),
  -- Accounts are branch-level; the banner/chain rolls up via parent (D49).
  parent_account_id        uuid references accounts (id),
  -- Merchandising (D52): feeds the "display not verified in N months" exception.
  has_display_wall         boolean not null default false,
  display_last_verified_at timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (org_id, name),
  check (lead_source <> 'OTHER' or source_detail is not null),                          -- D8
  check (not private.is_referral_lead_source(lead_source)
         or referring_account_id is not null),                                          -- D7
  check (referring_account_id <> id),
  check (parent_account_id <> id)
);

create trigger set_updated_at
  before update on accounts
  for each row execute function private.set_updated_at();

create table contacts (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations (id),
  account_id          uuid not null references accounts (id),
  name                text not null,
  job_title           text,
  email               text,
  phone               text,
  influence_level     influence_level,
  relationship_status relationship_status_value,
  is_champion         boolean not null default false, -- the "capitão" (D50)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One champion per account (D50).
create unique index contacts_one_champion_per_account
  on contacts (org_id, account_id)
  where is_champion;

create trigger set_updated_at
  before update on contacts
  for each row execute function private.set_updated_at();

-- The many-to-many commercial network (D4). Referral lead sources also write a
-- row here (D7) — app-layer responsibility at account creation.
create table account_relationships (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations (id),
  account_a_id      uuid not null references accounts (id),
  relationship_type relationship_type not null,
  account_b_id      uuid not null references accounts (id),
  strength          relationship_strength,
  status            relationship_state not null default 'ACTIVE',
  notes             text,
  created_by        uuid references memberships (id),
  last_confirmed_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, account_a_id, relationship_type, account_b_id),
  check (account_a_id <> account_b_id)
);

create trigger set_updated_at
  before update on account_relationships
  for each row execute function private.set_updated_at();
