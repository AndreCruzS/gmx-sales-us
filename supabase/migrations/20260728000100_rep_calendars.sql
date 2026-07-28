-- Phase 6 · migration 17: rep calendar registry (spec §6).
--
-- One secondary Google calendar per rep, OWNED BY THE SERVICE ACCOUNT — the
-- calendar is a projection of next_actions, never a source of truth. This
-- table only remembers which Google calendar id belongs to which membership;
-- the events themselves live in Google and are reconciled by the sync job.
--
-- Writes are service-role only (the sync job); clients may read their chain.

create table rep_calendars (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations (id),
  membership_id      uuid not null references memberships (id),
  google_calendar_id text not null,
  status             text not null default 'active',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, membership_id)
);

create trigger set_updated_at
  before update on rep_calendars
  for each row execute function private.set_updated_at();

alter table rep_calendars enable row level security;

-- Same visibility as the agenda it projects: mailbox-owner chain.
create policy rep_calendars_select on rep_calendars
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and membership_id in (select private.visible_membership_ids())
  );

grant select on rep_calendars to authenticated;
