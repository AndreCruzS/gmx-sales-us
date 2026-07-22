-- Phase 1 · migration 7: capture pipelines — voice_captures (D9/D10/D14),
-- contact_candidates (D39–D44)

create table voice_captures (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations (id),
  owner_id         uuid not null references memberships (id),
  audio_path       text, -- Storage: {org_id}/{user_id}/{capture_id} (spec §4a)
  duration_seconds int,
  transcript       text,
  ai_draft         jsonb,
  status           voice_capture_status not null default 'PENDING',
  language         text, -- defaults from memberships.debrief_language (Q7)
  activity_id      uuid references activities (id), -- null until reviewed & sent (D9/D10)
  reviewed_at      timestamptz,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger set_updated_at
  before update on voice_captures
  for each row execute function private.set_updated_at();

-- Unified contact intake (D39): manual, voice, business card and email metadata
-- all converge here — one review queue, one dedupe path (D40).
create table contact_candidates (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations (id),
  created_by         uuid not null references memberships (id),
  source             candidate_source not null,
  raw_ref            text, -- Storage path: card image ({org_id}/cards/, D42) or audio
  extracted          jsonb not null default '{}', -- per-field confidence scores (D41)
  matched_contact_id uuid references contacts (id),
  matched_account_id uuid references accounts (id),
  status             candidate_status not null default 'PENDING',
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger set_updated_at
  before update on contact_candidates
  for each row execute function private.set_updated_at();
