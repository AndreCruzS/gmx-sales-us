-- THE TEAM CALENDAR (Andre, 2026-10-12; spec 2026-10-12-team-google-calendar).
--
-- One Google Calendar for the whole sales team, owned by a desk account and
-- shared with the admins. Reps never see it in Google — their own visits are
-- in the app. This table remembers which Google calendar it is and whose
-- grant the server uses to reach it. Writes are the sync job's alone.
--
-- The per-rep projection of spec §6 (rep_calendars, one secondary calendar
-- per rep owned by a service account that was never issued) is dropped.

create table public.team_calendars (
  org_id              uuid primary key references public.organizations (id),
  google_calendar_id  text not null,
  owner_membership_id uuid not null references public.memberships (id),
  summary             text not null default 'GMX Sales Team',
  last_synced_at      timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.team_calendars
  for each row execute function private.set_updated_at();

alter table public.team_calendars enable row level security;

create policy team_calendars_select on public.team_calendars
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
  );

grant select on public.team_calendars to authenticated;

-- WHO WINS AN EDIT is decided by where the visit was born, not by a clock:
-- a row born in the app is edited in the app, one born in Google in Google.
alter table public.next_actions
  add column calendar_origin text
  check (calendar_origin in ('app', 'google'));

comment on column public.next_actions.calendar_origin is
  'app: planned here, projected to the team calendar. google: born as an '
  'event on the team calendar and imported. null: never synced.';

drop table if exists public.rep_calendars;
