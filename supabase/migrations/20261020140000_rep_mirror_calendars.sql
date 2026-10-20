-- EVERY REP GETS A MIRROR OF THEIR OWN VISITS (Andre, 2026-10-20: "the team
-- [calendar] where João and Bianca can see EVERYONE's appointments but the rep
-- CAN ONLY SEE THEIR OWN").
--
-- Google cannot filter a shared calendar per viewer, so the team calendar
-- stays admins-only and each rep gets a second calendar, "GMX · <name>", made
-- in the same owner's account and shared with that rep to read. The sync
-- writes the rep's open visits there and nothing else; it is a one-way copy —
-- the visit is planned in the app or on the team calendar, never in the mirror.

create table public.rep_mirror_calendars (
  membership_id       uuid primary key references public.memberships (id) on delete cascade,
  org_id              uuid not null references public.organizations (id),
  google_calendar_id  text not null,
  -- The address the calendar was last shared with. The share is sent once,
  -- with Google's invitation e-mail, not re-asserted every pass.
  shared_with         text,
  last_synced_at      timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.rep_mirror_calendars
  for each row execute function private.set_updated_at();

alter table public.rep_mirror_calendars enable row level security;

-- A rep reads their own row; an admin reads the org's. Writes are the
-- service role's alone.
create policy rep_mirror_calendars_select on public.rep_mirror_calendars
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (
      membership_id = (select private.active_membership_id())
      or (select private.is_admin())
    )
  );

grant select on public.rep_mirror_calendars to authenticated;

comment on table public.rep_mirror_calendars is
  'One Google calendar per rep, in the team calendar owner''s account, shared read-only with the rep: a copy of their open visits.';
