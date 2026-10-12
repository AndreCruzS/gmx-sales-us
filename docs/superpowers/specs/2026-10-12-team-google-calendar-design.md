# Team Google Calendar — design

Status: approved in conversation by Andre, 2026-10-12. Supersedes spec §6
(one secondary calendar per rep, owned by a service account, one-way).

## Why

The agenda becomes ONE Google Calendar for the sales team, "GMX Sales Team",
owned by a desk account and shared with the admins. Reps never see it in
Google; they see their own visits in the app, as today. Admins see the whole
team's week on the Reps board and, in Google Calendar, the shared agenda.
Events flow both ways: a visit planned in the app lands on the calendar, and
an event the admin creates in Google shows on the board.

The per-rep projection built under spec §6 never ran (no service account was
ever issued) and no longer matches the shape. It is removed.

## What the user sees

- **Connect.** The desk account that will own the calendar opens the
  existing "Finish your setup" banner → `/settings/google` → Connect. For an
  admin the scope requested is the full Calendar scope
  (`https://www.googleapis.com/auth/calendar`), because creating a calendar
  and sharing it is outside the events-only scope. Reps keep `calendar.events`
  and `gmail.send`; their grant is unchanged and still unused server-side.
- **Right after the grant lands**, the settings page calls the sync. The
  page then shows "Team calendar: GMX Sales Team · shared with N admins" or
  the error in plain words.
- **Reps board** (`/reps`): the week grid shows every visit in the window,
  including ones born in Google. A Google-born visit belongs to the admin
  who connected until somebody assigns it; the board's rep chips scope by
  owner as today.
- **Rep's Agenda** (`/visits`): unchanged. The rep sees only rows they own.
- **Assigning a rep.** On the Reps board's week or month grid, a manager
  clicking a visit opens a small popover: the visit's name and date, and a
  select of active reps to hand it to. This is the one new control. Changing
  the owner moves the rep label on the Google event on the next sync.
- **Google Calendar (admins).** The calendar "GMX Sales Team" appears in
  each active admin's calendar list with "Make changes to events". Events the
  app authored say in their description that the app owns them.

## Model

### Table `team_calendars` (new)

| column | type | notes |
|---|---|---|
| org_id | uuid pk → organizations | one calendar per org |
| google_calendar_id | text not null | |
| owner_membership_id | uuid not null → memberships | whose grant the server uses |
| summary | text not null default 'GMX Sales Team' | |
| last_synced_at | timestamptz | |
| last_error | text | surfaced on the settings page |
| created_at / updated_at | timestamptz | |

RLS: select for active members of the org; writes service-role only.

### `next_actions`, existing columns reused

- `calendar_event_id` (exists, D15) — the Google event id. Set on both
  app-born and Google-born rows.
- New column `calendar_origin text check in ('app','google')`, null for
  rows never synced. Decides who wins on edits and deletes.
- Google-born rows: `kind = 'VISIT'` set explicitly (the trigger only fills a
  null kind), `owner_id` = `team_calendars.owner_membership_id`,
  `account_id` null, `action` = event summary, `due_date` = event start day,
  `objective` null.

### Event shape in Google

All-day events (the model tracks commitment days, D46). Private extended
properties: `app=commercial-os`, `next_action_id`, `membership_id`.
Summary for app-born: `"<action> — <account name> · <rep first name>"`.
Description: purpose line when objective is set, plus
"Planned in Commercial OS — edit it there, not here." for app-born rows.

### `rep_calendars` table, `src/lib/calendar/*` per-rep core, hourly cron

Removed. Migration drops `rep_calendars`. `vercel.json` cron for
`/api/calendar/sync` replaced by `/api/calendar/team/sync` every 15 minutes
(GET, since Vercel Cron sends GET).

## Sync — one reconciliation pass

`syncTeamCalendar(port, store)` in `src/lib/calendar/team-sync.ts`, pure over
two ports, covered by vitest with fakes.

1. **Ensure the calendar.** If `team_calendars` has an id and the calendar
   still exists, use it. Else look for a calendar named "GMX Sales Team" in
   the owner's calendar list; else create it. Save the id.
2. **Ensure the shares.** For every active membership with role admin, ACL
   `writer` for `users.email`. Re-asserted each pass (acl.insert on an
   existing scope updates it). Never a domain rule. Shares are never revoked
   by the app; a removed admin is a manual revoke.
3. **App → Google.** Open VISIT rows (`kind = 'VISIT'` or null, completed_at
   null, origin app or null): no event → insert, set `calendar_event_id`,
   origin app. Event exists and title/date differ → update. Row completed
   or deleted → event deleted (history lives in the app).
4. **Google → app.** Events in the calendar from 60 days back to 365 days
   ahead. Event without `next_action_id` → insert a VISIT row (shape above),
   write the two private properties back onto the event. Event with
   `next_action_id` whose row is Google-born: date/summary changed in Google
   → row updated. Event missing/cancelled whose row is Google-born → row
   deleted. App-born event deleted in Google → re-inserted on the next pass
   (the app owns it).
5. **Report** `{calendarId, created, shared, inserted, updated, deleted,
   imported, errors[]}`; `last_synced_at`/`last_error` written.

Who wins is by origin, not by timestamp: app-born rows are edited in the
app, Google-born rows in Google. No clock races.

## Server access

The owner's refresh token (from `google_connections`) is exchanged for an
access token with the OAuth client the login already uses (project
`gmx-sales-metrics`). Two new env vars on Vercel and locally:
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`. `src/lib/google/oauth.ts`
holds the exchange with a short in-memory cache. If the token is revoked
(`invalid_grant`), the sync records "the calendar owner must reconnect" and
the settings page and banner say so to that owner.

Route `src/app/api/calendar/team/sync/route.ts`:
- `GET` with `authorization: Bearer ${CRON_SECRET}` — cron.
- `POST` by a signed-in admin — on-demand (settings page after the grant;
  Reps board on load, fire-and-forget, then re-reads rows via `bump`).
- 501 in plain words while env or the owner's connection is missing.

## Removed scope

Gmail send, Gmail read and the service-account path stay as they are and
remain blocked on the client. The old `/api/calendar/sync` route, its core,
store, port, tests, and the `rep_calendars` table go.

## Testing

- Vitest: `team-sync.test.ts` covers ensure (existing id, by name, create),
  shares, the four directions of reconciliation, the origin rules, and the
  revoked-token report.
- SQL: pgTAP for `team_calendars` RLS (member reads, rep cannot write) and
  the `calendar_origin` check.
- Screen: as Bianca, connect, see the settings page confirmation, plan a
  visit, see it on the board and in Google (Andre's account via the shared
  calendar); create an event in Google, see it on the board, assign it to a
  rep, see the label change.
