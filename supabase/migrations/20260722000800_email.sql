-- Phase 1 · migration 8: Gmail Tier-2 ingestion tables (D26–D38, spec §5a).
-- Ingestion itself is Phase 6; the schema ships now so RLS and the leakage
-- suite cover it from day one. Writes are service-role only (see policies).

-- Thread is the unit of extraction (D28).
create table email_threads (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations (id),
  membership_id         uuid not null references memberships (id), -- whose mailbox
  gmail_thread_id       text not null,
  subject               text,
  participants          jsonb not null default '[]',
  matched_account_id    uuid references accounts (id),
  matched_contact_id    uuid references contacts (id), -- contact match = privacy boundary (D35)
  first_message_at      timestamptz,
  last_message_at       timestamptz,
  last_direction        email_direction,
  open_commitments      jsonb not null default '[]',
  status                text not null default 'active',
  linked_opportunity_id uuid references opportunities (id),
  linked_project_id     uuid references projects (id),
  last_extracted_at     timestamptz, -- re-extract only on thread change (D34)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, membership_id, gmail_thread_id)
);

create trigger set_updated_at
  before update on email_threads
  for each row execute function private.set_updated_at();

create table email_messages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations (id),
  thread_id        uuid not null references email_threads (id) on delete cascade,
  gmail_message_id text not null,
  from_addr        text,
  to_addrs         text[] not null default '{}',
  cc_addrs         text[] not null default '{}',
  sent_at          timestamptz,
  direction        email_direction,
  snippet          text,
  body_ref         text, -- Storage {org_id}/email/bodies/{message_id}, TTL-purged (D29/D38)
  has_attachments  boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, thread_id, gmail_message_id)
);

create trigger set_updated_at
  before update on email_messages
  for each row execute function private.set_updated_at();

create table email_attachments (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations (id),
  message_id            uuid not null references email_messages (id) on delete cascade,
  filename              text,
  mime_type             text,
  size_bytes            bigint,
  sha256                text not null, -- dedupe key (D30)
  storage_path          text,          -- {org_id}/email/{sha256} (D38)
  classification        attachment_classification,
  linked_opportunity_id uuid references opportunities (id), -- quotes → opportunity (D31)
  linked_project_id     uuid references projects (id),      -- specs/photos → project (D31)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, message_id, sha256)
);

create trigger set_updated_at
  before update on email_attachments
  for each row execute function private.set_updated_at();

-- historyId polling cursor per mailbox (D33).
create table email_sync_state (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations (id),
  membership_id  uuid not null references memberships (id),
  history_id     text,
  last_synced_at timestamptz,
  status         text not null default 'idle',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, membership_id)
);

create trigger set_updated_at
  before update on email_sync_state
  for each row execute function private.set_updated_at();

-- Optional per-org safety net (D27, downgraded — contact matching is the
-- real boundary per D35).
create table org_email_exclusions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id),
  pattern    text not null, -- domain or address
  reason     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, pattern)
);

create trigger set_updated_at
  before update on org_email_exclusions
  for each row execute function private.set_updated_at();
