-- Timed commitments (spec 2026-11-04-timed-commitments-design.md), part 2.
--
-- Andre, 2026-11-03: "faça as duas" — a visit can carry a time of day, and a
-- call or a meeting with a time is an agenda commitment. Until now the agenda
-- held a day only, and the team calendar and each rep's "GMX · Agenda" showed
-- every visit as an all-day event.
--
--   · due_time          the wall-clock start, in time_zone. Null = all day.
--   · time_zone         IANA zone the time was said in (the device's), so a
--                       Riverside rep's 10:00 is 10:00 Pacific on the desk's
--                       calendar in Boise. Set exactly when due_time is.
--   · duration_minutes  how long; null = the kind's default (the app: visit
--                       60, call 30, meeting 60).
--
-- A call or a meeting always has a time: without one it is a to-do and lives
-- on the routine list (kind OTHER), which is what the rep asked for.

alter table public.next_actions
  add column due_time time,
  add column time_zone text,
  add column duration_minutes smallint;

alter table public.next_actions
  add constraint next_actions_time_has_zone
    check ((due_time is null) = (time_zone is null)),
  add constraint next_actions_duration_range
    check (duration_minutes is null or duration_minutes between 5 and 600),
  add constraint next_actions_call_meeting_timed
    check (kind is null or kind not in ('CALL', 'MEETING') or due_time is not null);
