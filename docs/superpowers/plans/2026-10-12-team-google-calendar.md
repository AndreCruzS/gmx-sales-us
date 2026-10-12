# Team Google Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Google Calendar, "GMX Sales Team", owned by a desk account, shared with the admins, kept in two-way agreement with the app's visits.

**Architecture:** A pure reconciliation core (`syncTeamCalendar`) over two ports — a calendar port (Google, via the owner's OAuth refresh token) and a store port (Supabase service role scoped to one org). One route runs it (cron GET, admin POST). Visits stay rows in `next_actions`; Google-born events become rows too, so every existing screen keeps reading one table. The per-rep projection of spec §6 is deleted.

**Tech Stack:** Next.js App Router route handlers, Supabase (Postgres + RLS, pgTAP), Google Calendar REST v3, OAuth refresh-token grant, vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-team-google-calendar-design.md`

## Global Constraints

- Everything on screen is English (project rule).
- Local dev writes to PRODUCTION Supabase; migrations are applied with `supabase db push` only after `npm run db:test` passes locally.
- `CREATE OR REPLACE VIEW` drops `security_invoker`; this plan creates no views.
- PostgREST caps queries at 1,000 rows; the store limits every read to 500 and the calendar window is 60 days back to 365 ahead.
- All-day events only (D46). Dates are `YYYY-MM-DD` strings, compared as strings.
- Calendar name is exactly `GMX Sales Team`. Private extended properties: `app=commercial-os`, `next_action_id`, `membership_id`.
- Admin share role is `writer`. Never a domain-wide ACL. The app never revokes a share.
- Who wins is by `calendar_origin`: `app` rows are edited in the app, `google` rows in Google.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01F8dZSZZyp8LJ3k9wyY2SpJ`.

## Review Focus

1. **A Google event spanning several days or timed (not all-day).** Expected: the row's `due_date` is the start day; a timed event's start date is read from `start.dateTime` (first 10 characters). Pinned in Task 3 (`imports a timed event by its start day`).
2. **The calendar owner revokes access in Google.** Expected: the sync records "the calendar owner must reconnect" in `last_error`, the settings page shows it, nothing else throws. Pinned in Task 2 (`invalid_grant` → `GoogleReauthNeeded`) and Task 5 (route maps it to 409 with that message).
3. **The same event seen twice in one pass (pagination overlap or a replay).** Expected: no duplicate rows. Pinned in Task 3 (`replaying a pass changes nothing`).
4. **An app-born visit completed while its Google event was edited.** Expected: the event is deleted (completion wins; history lives in the app). Pinned in Task 3 (`a completed app visit deletes its event`).
5. **An admin who is not the owner presses Connect.** Expected: their grant is stored like anyone's, but the sync keeps using the registered owner; the settings page tells them who the owner is. Pinned in Task 6 (`ownerOf` shown on the page) and Task 5 (`POST` by a non-owner admin still syncs with the owner's token).

---

### Task 1: Schema — `team_calendars`, `calendar_origin`, drop `rep_calendars`

**Files:**
- Create: `supabase/migrations/20261012100000_team_calendar.sql`
- Create: `supabase/tests/20_team_calendar.test.sql`
- Modify: `src/lib/database.types.ts` (regenerate with `npm run db:types`)

**Interfaces:**
- Produces: table `public.team_calendars(org_id pk, google_calendar_id, owner_membership_id, summary, last_synced_at, last_error, created_at, updated_at)`; column `public.next_actions.calendar_origin text` with check `in ('app','google')`.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/20_team_calendar.test.sql
-- Team calendar · tests 20 (20261012100000_team_calendar.sql).
--
-- 1. One row per org; members read it, nobody but the service role writes.
-- 2. next_actions.calendar_origin only takes 'app' or 'google'.
-- 3. rep_calendars is gone.

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select has_table('public', 'team_calendars', 'team_calendars exists');
select hasnt_table('public', 'rep_calendars', 'rep_calendars is gone');
select col_is_pk('public', 'team_calendars', 'org_id', 'one calendar per org');

insert into team_calendars (org_id, google_calendar_id, owner_membership_id)
values ('11111111-1111-1111-1111-111111111111', 'cal-abc@group.calendar.google.com',
        'c0000000-0000-0000-0000-000000000001');

select tests.set_claims('tj@gmxgroup.com', 'gmx-us');
set local role authenticated;
select results_eq(
  $$ select google_calendar_id from team_calendars $$,
  $$ values ('cal-abc@group.calendar.google.com') $$,
  'an active member reads the org calendar');
select throws_like(
  $$ update team_calendars set summary = 'x' $$,
  '%permission denied%',
  'authenticated cannot write team_calendars');
reset role;

select throws_like(
  $$ update next_actions set calendar_origin = 'outlook'
     where id = (select id from next_actions limit 1) $$,
  '%calendar_origin%',
  'calendar_origin rejects anything but app/google');
select lives_ok(
  $$ update next_actions set calendar_origin = 'google'
     where id = (select id from next_actions limit 1) $$,
  'calendar_origin takes google');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run db:test -- supabase/tests/20_team_calendar.test.sql` (requires `npm run db:start` once)
Expected: FAIL — `team_calendars` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261012100000_team_calendar.sql
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run db:reset && npm run db:test`
Expected: all suites PASS, including 20.

- [ ] **Step 5: Regenerate types**

Run: `npm run db:types`
Expected: `team_calendars` appears in `src/lib/database.types.ts`, `rep_calendars` is gone.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261012100000_team_calendar.sql supabase/tests/20_team_calendar.test.sql src/lib/database.types.ts
git commit -m "feat(db): team_calendars, calendar_origin on next_actions, rep_calendars dropped"
```

(Push to production with `supabase db push` only in Task 8, after the code that reads it ships.)

---

### Task 2: Server-side Google OAuth — refresh token → access token

**Files:**
- Create: `src/lib/google/oauth.ts`
- Test: `src/lib/google/__tests__/oauth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class GoogleReauthNeeded extends Error {}
  export interface OAuthClient { clientId: string; clientSecret: string }
  export function oauthClientFromEnv(): OAuthClient | null
  export async function accessTokenFromRefresh(client: OAuthClient, refreshToken: string, fetchImpl?: typeof fetch): Promise<string>
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/google/__tests__/oauth.test.ts
import { describe, expect, it, vi } from "vitest";
import { accessTokenFromRefresh, GoogleReauthNeeded } from "../oauth";

const CLIENT = { clientId: "id", clientSecret: "secret" };

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

describe("accessTokenFromRefresh", () => {
  it("posts the refresh grant and returns the access token", async () => {
    const f = fetchReturning(200, { access_token: "ya29.x", expires_in: 3599 });
    const tok = await accessTokenFromRefresh(CLIENT, "r1", f);
    expect(tok).toBe("ya29.x");
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=r1");
  });

  it("caches by refresh token until close to expiry", async () => {
    const f = fetchReturning(200, { access_token: "ya29.y", expires_in: 3599 });
    await accessTokenFromRefresh(CLIENT, "r2", f);
    await accessTokenFromRefresh(CLIENT, "r2", f);
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it("throws GoogleReauthNeeded on invalid_grant", async () => {
    const f = fetchReturning(400, { error: "invalid_grant" });
    await expect(accessTokenFromRefresh(CLIENT, "r3", f)).rejects.toBeInstanceOf(GoogleReauthNeeded);
  });

  it("throws a plain Error on any other failure", async () => {
    const f = fetchReturning(500, { error: "boom" });
    await expect(accessTokenFromRefresh(CLIENT, "r4", f)).rejects.toThrow(/token 500/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/google/__tests__/oauth.test.ts`
Expected: FAIL — cannot resolve `../oauth`.

- [ ] **Step 3: Implement**

```ts
// src/lib/google/oauth.ts
// THE OWNER'S KEY, RENEWED ON THE SERVER. The desk account that owns the team
// calendar granted the app once (/settings/google); Google handed back a
// refresh token that lives in google_connections. Every call to the calendar
// first turns that token into a short-lived access token here, with the
// OAuth client the login already uses (project gmx-sales-metrics).
//
// invalid_grant is the one failure with a human fix — the owner revoked the
// app, or the grant expired — so it is its own error and the sync surfaces
// it in words rather than retrying for ever.

export class GoogleReauthNeeded extends Error {
  constructor() {
    super("the calendar owner must reconnect Google");
    this.name = "GoogleReauthNeeded";
  }
}

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export function oauthClientFromEnv(): OAuthClient | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const cache = new Map<string, { token: string; expiresAt: number }>();

export async function accessTokenFromRefresh(
  client: OAuthClient,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const hit = cache.get(refreshToken);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (res.status === 400 && body.error === "invalid_grant") {
    cache.delete(refreshToken);
    throw new GoogleReauthNeeded();
  }
  if (!res.ok || !body.access_token) {
    throw new Error(`token ${res.status}: ${body.error ?? "no access_token"}`);
  }
  cache.set(refreshToken, {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/google/__tests__/oauth.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google/oauth.ts src/lib/google/__tests__/oauth.test.ts
git commit -m "feat(google): refresh-token exchange for the calendar owner's grant"
```

---

### Task 3: The reconciliation core — ports, `syncTeamCalendar`, tests with fakes

**Files:**
- Create: `src/lib/calendar/team-port.ts`
- Create: `src/lib/calendar/team-sync.ts`
- Test: `src/lib/calendar/__tests__/team-sync.test.ts`
- Delete: `src/lib/calendar/port.ts`, `src/lib/calendar/sync-core.ts`, `src/lib/calendar/supabase-store.ts`, `src/lib/calendar/google-calendar.ts`, `src/lib/calendar/__tests__/sync-core.test.ts` (the §6 projection; its route goes in Task 5)

**Interfaces:**
- Produces (`team-port.ts`):
  ```ts
  export const TEAM_CALENDAR_SUMMARY = "GMX Sales Team";
  export interface TeamEvent { eventId: string; date: string; title: string; nextActionId: string | null; membershipId: string | null; cancelled: boolean }
  export interface TeamEventPayload { date: string; title: string; description: string; nextActionId: string; membershipId: string; pinDate: boolean }
  export interface TeamCalendarPort {
    findCalendarByName(summary: string): Promise<string | null>;
    createCalendar(summary: string): Promise<string>;
    calendarExists(calendarId: string): Promise<boolean>;
    grantWriter(calendarId: string, email: string): Promise<void>;
    listEvents(calendarId: string, fromDate: string, toDate: string): Promise<TeamEvent[]>;
    insertEvent(calendarId: string, e: TeamEventPayload): Promise<string>;
    updateEvent(calendarId: string, eventId: string, e: TeamEventPayload): Promise<void>;
    deleteEvent(calendarId: string, eventId: string): Promise<void>;
  }
  export interface VisitRow { id: string; action: string; due_date: string; completed_at: string | null; owner_id: string; objective: string | null; calendar_event_id: string | null; calendar_origin: "app" | "google" | null; accountName: string | null; ownerFirstName: string }
  export interface TeamCalendarStore {
    getCalendar(): Promise<{ googleCalendarId: string } | null>;
    saveCalendarId(id: string): Promise<void>;
    listAdminEmails(): Promise<string[]>;
    listVisits(fromDate: string, toDate: string): Promise<VisitRow[]>;   // open AND completed-with-event, in window
    ownerMembershipId(): Promise<string>;
    markProjected(nextActionId: string, eventId: string): Promise<void>;  // sets calendar_event_id + origin app
    clearProjection(nextActionId: string): Promise<void>;                 // calendar_event_id = null
    importVisit(v: { eventId: string; date: string; title: string; ownerId: string }): Promise<{ id: string; ownerFirstName: string }>;
    updateImported(nextActionId: string, v: { date: string; title: string }): Promise<void>;
    deleteImported(nextActionId: string): Promise<void>;
    recordResult(r: { syncedAt: string; error: string | null }): Promise<void>;
  }
  ```
- Produces (`team-sync.ts`):
  ```ts
  export interface TeamSyncReport { calendarId: string; created: boolean; shared: number; inserted: number; updated: number; deleted: number; imported: number; importedUpdated: number; importedDeleted: number }
  export function eventTitle(v: Pick<VisitRow, "action" | "accountName" | "ownerFirstName">): string
  export function syncWindow(today: string): { fromDate: string; toDate: string }   // 60 days back, 365 ahead
  export async function syncTeamCalendar(calendar: TeamCalendarPort, store: TeamCalendarStore, today: string): Promise<TeamSyncReport>
  ```

- [ ] **Step 1: Delete the §6 files**

```bash
git rm src/lib/calendar/port.ts src/lib/calendar/sync-core.ts src/lib/calendar/supabase-store.ts src/lib/calendar/google-calendar.ts src/lib/calendar/__tests__/sync-core.test.ts
```

(The route that imported them is deleted in Task 5; `npx tsc --noEmit` fails between here and there, which is expected.)

- [ ] **Step 2: Write `team-port.ts`**

```ts
// src/lib/calendar/team-port.ts
// THE TEAM CALENDAR'S TWO PORTS (spec 2026-10-12). One Google Calendar for
// the whole team, owned by a desk account, shared with the admins; events
// flow both ways. The core (team-sync.ts) only knows these interfaces, so
// it is proven with fakes and the adapters stay thin.

export const TEAM_CALENDAR_SUMMARY = "GMX Sales Team";

/** An event as the calendar holds it. Private properties ride back as ids. */
export interface TeamEvent {
  eventId: string;
  /** Start day, YYYY-MM-DD — all-day events keep the day, timed ones lose the clock. */
  date: string;
  title: string;
  nextActionId: string | null;
  membershipId: string | null;
  cancelled: boolean;
}

export interface TeamEventPayload {
  date: string;
  title: string;
  description: string;
  nextActionId: string;
  membershipId: string;
  /** App-born: the event is all-day on the visit's day and the app sets it.
   *  Google-born: the admin's own date and clock are left alone. */
  pinDate: boolean;
}

export interface TeamCalendarPort {
  findCalendarByName(summary: string): Promise<string | null>;
  createCalendar(summary: string): Promise<string>;
  calendarExists(calendarId: string): Promise<boolean>;
  /** "Make changes to events". Inserting for an existing scope updates it. */
  grantWriter(calendarId: string, email: string): Promise<void>;
  listEvents(calendarId: string, fromDate: string, toDate: string): Promise<TeamEvent[]>;
  /** Returns the new event id. */
  insertEvent(calendarId: string, e: TeamEventPayload): Promise<string>;
  updateEvent(calendarId: string, eventId: string, e: TeamEventPayload): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

/** A visit as the app holds it — a next_actions row of kind VISIT. */
export interface VisitRow {
  id: string;
  action: string;
  due_date: string;
  completed_at: string | null;
  owner_id: string;
  objective: string | null;
  calendar_event_id: string | null;
  calendar_origin: "app" | "google" | null;
  accountName: string | null;
  ownerFirstName: string;
}

export interface TeamCalendarStore {
  getCalendar(): Promise<{ googleCalendarId: string } | null>;
  saveCalendarId(id: string): Promise<void>;
  /** Every active admin's e-mail — the people the calendar is shared with. */
  listAdminEmails(): Promise<string[]>;
  /** Open visits in the window, plus completed ones that still hold an event. */
  listVisits(fromDate: string, toDate: string): Promise<VisitRow[]>;
  /** Whose grant the server uses; Google-born visits are theirs until assigned. */
  ownerMembershipId(): Promise<string>;
  markProjected(nextActionId: string, eventId: string): Promise<void>;
  clearProjection(nextActionId: string): Promise<void>;
  /** Returns the new row's id and its owner's first name, for the event's rep label. */
  importVisit(v: { eventId: string; date: string; title: string; ownerId: string }): Promise<{ id: string; ownerFirstName: string }>;
  updateImported(nextActionId: string, v: { date: string; title: string }): Promise<void>;
  deleteImported(nextActionId: string): Promise<void>;
  recordResult(r: { syncedAt: string; error: string | null }): Promise<void>;
}
```

- [ ] **Step 3: Write the failing tests**

```ts
// src/lib/calendar/__tests__/team-sync.test.ts
// The team calendar reconciliation, proven with fakes: the calendar is
// found or made, the admins are on it, app visits land as events, Google
// events land as visits, each side wins only what it was born with, and a
// replay changes nothing.

import { beforeEach, describe, expect, it } from "vitest";
import type {
  TeamCalendarPort,
  TeamCalendarStore,
  TeamEvent,
  TeamEventPayload,
  VisitRow,
} from "../team-port";
import { TEAM_CALENDAR_SUMMARY } from "../team-port";
import { eventTitle, syncTeamCalendar, syncWindow } from "../team-sync";

const TODAY = "2026-10-12";
const OWNER = "m-admin";

class FakeCalendar implements TeamCalendarPort {
  calendars = new Map<string, string>();
  acls = new Map<string, Map<string, string>>();
  events = new Map<string, TeamEvent[]>();
  seq = 0;
  async findCalendarByName(summary: string) {
    for (const [id, s] of this.calendars) if (s === summary) return id;
    return null;
  }
  async createCalendar(summary: string) {
    const id = `cal-${++this.seq}`;
    this.calendars.set(id, summary);
    this.acls.set(id, new Map());
    this.events.set(id, []);
    return id;
  }
  async calendarExists(id: string) {
    return this.calendars.has(id);
  }
  async grantWriter(id: string, email: string) {
    this.acls.get(id)!.set(email, "writer");
  }
  async listEvents(id: string, from: string, to: string) {
    return (this.events.get(id) ?? []).filter((e) => e.date >= from && e.date <= to);
  }
  async insertEvent(id: string, e: TeamEventPayload) {
    const eventId = `ev-${++this.seq}`;
    this.events.get(id)!.push({
      eventId,
      date: e.date,
      title: e.title,
      nextActionId: e.nextActionId,
      membershipId: e.membershipId,
      cancelled: false,
    });
    return eventId;
  }
  async updateEvent(id: string, eventId: string, e: TeamEventPayload) {
    const ev = this.events.get(id)!.find((x) => x.eventId === eventId)!;
    Object.assign(ev, { date: e.date, title: e.title, nextActionId: e.nextActionId, membershipId: e.membershipId });
  }
  async deleteEvent(id: string, eventId: string) {
    this.events.set(id, this.events.get(id)!.filter((x) => x.eventId !== eventId));
  }
  /** Test helper: an event somebody typed into Google by hand. */
  handMade(id: string, date: string, title: string) {
    const eventId = `ev-${++this.seq}`;
    this.events.get(id)!.push({ eventId, date, title, nextActionId: null, membershipId: null, cancelled: false });
    return eventId;
  }
}

class FakeStore implements TeamCalendarStore {
  calendarId: string | null = null;
  admins = ["bianca@gmxgroup.us", "joao@gmxgroup.us"];
  visits: VisitRow[] = [];
  results: { syncedAt: string; error: string | null }[] = [];
  seq = 0;
  async getCalendar() {
    return this.calendarId ? { googleCalendarId: this.calendarId } : null;
  }
  async saveCalendarId(id: string) {
    this.calendarId = id;
  }
  async listAdminEmails() {
    return this.admins;
  }
  async listVisits(from: string, to: string) {
    return this.visits.filter(
      (v) => v.due_date >= from && v.due_date <= to && (v.completed_at === null || v.calendar_event_id !== null),
    );
  }
  async ownerMembershipId() {
    return OWNER;
  }
  async markProjected(id: string, eventId: string) {
    const v = this.visits.find((x) => x.id === id)!;
    v.calendar_event_id = eventId;
    v.calendar_origin = "app";
  }
  async clearProjection(id: string) {
    const v = this.visits.find((x) => x.id === id);
    if (v) v.calendar_event_id = null;
  }
  async importVisit(v: { eventId: string; date: string; title: string; ownerId: string }) {
    const id = `na-g${++this.seq}`;
    this.visits.push({
      id,
      action: v.title,
      due_date: v.date,
      completed_at: null,
      owner_id: v.ownerId,
      objective: null,
      calendar_event_id: v.eventId,
      calendar_origin: "google",
      accountName: null,
      ownerFirstName: "Bianca",
    });
    return { id, ownerFirstName: "Bianca" };
  }
  async updateImported(id: string, v: { date: string; title: string }) {
    const row = this.visits.find((x) => x.id === id)!;
    row.due_date = v.date;
    row.action = v.title;
  }
  async deleteImported(id: string) {
    this.visits = this.visits.filter((x) => x.id !== id);
  }
  async recordResult(r: { syncedAt: string; error: string | null }) {
    this.results.push(r);
  }
  /** Test helper: a visit planned in the app. */
  planned(id: string, date: string, extra: Partial<VisitRow> = {}): VisitRow {
    const v: VisitRow = {
      id,
      action: "Visit",
      due_date: date,
      completed_at: null,
      owner_id: "m-deonn",
      objective: "PK_CLASS",
      calendar_event_id: null,
      calendar_origin: null,
      accountName: "Ganahl Lumber",
      ownerFirstName: "Deonn",
      ...extra,
    };
    this.visits.push(v);
    return v;
  }
}

let cal: FakeCalendar;
let store: FakeStore;
beforeEach(() => {
  cal = new FakeCalendar();
  store = new FakeStore();
});

describe("syncWindow", () => {
  it("runs 60 days back and 365 ahead", () => {
    expect(syncWindow("2026-10-12")).toEqual({ fromDate: "2026-08-13", toDate: "2027-10-12" });
  });
});

describe("eventTitle", () => {
  it("names the visit, the dealer and the rep", () => {
    expect(eventTitle({ action: "Visit", accountName: "Ganahl Lumber", ownerFirstName: "Deonn" })).toBe(
      "Visit — Ganahl Lumber · Deonn",
    );
  });
  it("skips the dealer when there is none", () => {
    expect(eventTitle({ action: "Team lunch", accountName: null, ownerFirstName: "Bianca" })).toBe(
      "Team lunch · Bianca",
    );
  });
});

describe("ensuring the calendar", () => {
  it("creates GMX Sales Team when nothing exists and shares it with the admins", async () => {
    const r = await syncTeamCalendar(cal, store, TODAY);
    expect(r.created).toBe(true);
    expect(cal.calendars.get(r.calendarId)).toBe(TEAM_CALENDAR_SUMMARY);
    expect(store.calendarId).toBe(r.calendarId);
    expect([...cal.acls.get(r.calendarId)!.entries()]).toEqual([
      ["bianca@gmxgroup.us", "writer"],
      ["joao@gmxgroup.us", "writer"],
    ]);
    expect(r.shared).toBe(2);
  });

  it("recognises an existing calendar by name instead of making a second", async () => {
    const existing = await cal.createCalendar(TEAM_CALENDAR_SUMMARY);
    const r = await syncTeamCalendar(cal, store, TODAY);
    expect(r.created).toBe(false);
    expect(r.calendarId).toBe(existing);
    expect(cal.calendars.size).toBe(1);
  });

  it("keeps the registered id while it still exists, recreates when it is gone", async () => {
    store.calendarId = "cal-gone";
    const r = await syncTeamCalendar(cal, store, TODAY);
    expect(r.created).toBe(true);
    expect(store.calendarId).not.toBe("cal-gone");
  });

  it("records the pass", async () => {
    await syncTeamCalendar(cal, store, TODAY);
    expect(store.results).toEqual([{ syncedAt: expect.any(String), error: null }]);
  });
});

describe("app → Google", () => {
  it("inserts an event for an open visit and remembers the event id", async () => {
    store.planned("na-1", "2026-10-15");
    const r = await syncTeamCalendar(cal, store, TODAY);
    expect(r.inserted).toBe(1);
    const ev = cal.events.get(r.calendarId)![0];
    expect(ev).toMatchObject({
      date: "2026-10-15",
      title: "Visit — Ganahl Lumber · Deonn",
      nextActionId: "na-1",
      membershipId: "m-deonn",
    });
    expect(store.visits[0]).toMatchObject({ calendar_event_id: ev.eventId, calendar_origin: "app" });
  });

  it("updates the event when the visit moved or was reassigned", async () => {
    const v = store.planned("na-1", "2026-10-15");
    const r1 = await syncTeamCalendar(cal, store, TODAY);
    v.due_date = "2026-10-20";
    v.owner_id = "m-jason";
    v.ownerFirstName = "Jason";
    const r2 = await syncTeamCalendar(cal, store, TODAY);
    expect(r2.updated).toBe(1);
    expect(cal.events.get(r1.calendarId)![0]).toMatchObject({
      date: "2026-10-20",
      title: "Visit — Ganahl Lumber · Jason",
      membershipId: "m-jason",
    });
  });

  it("a completed app visit deletes its event, even if Google edited it meanwhile", async () => {
    const v = store.planned("na-1", "2026-10-15");
    const r1 = await syncTeamCalendar(cal, store, TODAY);
    cal.events.get(r1.calendarId)![0].title = "edited in Google";
    v.completed_at = "2026-10-15T18:00:00Z";
    const r2 = await syncTeamCalendar(cal, store, TODAY);
    expect(r2.deleted).toBe(1);
    expect(cal.events.get(r1.calendarId)).toHaveLength(0);
    expect(v.calendar_event_id).toBeNull();
  });

  it("re-inserts an app-born event somebody deleted in Google", async () => {
    store.planned("na-1", "2026-10-15");
    const r1 = await syncTeamCalendar(cal, store, TODAY);
    cal.events.set(r1.calendarId, []);
    const r2 = await syncTeamCalendar(cal, store, TODAY);
    expect(r2.inserted).toBe(1);
    expect(cal.events.get(r1.calendarId)).toHaveLength(1);
  });

  it("leaves visits outside the window alone", async () => {
    store.planned("na-old", "2026-01-01");
    const r = await syncTeamCalendar(cal, store, TODAY);
    expect(r.inserted).toBe(0);
  });
});

describe("Google → app", () => {
  it("imports a hand-made event as a visit owned by the calendar owner and tags the event", async () => {
    const id = await cal.createCalendar(TEAM_CALENDAR_SUMMARY);
    const evId = cal.handMade(id, "2026-10-20", "Salt Lake follow-up");
    const r = await syncTeamCalendar(cal, store, TODAY);
    expect(r.imported).toBe(1);
    expect(store.visits[0]).toMatchObject({
      action: "Salt Lake follow-up",
      due_date: "2026-10-20",
      owner_id: OWNER,
      calendar_event_id: evId,
      calendar_origin: "google",
    });
    expect(cal.events.get(id)![0]).toMatchObject({ nextActionId: store.visits[0].id, membershipId: OWNER });
  });

  it("imports a timed event by its start day", async () => {
    const id = await cal.createCalendar(TEAM_CALENDAR_SUMMARY);
    cal.events.get(id)!.push({
      eventId: "ev-timed",
      date: "2026-10-21",
      title: "Lunch with Timberline",
      nextActionId: null,
      membershipId: null,
      cancelled: false,
    });
    await syncTeamCalendar(cal, store, TODAY);
    expect(store.visits[0].due_date).toBe("2026-10-21");
  });

  it("follows Google's edits on a Google-born visit", async () => {
    const id = await cal.createCalendar(TEAM_CALENDAR_SUMMARY);
    cal.handMade(id, "2026-10-20", "Salt Lake follow-up");
    await syncTeamCalendar(cal, store, TODAY);
    const ev = cal.events.get(id)![0];
    ev.date = "2026-10-22";
    ev.title = "Salt Lake follow-up (moved)";
    const r = await syncTeamCalendar(cal, store, TODAY);
    expect(r.importedUpdated).toBe(1);
    expect(store.visits[0]).toMatchObject({ due_date: "2026-10-22", action: "Salt Lake follow-up (moved)" });
  });

  it("deletes a Google-born visit when its event is gone or cancelled", async () => {
    const id = await cal.createCalendar(TEAM_CALENDAR_SUMMARY);
    cal.handMade(id, "2026-10-20", "Gone");
    await syncTeamCalendar(cal, store, TODAY);
    cal.events.get(id)![0].cancelled = true;
    const r = await syncTeamCalendar(cal, store, TODAY);
    expect(r.importedDeleted).toBe(1);
    expect(store.visits).toHaveLength(0);
  });

  it("an assignment in the app moves the rep label on a Google-born event", async () => {
    const id = await cal.createCalendar(TEAM_CALENDAR_SUMMARY);
    cal.handMade(id, "2026-10-20", "Salt Lake follow-up");
    await syncTeamCalendar(cal, store, TODAY);
    store.visits[0].owner_id = "m-deonn";
    store.visits[0].ownerFirstName = "Deonn";
    const r = await syncTeamCalendar(cal, store, TODAY);
    expect(r.updated).toBe(1);
    expect(cal.events.get(id)![0]).toMatchObject({ membershipId: "m-deonn", title: "Salt Lake follow-up · Deonn" });
  });

  it("a completed Google-born visit deletes its event too", async () => {
    const id = await cal.createCalendar(TEAM_CALENDAR_SUMMARY);
    cal.handMade(id, "2026-10-20", "Done one");
    await syncTeamCalendar(cal, store, TODAY);
    store.visits[0].completed_at = "2026-10-20T20:00:00Z";
    const r = await syncTeamCalendar(cal, store, TODAY);
    expect(r.deleted).toBe(1);
    expect(cal.events.get(id)).toHaveLength(0);
  });
});

describe("idempotence", () => {
  it("replaying a pass changes nothing", async () => {
    store.planned("na-1", "2026-10-15");
    const id = await cal.createCalendar(TEAM_CALENDAR_SUMMARY);
    cal.handMade(id, "2026-10-20", "Hand-made");
    await syncTeamCalendar(cal, store, TODAY);
    const r = await syncTeamCalendar(cal, store, TODAY);
    expect(r).toMatchObject({ inserted: 0, updated: 0, deleted: 0, imported: 0, importedUpdated: 0, importedDeleted: 0 });
    expect(cal.events.get(id)).toHaveLength(2);
    expect(store.visits).toHaveLength(2);
  });

  it("records the error and rethrows when the calendar fails", async () => {
    cal.findCalendarByName = async () => {
      throw new Error("calendar 503");
    };
    await expect(syncTeamCalendar(cal, store, TODAY)).rejects.toThrow("calendar 503");
    expect(store.results).toEqual([{ syncedAt: expect.any(String), error: "calendar 503" }]);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/lib/calendar/__tests__/team-sync.test.ts`
Expected: FAIL — cannot resolve `../team-sync`.

- [ ] **Step 5: Implement `team-sync.ts`**

```ts
// src/lib/calendar/team-sync.ts
// ONE RECONCILIATION PASS over the team calendar (spec 2026-10-12).
//
//   ensure the calendar: registered id, else by name, else create it
//   ensure the shares: every active admin as writer (re-asserted each pass)
//   app → Google: open visits become events; moved/reassigned → update;
//                 completed → the event goes (history lives in the app, D46)
//   Google → app: a hand-made event becomes a visit owned by the calendar's
//                 owner; Google's later edits follow; a cancelled event
//                 removes the visit
//
// WHO WINS is where the row was born, never a clock: an app-born visit is
// edited in the app (a Google edit is overwritten, a Google delete is
// undone), a Google-born one in Google (its date and title are read, not
// written — except the rep label, which the app owns on every event).
//
// Idempotent by construction: next_action_id rides each event's private
// properties, so a replay converges instead of duplicating.

import { humanize } from "@/lib/domain/enums";
import {
  TEAM_CALENDAR_SUMMARY,
  type TeamCalendarPort,
  type TeamCalendarStore,
  type TeamEvent,
  type TeamEventPayload,
  type VisitRow,
} from "./team-port";

export interface TeamSyncReport {
  calendarId: string;
  created: boolean;
  shared: number;
  inserted: number;
  updated: number;
  deleted: number;
  imported: number;
  importedUpdated: number;
  importedDeleted: number;
}

const DAY_MS = 86_400_000;

function shift(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** 60 days back, a year ahead: what the board can show and the admin can plan. */
export function syncWindow(today: string): { fromDate: string; toDate: string } {
  return { fromDate: shift(today, -60), toDate: shift(today, 365) };
}

export function eventTitle(v: Pick<VisitRow, "action" | "accountName" | "ownerFirstName">): string {
  return v.accountName
    ? `${v.action} — ${v.accountName} · ${v.ownerFirstName}`
    : `${v.action} · ${v.ownerFirstName}`;
}

/** A Google-born event keeps Google's own title; only the rep label is ours. */
function googleBornTitle(v: VisitRow): string {
  return `${v.action} · ${v.ownerFirstName}`;
}

function payloadFor(v: VisitRow): TeamEventPayload {
  const born = v.calendar_origin === "google";
  return {
    date: v.due_date,
    title: born ? googleBornTitle(v) : eventTitle(v),
    description: [
      v.objective ? `Purpose: ${humanize(v.objective)}` : null,
      born ? null : "Planned in Commercial OS — edit it there, not here.",
    ]
      .filter(Boolean)
      .join("\n"),
    nextActionId: v.id,
    membershipId: v.owner_id,
    pinDate: !born,
  };
}

/** Strip our own " · Rep" suffix so Google's title round-trips unchanged. */
function stripRepLabel(title: string): string {
  const i = title.lastIndexOf(" · ");
  return i > 0 ? title.slice(0, i) : title;
}

export async function syncTeamCalendar(
  calendar: TeamCalendarPort,
  store: TeamCalendarStore,
  today: string,
): Promise<TeamSyncReport> {
  try {
    const report = await pass(calendar, store, today);
    await store.recordResult({ syncedAt: new Date().toISOString(), error: null });
    return report;
  } catch (err) {
    await store.recordResult({
      syncedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function pass(
  calendar: TeamCalendarPort,
  store: TeamCalendarStore,
  today: string,
): Promise<TeamSyncReport> {
  // ── Ensure the calendar ───────────────────────────────────────────────────
  let calendarId = (await store.getCalendar())?.googleCalendarId ?? null;
  let created = false;
  if (calendarId && !(await calendar.calendarExists(calendarId))) calendarId = null;
  if (!calendarId) {
    calendarId = await calendar.findCalendarByName(TEAM_CALENDAR_SUMMARY);
    if (!calendarId) {
      calendarId = await calendar.createCalendar(TEAM_CALENDAR_SUMMARY);
      created = true;
    }
    await store.saveCalendarId(calendarId);
  }

  // ── Ensure the shares ─────────────────────────────────────────────────────
  const admins = await store.listAdminEmails();
  for (const email of admins) await calendar.grantWriter(calendarId, email);

  // ── Read both sides ───────────────────────────────────────────────────────
  const { fromDate, toDate } = syncWindow(today);
  const [visits, events] = await Promise.all([
    store.listVisits(fromDate, toDate),
    calendar.listEvents(calendarId, fromDate, toDate),
  ]);
  const eventById = new Map<string, TeamEvent>();
  for (const e of events) eventById.set(e.eventId, e);
  const visitById = new Map(visits.map((v) => [v.id, v] as const));

  const report: TeamSyncReport = {
    calendarId,
    created,
    shared: admins.length,
    inserted: 0,
    updated: 0,
    deleted: 0,
    imported: 0,
    importedUpdated: 0,
    importedDeleted: 0,
  };

  // ── App → Google ──────────────────────────────────────────────────────────
  for (const v of visits) {
    const ev = v.calendar_event_id ? eventById.get(v.calendar_event_id) : undefined;
    const live = ev && !ev.cancelled ? ev : undefined;

    if (v.completed_at) {
      // Completion wins on both origins: the calendar shows the plan.
      if (live) {
        await calendar.deleteEvent(calendarId, live.eventId);
        report.deleted++;
      }
      if (v.calendar_event_id) await store.clearProjection(v.id);
      continue;
    }

    if (v.calendar_origin === "google") {
      if (!live) {
        // Its event is gone or cancelled in Google: Google owns it.
        await store.deleteImported(v.id);
        report.importedDeleted++;
        continue;
      }
      // Google owns date and title; the app owns the rep label.
      const googleTitle = stripRepLabel(live.title);
      if (live.date !== v.due_date || googleTitle !== v.action) {
        await store.updateImported(v.id, { date: live.date, title: googleTitle });
        v.due_date = live.date;
        v.action = googleTitle;
        report.importedUpdated++;
      }
      const want = payloadFor(v);
      if (live.title !== want.title || live.membershipId !== v.owner_id) {
        await calendar.updateEvent(calendarId, live.eventId, want);
        report.updated++;
      }
      continue;
    }

    // App-born (or never synced): the app is the author.
    const want = payloadFor(v);
    if (!live) {
      const eventId = await calendar.insertEvent(calendarId, want);
      await store.markProjected(v.id, eventId);
      report.inserted++;
    } else if (
      live.date !== want.date ||
      live.title !== want.title ||
      live.membershipId !== want.membershipId
    ) {
      await calendar.updateEvent(calendarId, live.eventId, want);
      report.updated++;
    }
  }

  // ── Google → app ──────────────────────────────────────────────────────────
  const ownerId = await store.ownerMembershipId();
  for (const e of events) {
    if (e.cancelled) continue;
    if (e.nextActionId && visitById.has(e.nextActionId)) continue;
    if (e.nextActionId && !visitById.has(e.nextActionId)) {
      // Tagged, but its row is gone (deleted in the app, or completed and
      // out of the window). An app-born row that is deleted takes its event
      // with it; a Google-born one is left alone — the admin still has it.
      continue;
    }
    const { id, ownerFirstName } = await store.importVisit({
      eventId: e.eventId,
      date: e.date,
      title: e.title,
      ownerId,
    });
    await calendar.updateEvent(calendarId, e.eventId, {
      date: e.date,
      title: `${e.title} · ${ownerFirstName}`,
      description: "",
      nextActionId: id,
      membershipId: ownerId,
      pinDate: false,
    });
    report.imported++;
  }

  return report;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/calendar/__tests__/team-sync.test.ts`
Expected: 19 passed.

- [ ] **Step 7: Commit**

```bash
git add src/lib/calendar/team-port.ts src/lib/calendar/team-sync.ts src/lib/calendar/__tests__/team-sync.test.ts
git commit -m "feat(calendar): team calendar reconciliation core, proven with fakes; §6 projection removed"
```

---

### Task 4: Adapters — Google over OAuth, Supabase store

**Files:**
- Create: `src/lib/calendar/google-team-calendar.ts`
- Create: `src/lib/calendar/team-store.ts`

**Interfaces:**
- Consumes: `TeamCalendarPort`, `TeamCalendarStore`, `VisitRow` (Task 3); `accessTokenFromRefresh`, `OAuthClient` (Task 2).
- Produces:
  ```ts
  export class GoogleTeamCalendar implements TeamCalendarPort { constructor(client: OAuthClient, refreshToken: string) }
  export class SupabaseTeamCalendarStore implements TeamCalendarStore { constructor(service: SupabaseClient, orgId: string, ownerMembershipId: string) }
  ```

- [ ] **Step 1: Write the Google adapter**

```ts
// src/lib/calendar/google-team-calendar.ts
// TeamCalendarPort over the Google Calendar REST API, acting AS THE OWNER of
// the team calendar through their OAuth grant (not a service account — none
// was ever issued). Every call renews the access token from the refresh
// token first; the cache in oauth.ts makes that free within the hour.

import { accessTokenFromRefresh, type OAuthClient } from "@/lib/google/oauth";
import type { TeamCalendarPort, TeamEvent, TeamEventPayload } from "./team-port";

const API = "https://www.googleapis.com/calendar/v3";
const APP = "commercial-os";

interface GEvent {
  id: string;
  summary?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export class GoogleTeamCalendar implements TeamCalendarPort {
  constructor(
    private client: OAuthClient,
    private refreshToken: string,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await accessTokenFromRefresh(this.client, this.refreshToken);
    return fetch(`${API}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private async ok(res: Response, what: string): Promise<Response> {
    if (!res.ok) throw new Error(`${what} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async findCalendarByName(summary: string): Promise<string | null> {
    let pageToken = "";
    do {
      const res = await this.ok(
        await this.call("GET", `users/me/calendarList?minAccessRole=owner${pageToken ? `&pageToken=${pageToken}` : ""}`),
        "calendarList.list",
      );
      const body = (await res.json()) as { items?: { id: string; summary?: string }[]; nextPageToken?: string };
      const hit = (body.items ?? []).find((c) => c.summary === summary);
      if (hit) return hit.id;
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
    return null;
  }

  async createCalendar(summary: string): Promise<string> {
    const res = await this.ok(await this.call("POST", "calendars", { summary }), "calendars.insert");
    return ((await res.json()) as { id: string }).id;
  }

  async calendarExists(calendarId: string): Promise<boolean> {
    const res = await this.call("GET", `calendars/${encodeURIComponent(calendarId)}`);
    if (res.status === 404 || res.status === 410) return false;
    await this.ok(res, "calendars.get");
    return true;
  }

  async grantWriter(calendarId: string, email: string): Promise<void> {
    await this.ok(
      await this.call("POST", `calendars/${encodeURIComponent(calendarId)}/acl?sendNotifications=false`, {
        role: "writer",
        scope: { type: "user", value: email },
      }),
      `acl.insert(${email})`,
    );
  }

  async listEvents(calendarId: string, fromDate: string, toDate: string): Promise<TeamEvent[]> {
    const out: TeamEvent[] = [];
    let pageToken = "";
    do {
      const q = new URLSearchParams({
        maxResults: "250",
        singleEvents: "true",
        showDeleted: "true",
        timeMin: `${fromDate}T00:00:00Z`,
        timeMax: `${toDate}T23:59:59Z`,
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await this.ok(
        await this.call("GET", `calendars/${encodeURIComponent(calendarId)}/events?${q}`),
        "events.list",
      );
      const body = (await res.json()) as { items?: GEvent[]; nextPageToken?: string };
      for (const it of body.items ?? []) {
        const priv = it.extendedProperties?.private ?? {};
        out.push({
          eventId: it.id,
          date: it.start?.date ?? it.start?.dateTime?.slice(0, 10) ?? "",
          title: it.summary ?? "(no title)",
          nextActionId: priv.app === APP ? (priv.next_action_id ?? null) : null,
          membershipId: priv.app === APP ? (priv.membership_id ?? null) : null,
          cancelled: it.status === "cancelled",
        });
      }
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
    return out.filter((e) => e.date !== "");
  }

  private body(e: TeamEventPayload) {
    const dayAfter = new Date(`${e.date}T00:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    return {
      summary: e.title,
      description: e.description,
      start: { date: e.date },
      end: { date: dayAfter.toISOString().slice(0, 10) },
      extendedProperties: {
        private: { app: APP, next_action_id: e.nextActionId, membership_id: e.membershipId },
      },
    };
  }

  async insertEvent(calendarId: string, e: TeamEventPayload): Promise<string> {
    const res = await this.ok(
      await this.call("POST", `calendars/${encodeURIComponent(calendarId)}/events`, this.body(e)),
      "events.insert",
    );
    return ((await res.json()) as { id: string }).id;
  }

  async updateEvent(calendarId: string, eventId: string, e: TeamEventPayload): Promise<void> {
    // PATCH keeps what Google holds that we do not model (location, guests,
    // a clock time an admin typed) and changes only what the app owns.
    const patch = {
      summary: e.title,
      ...(e.description ? { description: e.description } : {}),
      extendedProperties: {
        private: { app: APP, next_action_id: e.nextActionId, membership_id: e.membershipId },
      },
    };
    await this.ok(
      await this.call(
        "PATCH",
        `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        e.pinDate ? { ...patch, ...this.dates(e.date) } : patch,
      ),
      "events.patch",
    );
  }

  /** pinDate: all-day on the visit's day; otherwise Google's own date and clock stand. */
  private dates(date: string) {
    const dayAfter = new Date(`${date}T00:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    return { start: { date }, end: { date: dayAfter.toISOString().slice(0, 10) } };
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const res = await this.call(
      "DELETE",
      `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
    if (res.status === 404 || res.status === 410) return;
    await this.ok(res, "events.delete");
  }
}
```

- [ ] **Step 2: Write the Supabase store**

```ts
// src/lib/calendar/team-store.ts
// TeamCalendarStore over the service-role client, scoped to ONE org by the
// route that built it — the same posture as the email store. Visits are
// next_actions rows of kind VISIT (or null: the trigger has not classified
// them yet, read as a visit, the Agenda's rule).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamCalendarStore, VisitRow } from "./team-port";

const VISIT_COLS =
  "id, action, due_date, completed_at, owner_id, objective, calendar_event_id, calendar_origin, accounts(name), memberships!next_actions_owner_id_fkey(users(full_name))";

interface Raw {
  id: string;
  action: string;
  due_date: string;
  completed_at: string | null;
  owner_id: string;
  objective: string | null;
  calendar_event_id: string | null;
  calendar_origin: "app" | "google" | null;
  accounts: { name: string } | null;
  memberships: { users: { full_name: string | null } | null } | null;
}

function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

export class SupabaseTeamCalendarStore implements TeamCalendarStore {
  constructor(
    private service: SupabaseClient,
    private orgId: string,
    private owner: string,
  ) {}

  async getCalendar() {
    const { data } = await this.service
      .from("team_calendars")
      .select("google_calendar_id")
      .eq("org_id", this.orgId)
      .maybeSingle();
    return data ? { googleCalendarId: data.google_calendar_id as string } : null;
  }

  async saveCalendarId(id: string) {
    const { error } = await this.service.from("team_calendars").upsert(
      { org_id: this.orgId, google_calendar_id: id, owner_membership_id: this.owner },
      { onConflict: "org_id" },
    );
    if (error) throw new Error(`team_calendars upsert failed: ${error.message}`);
  }

  async listAdminEmails() {
    const { data, error } = await this.service
      .from("memberships")
      .select("users(email)")
      .eq("org_id", this.orgId)
      .eq("role", "admin")
      .eq("status", "active");
    if (error) throw new Error(`admins read failed: ${error.message}`);
    return ((data ?? []) as unknown as { users: { email: string } | null }[])
      .map((r) => r.users?.email)
      .filter((e): e is string => Boolean(e))
      .sort();
  }

  async ownerMembershipId() {
    return this.owner;
  }

  async listVisits(fromDate: string, toDate: string): Promise<VisitRow[]> {
    const { data, error } = await this.service
      .from("next_actions")
      .select(VISIT_COLS)
      .eq("org_id", this.orgId)
      .or("kind.eq.VISIT,kind.is.null")
      .gte("due_date", fromDate)
      .lte("due_date", toDate)
      .or("completed_at.is.null,calendar_event_id.not.is.null")
      .order("due_date")
      .limit(500);
    if (error) throw new Error(`next_actions read failed: ${error.message}`);
    return ((data ?? []) as unknown as Raw[]).map((r) => ({
      id: r.id,
      action: r.action,
      due_date: r.due_date,
      completed_at: r.completed_at,
      owner_id: r.owner_id,
      objective: r.objective,
      calendar_event_id: r.calendar_event_id,
      calendar_origin: r.calendar_origin,
      accountName: r.accounts?.name ?? null,
      ownerFirstName: firstName(r.memberships?.users?.full_name),
    }));
  }

  async markProjected(id: string, eventId: string) {
    const { error } = await this.service
      .from("next_actions")
      .update({ calendar_event_id: eventId, calendar_origin: "app" })
      .eq("id", id);
    if (error) throw new Error(`markProjected failed: ${error.message}`);
  }

  async clearProjection(id: string) {
    const { error } = await this.service
      .from("next_actions")
      .update({ calendar_event_id: null })
      .eq("id", id);
    if (error) throw new Error(`clearProjection failed: ${error.message}`);
  }

  async importVisit(v: { eventId: string; date: string; title: string; ownerId: string }) {
    const { data, error } = await this.service
      .from("next_actions")
      .insert({
        org_id: this.orgId,
        action: v.title,
        due_date: v.date,
        owner_id: v.ownerId,
        kind: "VISIT",
        calendar_event_id: v.eventId,
        calendar_origin: "google",
      })
      .select("id, memberships!next_actions_owner_id_fkey(users(full_name))")
      .single();
    if (error) throw new Error(`importVisit failed: ${error.message}`);
    const row = data as unknown as { id: string; memberships: { users: { full_name: string | null } | null } | null };
    return { id: row.id, ownerFirstName: firstName(row.memberships?.users?.full_name) };
  }

  async updateImported(id: string, v: { date: string; title: string }) {
    const { error } = await this.service
      .from("next_actions")
      .update({ due_date: v.date, action: v.title })
      .eq("id", id)
      .eq("calendar_origin", "google");
    if (error) throw new Error(`updateImported failed: ${error.message}`);
  }

  async deleteImported(id: string) {
    const { error } = await this.service
      .from("next_actions")
      .delete()
      .eq("id", id)
      .eq("calendar_origin", "google")
      .is("completed_at", null);
    if (error) throw new Error(`deleteImported failed: ${error.message}`);
  }

  async recordResult(r: { syncedAt: string; error: string | null }) {
    await this.service
      .from("team_calendars")
      .update({ last_synced_at: r.syncedAt, last_error: r.error })
      .eq("org_id", this.orgId);
  }
}
```

- [ ] **Step 3: Type-check what exists so far**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "api/calendar/sync"`
Expected: no errors outside the old route (deleted next task). If the `memberships!next_actions_owner_id_fkey` embed name is wrong, read the constraint name with `select conname from pg_constraint where conrelid='next_actions'::regclass and conname like '%owner%'` and use that.

- [ ] **Step 4: Commit**

```bash
git add src/lib/calendar/google-team-calendar.ts src/lib/calendar/team-store.ts
git commit -m "feat(calendar): Google adapter over the owner's grant, Supabase store"
```

---

### Task 5: The route — cron GET, admin POST; old route and cron removed

**Files:**
- Create: `src/app/api/calendar/team/sync/route.ts`
- Delete: `src/app/api/calendar/sync/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: `GET /api/calendar/team/sync` (Bearer CRON_SECRET → every org with a `team_calendars` row or a connected admin), `POST /api/calendar/team/sync` (signed-in admin → their org). Responses: 200 `TeamSyncReport & {owner: string}`; 501 `{error}` when env or grant missing; 409 `{error: "the calendar owner must reconnect Google"}` on revoked grant; 401/403 as usual.

- [ ] **Step 1: Delete the old route and its cron**

```bash
git rm src/app/api/calendar/sync/route.ts
```

`vercel.json`:
```json
{
  "crons": [
    { "path": "/api/email/sync", "schedule": "*/15 * * * *" },
    { "path": "/api/calendar/team/sync", "schedule": "*/15 * * * *" },
    { "path": "/api/hubspot/sync", "schedule": "*/5 * * * *" }
  ]
}
```

- [ ] **Step 2: Write the route**

```ts
// src/app/api/calendar/team/sync/route.ts
// The team calendar's one trigger (spec 2026-10-12). Two callers:
//   · Vercel Cron, GET with `authorization: Bearer ${CRON_SECRET}`, every org
//   · a signed-in admin, POST, their org — the settings page right after the
//     grant lands, and the Reps board on load (fire-and-forget)
//
// WHOSE GRANT: the org's registered owner (team_calendars.owner_membership_id).
// Before one is registered, the first admin with a Google connection becomes
// the owner — that is the Connect tap on /settings/google.
//
// Vercel Cron sends GET, not POST — both are exported (the §6 route only had
// POST and 405'd every hour for a month).

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GoogleTeamCalendar } from "@/lib/calendar/google-team-calendar";
import { SupabaseTeamCalendarStore } from "@/lib/calendar/team-store";
import { syncTeamCalendar } from "@/lib/calendar/team-sync";
import { GoogleReauthNeeded, oauthClientFromEnv } from "@/lib/google/oauth";
import { orgIdFromJwt } from "@/lib/supabase/jwt";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 300;

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The owner's membership and refresh token for one org, or why not. */
async function ownerGrant(
  service: SupabaseClient,
  orgId: string,
): Promise<{ owner: string; refreshToken: string } | { error: string }> {
  const { data: reg } = await service
    .from("team_calendars")
    .select("owner_membership_id")
    .eq("org_id", orgId)
    .maybeSingle();
  let owner = (reg?.owner_membership_id as string | undefined) ?? null;
  if (!owner) {
    const { data: first } = await service
      .from("google_connections")
      .select("membership_id, memberships!inner(role, status)")
      .eq("org_id", orgId)
      .eq("memberships.role", "admin")
      .eq("memberships.status", "active")
      .order("connected_at")
      .limit(1)
      .maybeSingle();
    owner = (first?.membership_id as string | undefined) ?? null;
  }
  if (!owner) return { error: "No admin has connected Google Calendar yet — the calendar owner taps Connect on Email & Calendar." };
  const { data: conn } = await service
    .from("google_connections")
    .select("refresh_token")
    .eq("membership_id", owner)
    .maybeSingle();
  if (!conn?.refresh_token) return { error: "The calendar owner's Google connection has no refresh token — they must reconnect." };
  return { owner, refreshToken: conn.refresh_token as string };
}

async function syncOrg(service: SupabaseClient, orgId: string) {
  const client = oauthClientFromEnv();
  if (!client) {
    return NextResponse.json(
      { error: "Calendar sync isn't connected yet — GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured." },
      { status: 501 },
    );
  }
  const grant = await ownerGrant(service, orgId);
  if ("error" in grant) return NextResponse.json({ error: grant.error }, { status: 501 });
  const port = new GoogleTeamCalendar(client, grant.refreshToken);
  const store = new SupabaseTeamCalendarStore(service, orgId, grant.owner);
  try {
    const report = await syncTeamCalendar(port, store, today());
    return NextResponse.json({ ...report, owner: grant.owner });
  } catch (err) {
    if (err instanceof GoogleReauthNeeded) {
      return NextResponse.json({ error: err.message, owner: grant.owner }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), owner: grant.owner },
      { status: 502 },
    );
  }
}

async function handler(req: Request) {
  const service = serviceClient();

  // ── Cron: every org that has an owner or a candidate ─────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    const { data: orgs } = await service.from("google_connections").select("org_id");
    const ids = [...new Set(((orgs ?? []) as { org_id: string }[]).map((o) => o.org_id))];
    const results = [];
    for (const orgId of ids) {
      const res = await syncOrg(service, orgId);
      results.push({ orgId, status: res.status, ...(await res.json()) });
    }
    return NextResponse.json({ results });
  }
  if (req.method === "GET") {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // ── Admin: their own org ──────────────────────────────────────────────────
  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const orgId = orgIdFromJwt(session.access_token);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 403 });
  const { data: me } = await service
    .from("memberships")
    .select("id, role")
    .eq("user_id", session.user.id)
    .eq("org_id", orgId)
    .eq("status", "active")
    .maybeSingle();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ error: "admins only" }, { status: 403 });
  }
  return syncOrg(service, orgId);
}

export const GET = handler;
export const POST = handler;
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit -p . && npx eslint src/app/api/calendar src/lib/calendar src/lib/google`
Expected: clean. (`rep_calendars` references in `database.types.ts` were regenerated in Task 1.)

- [ ] **Step 4: Prove the 501 by hand**

Run (dev server on 3001, no env yet): `curl -s -X POST http://localhost:3001/api/calendar/team/sync` with a signed-in cookie is awkward; instead: `curl -s -i http://localhost:3001/api/calendar/team/sync | head -1`
Expected: `HTTP/1.1 401` (GET without the cron secret). With `-H "authorization: Bearer $CRON_SECRET"`: `{"results":[]}` because no `google_connections` rows exist yet.

- [ ] **Step 5: Commit**

```bash
git add vercel.json src/app/api/calendar/team/sync/route.ts
git commit -m "feat(calendar): team sync route — cron GET, admin POST; §6 route and hourly cron removed"
```

---

### Task 6: Settings page — admin scope, sync after the grant, team-calendar status

**Files:**
- Modify: `src/app/settings/google/page.tsx`
- Modify: `src/components/setup-banner.tsx` (reconnect wording for the owner)

**Interfaces:**
- Consumes: `POST /api/calendar/team/sync` (Task 5); `team_calendars` select (Task 1).

- [ ] **Step 1: Scope by role, sync after the grant, show the status**

In `src/app/settings/google/page.tsx`:

Replace the constant:
```ts
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
];
```
with
```ts
// A REP asks for what a rep does: send a quote, put a visit on a calendar.
// An ADMIN asks for the whole Calendar scope, because the team calendar is
// created and shared from their account (spec 2026-10-12) and neither
// creating a calendar nor sharing it fits inside calendar.events.
const REP_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
];
const ADMIN_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
];
function scopesFor(role: string | null | undefined): string[] {
  return role === "admin" ? ADMIN_SCOPES : REP_SCOPES;
}

interface TeamCalendar {
  google_calendar_id: string;
  owner_membership_id: string;
  summary: string;
  last_synced_at: string | null;
  last_error: string | null;
}
```

Add state after `error`:
```ts
  const [team, setTeam] = useState<TeamCalendar | null>(null);
  const [teamNote, setTeamNote] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
```

In the effect, replace `scopes: GOOGLE_SCOPES,` in the upsert with `scopes: scopesFor(profile.role),`, and after the `setConn(...)` line add:
```ts
          // THE DESK'S NEXT STEP: with a fresh admin grant, run the sync now
          // so the page can say "GMX Sales Team · shared with 2 admins" —
          // or the error in words — before the admin leaves.
          if (profile.role === "admin") {
            if (refresh) {
              const res = await fetch("/api/calendar/team/sync", { method: "POST" });
              const body = (await res.json().catch(() => ({}))) as { error?: string; shared?: number };
              if (!stale) setTeamNote(res.ok ? null : (body.error ?? `sync failed (${res.status})`));
            }
            const { data: tc } = await supabase
              .from("team_calendars")
              .select("google_calendar_id, owner_membership_id, summary, last_synced_at, last_error")
              .eq("org_id", profile.orgId)
              .maybeSingle();
            if (!stale) setTeam((tc as TeamCalendar | null) ?? null);
            if (tc?.owner_membership_id) {
              const { data: who } = await supabase
                .from("memberships")
                .select("users(full_name)")
                .eq("id", tc.owner_membership_id)
                .maybeSingle();
              if (!stale)
                setOwnerName(
                  (who as unknown as { users: { full_name: string | null } | null } | null)?.users?.full_name ?? null,
                );
            }
          }
```

In `connect()`, replace `scopes: GOOGLE_SCOPES.join(" "),` with `scopes: scopesFor(profile?.role).join(" "),`.

In the JSX, after the admin hint paragraph added on 2026-10-12, add the status card (admins only):
```tsx
        {profile?.role === "admin" && (
          <div className="card card-pad flex flex-col gap-1">
            <p className="t-meta uppercase tracking-wide">Team calendar</p>
            {team ? (
              <>
                <p className="t-title">{team.summary}</p>
                <p className="t-sub">
                  Owned by {ownerName ?? "an admin"}
                  {team.last_synced_at
                    ? ` · last synced ${DAY.format(new Date(team.last_synced_at))}`
                    : ""}
                </p>
                {team.last_error && (
                  <p className="t-sub" style={{ color: "var(--danger)" }}>
                    {team.last_error}
                  </p>
                )}
              </>
            ) : (
              <p className="t-sub">
                Not created yet. The admin whose Google account will own it taps
                Connect above; the calendar is created and shared with every
                admin on the spot.
              </p>
            )}
            {teamNote && (
              <p className="t-sub" style={{ color: "var(--danger)" }}>
                {teamNote}
              </p>
            )}
          </div>
        )}
```

- [ ] **Step 2: The banner tells the owner to reconnect**

In `src/components/setup-banner.tsx`, the banner today hides once a `google_connections` row exists. Add a second reason to show it: the org's `team_calendars.last_error` mentions "reconnect" and this profile is the owner. In the effect, after reading the connection, add:
```ts
          if (manages(profile.role)) {
            const { data: tc } = await getSupabaseBrowserClient()
              .from("team_calendars")
              .select("owner_membership_id, last_error")
              .eq("org_id", profile.orgId)
              .maybeSingle();
            if (
              !stale &&
              tc?.owner_membership_id === profile.membershipId &&
              typeof tc.last_error === "string" &&
              /reconnect/i.test(tc.last_error)
            )
              setReconnect(true);
          }
```
with `const [reconnect, setReconnect] = useState(false);` beside `connected`, the early return condition becoming `(connected !== false && !reconnect)`, and the copy:
```tsx
        {reconnect
          ? " — Google dropped the team calendar connection; reconnect to keep the agenda in sync"
          : profile.role === "rep"
            ? " — connect your Gmail & Calendar so quotes and visits can travel as you"
            : " — connect Google Calendar so the team's agenda can show here"}
```

- [ ] **Step 3: Lint, type-check, look**

Run: `npx tsc --noEmit -p . && npx eslint src/app/settings/google/page.tsx src/components/setup-banner.tsx`
Expected: clean. On screen as Bianca at `/settings/google`: the "Team calendar · Not created yet" card under the connect card, desk and phone screenshots.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/google/page.tsx src/components/setup-banner.tsx
git commit -m "feat(setup): admin grant asks the Calendar scope, runs the sync, shows the team calendar"
```

---

### Task 7: Reps board pings the sync; the day panel assigns a rep

**Files:**
- Modify: `src/app/reps/page.tsx` (sync on load → `bump`)
- Modify: `src/components/agenda-calendar.tsx` (assign select in the day panel for managers)

**Interfaces:**
- Consumes: `POST /api/calendar/team/sync` (Task 5); `AgendaCalendar` props `bump`, `owner` (existing).

- [ ] **Step 1: The board asks for a sync when it opens**

In `src/app/reps/page.tsx`, add state `const [calBump, setCalBump] = useState(0);` and, inside the existing `useEffect` that calls `load()` (or a new one beside it):
```ts
  // THE WEEK IS AS FRESH AS GOOGLE (spec 2026-10-12): opening the board asks
  // the server to reconcile the team calendar, then re-reads the grid. Fire
  // and forget — a 501 before the owner connected is silence, not an error.
  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      void fetch("/api/calendar/team/sync", { method: "POST" })
        .then((r) => {
          if (!stale && r.ok) setCalBump((b) => b + 1);
        })
        .catch(() => undefined);
    }, 0);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, []);
```
and pass `bump={calBump}` to `<AgendaCalendar>` instead of `bump={0}`.

- [ ] **Step 2: Assigning a rep in the day panel**

In `src/components/agenda-calendar.tsx`:
- Add `import { manages } from "@/lib/domain/roles";` and read `const { profile } = useOffline();` (the file already imports `useOffline`? If not: `import { useOffline } from "@/components/offline-provider";`).
- Add a memo of assignable reps from `repNames` (every active membership; the admin who owns Google-born visits is in it too, so "back to Bianca" is possible):
```ts
  const assignable = useMemo(
    () => [...repNames.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [repNames],
  );
```
- Add the handler:
```ts
  // HANDING A VISIT TO A REP (spec 2026-10-12): a visit born in Google is the
  // calendar owner's until a manager says whose it is. The owner changes
  // here; the rep label on the Google event follows on the next sync.
  async function assign(r: CalRow, ownerId: string) {
    const { error } = await getSupabaseBrowserClient()
      .from("next_actions")
      .update({ owner_id: ownerId })
      .eq("id", r.id);
    if (error) {
      onError(error.message);
      return;
    }
    setRows((rows) => rows.map((x) => (x.id === r.id ? { ...x, owner_id: ownerId } : x)));
  }
```
- In the day panel's `<li>` (the `pickedRows.map`), before the Done button, render for managers on an open row:
```tsx
                  {manages(profile?.role) && !r.completed_at && (
                    <label className="t-sub flex shrink-0 items-center gap-1">
                      <span className="sr-only">Assign to</span>
                      <select
                        className="select-quiet"
                        value={r.owner_id ?? ""}
                        onChange={(e) => void assign(r, e.target.value)}
                        aria-label={`Assign ${r.action} to`}
                      >
                        {assignable.map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
```
- If `.select-quiet` does not exist in `src/app/globals.css`, add beside `.btn-quiet`:
```css
.select-quiet {
  font: inherit;
  font-size: var(--t-sub-size, 13px);
  color: inherit;
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 2px 8px;
}
```

RLS check: `next_actions` update by a manager on another member's row must be allowed by the existing policy (managers edit their chain's rows). Verify with the SQL below as Bianca's membership before trusting the control; if denied, add a policy in a migration `20261012100100_next_actions_manager_assign.sql`:
```sql
create policy next_actions_manager_assign on public.next_actions
  for update to authenticated
  using (org_id = (select private.jwt_org_id()) and (select private.is_manager_or_admin()))
  with check (org_id = (select private.jwt_org_id()));
```
(Use whatever the existing helper for "manager or admin" is called in `private`; read `20260722000400_identity.sql`.)

- [ ] **Step 3: Lint, type-check, look**

Run: `npx tsc --noEmit -p . && npx eslint src/app/reps/page.tsx src/components/agenda-calendar.tsx`
Expected: clean. On screen as Bianca at `/reps`: pick a day with a visit (plan one via "Plan a visit" if none), the row shows the select, changing it moves the chip's initials. Desk and phone screenshots.

- [ ] **Step 4: Commit**

```bash
git add src/app/reps/page.tsx src/components/agenda-calendar.tsx src/app/globals.css
git commit -m "feat(reps): the board syncs the team calendar on open; a manager hands a visit to a rep"
```

---

### Task 8: Ship — migration to production, env on Vercel, the first real sync

**Files:**
- Modify: `.env.local` (two new keys, gitignored)
- Modify: `docs/superpowers/specs/2026-10-12-team-google-calendar-design.md` (status line → shipped date)

- [ ] **Step 1: Env locally**

Read `client_secret_924757054802-sv4mh50uk1ket67u4crfmdmsf2ibmfn7.apps.googleusercontent.com.json` (repo root, gitignored) and append to `.env.local`:
```
GOOGLE_OAUTH_CLIENT_ID=<web.client_id>
GOOGLE_OAUTH_CLIENT_SECRET=<web.client_secret>
```
Restart the dev server.

- [ ] **Step 2: Env on Vercel**

The Vercel CLI is not installed and the MCP is disconnected. Andre adds the same two variables in the Vercel dashboard → Project → Settings → Environment Variables (Production + Preview), or installs the CLI (`npm i -g vercel`, `vercel link`, `vercel env add GOOGLE_OAUTH_CLIENT_ID production`, same for the secret).

- [ ] **Step 3: Migration to production**

Run: `npm run db:test` (all green), then `supabase db push`.
Expected: `20261012100000_team_calendar.sql` applied; `select count(*) from team_calendars` → 0; `rep_calendars` gone.

- [ ] **Step 4: Push and the first real sync**

```bash
git push origin main
```
Then, as Bianca (or the chosen owner) on production: `/settings/google` → Connect → consent → back on the page: "Team calendar · GMX Sales Team · Owned by Bianca Watanabe". In Google Calendar, Bianca and João see "GMX Sales Team". Plan a visit on `/reps` → it appears in Google within the minute (board sync) and on the board. Create an event by hand in Google → open `/reps` → it is on the grid under Bianca; assign it to Deonn → the Google event's title gains " · Deonn" on the next pass.

If Google answers "invalid_scope" on consent, the Calendar scope is not on the consent screen of `gmx-sales-metrics` — Brian adds it; nothing in the code changes.

- [ ] **Step 5: Record and commit**

Spec status line → `Status: shipped 2026-10-12 (commit <sha>)`. Memory file `team-google-calendar.md` updated: the per-rep projection is gone; owner, calendar id, and what remains blocked (Gmail).

```bash
git add docs/superpowers/specs/2026-10-12-team-google-calendar-design.md
git commit -m "docs(spec): team calendar shipped"
git push origin main
```
