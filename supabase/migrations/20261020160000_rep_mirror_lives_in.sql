-- A REP'S MIRROR CAN LIVE IN THEIR OWN ACCOUNT (2026-10-20). Brian added
-- calendar.app.created to the consent screen, so a rep who grants it gets a
-- "GMX · Agenda" calendar made in their own Google account: theirs from the
-- start, nothing to accept, and the app can touch nothing else they hold.
--
-- The registered id alone no longer says whose account it is in, so the row
-- says it: 'team' — made in the team calendar owner's account and shared to
-- read; 'own' — in the rep's own account ('primary' being the stopgap where a
-- grant holds only calendar.events).

alter table public.rep_mirror_calendars
  add column lives_in text not null default 'team'
    check (lives_in in ('team', 'own'));

update public.rep_mirror_calendars
   set lives_in = 'own'
 where google_calendar_id = 'primary';

comment on column public.rep_mirror_calendars.lives_in is
  'team: in the team calendar owner''s account, shared with the rep to read. own: in the rep''s own account, through their grant.';
