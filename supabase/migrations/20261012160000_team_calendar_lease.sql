-- THE PASS HOLDS A LEASE (review, 2026-10-12). Three callers can start a
-- sync at once — the cron, the Reps board opening, the settings page after
-- a grant — and two passes over the same calendar insert the same visit
-- twice. The route claims this row for two minutes before it runs and lets
-- it go after; a second caller is told "already running" and waits for the
-- next pass.
--
-- The row now exists BEFORE the calendar does: the route registers the
-- owner the moment one is known, so a failure on the very first pass has a
-- place to be written (last_error) and the settings page can say why.

alter table public.team_calendars
  alter column google_calendar_id drop not null,
  add column sync_lease_until timestamptz;

comment on column public.team_calendars.google_calendar_id is
  'null until the first successful pass found or created the calendar.';
comment on column public.team_calendars.sync_lease_until is
  'while in the future, a pass is running; a caller that cannot claim it waits.';
