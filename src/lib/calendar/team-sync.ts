// ONE RECONCILIATION PASS over the team calendar (spec 2026-10-12).
//
//   ensure the calendar: registered id, else by name, else create it
//   ensure the shares: every active admin as writer (re-asserted each pass)
//   app → Google: open visits become events; moved/reassigned → update;
//                 completed → the event goes (history lives in the app, D46)
//   Google → app: a hand-made event becomes a visit owned by the calendar's
//                 owner; Google's later edits follow; a cancelled event
//                 removes the visit; a tagged event whose visit is gone goes
//
// WHO WINS is where the row was born, never a clock: an app-born visit is
// edited in the app (a Google edit is overwritten, a Google delete is
// undone), a Google-born one in Google (its date and title are read, not
// written — except the rep label, which the app owns on every event).
//
// ONE BAD EVENT DOES NOT STOP THE PASS (review, 2026-10-12): each visit and
// each event is its own try; what failed is named in `errors` and written
// to last_error, and everything else still syncs. Only the calendar itself
// failing — no token, no calendar — aborts.
//
// Idempotent by construction: next_action_id rides each event's private
// properties, so a replay converges instead of duplicating. The route holds
// a lease so two passes never run at once; this core also tolerates a ghost
// (a second event claiming a visit) by deleting it.

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
  /** "<visit or event id>: <what Google or the store said>", one per failure. */
  errors: string[];
}

const DAY_MS = 86_400_000;

function shift(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** 60 days back, a year ahead: what the board can show and the admin can plan. */
export function syncWindow(today: string): { fromDate: string; toDate: string } {
  return { fromDate: shift(today, -60), toDate: shift(today, 365) };
}

export function eventTitle(
  v: Pick<VisitRow, "action" | "accountName" | "ownerFirstName">,
): string {
  return v.accountName
    ? `${v.action} — ${v.accountName} · ${v.ownerFirstName}`
    : `${v.action} · ${v.ownerFirstName}`;
}

function payloadFor(v: VisitRow): TeamEventPayload {
  const born = v.calendar_origin === "google";
  return {
    date: v.due_date,
    // A Google-born event keeps Google's own title; only the rep label is ours.
    title: born ? `${v.action} · ${v.ownerFirstName}` : eventTitle(v),
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

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function syncTeamCalendar(
  calendar: TeamCalendarPort,
  store: TeamCalendarStore,
  today: string,
): Promise<TeamSyncReport> {
  try {
    const report = await pass(calendar, store, today);
    await store.recordResult({
      syncedAt: new Date().toISOString(),
      error: report.errors.length > 0 ? report.errors.join("; ") : null,
    });
    return report;
  } catch (err) {
    await store.recordResult({ syncedAt: new Date().toISOString(), error: message(err) });
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

  const report: TeamSyncReport = {
    calendarId,
    created,
    shared: 0,
    inserted: 0,
    updated: 0,
    deleted: 0,
    imported: 0,
    importedUpdated: 0,
    importedDeleted: 0,
    errors: [],
  };

  // ── Ensure the shares ─────────────────────────────────────────────────────
  for (const email of await store.listAdminEmails()) {
    try {
      await calendar.grantWriter(calendarId, email);
      report.shared++;
    } catch (err) {
      report.errors.push(`${email}: ${message(err)}`);
    }
  }

  // ── Read both sides ───────────────────────────────────────────────────────
  const { fromDate, toDate } = syncWindow(today);
  const [visits, events] = await Promise.all([
    store.listVisits(fromDate, toDate),
    calendar.listEvents(calendarId, fromDate, toDate),
  ]);
  // One entry per event id: a page overlap or a replayed listing must not
  // become a second import.
  const eventById = new Map<string, TeamEvent>();
  for (const e of events) if (!eventById.has(e.eventId)) eventById.set(e.eventId, e);
  const visitById = new Map(visits.map((v) => [v.id, v] as const));

  // ── App → Google ──────────────────────────────────────────────────────────
  for (const v of visits) {
    try {
      await reconcileVisit(calendar, store, calendarId, v, eventById, report);
    } catch (err) {
      report.errors.push(`${v.id}: ${message(err)}`);
    }
  }

  // ── Google → app ──────────────────────────────────────────────────────────
  const ownerId = await store.ownerMembershipId();
  // Tagged events whose visit the window did not return: look the rows up
  // once, then decide each — deleted, completed, a duplicate, or just moved.
  const strays = [...eventById.values()].filter(
    (e) => !e.cancelled && e.nextActionId !== null && !visitById.has(e.nextActionId),
  );
  const known =
    strays.length > 0
      ? await store.lookupVisits([...new Set(strays.map((e) => e.nextActionId as string))])
      : new Map<string, { calendar_event_id: string | null; completed_at: string | null }>();

  for (const e of eventById.values()) {
    if (e.cancelled) continue;
    try {
      if (e.nextActionId) {
        const inWindow = visitById.get(e.nextActionId);
        if (inWindow) {
          // The visit is here and reconciled above. A second event claiming
          // it is a ghost — two passes once overlapped, or a tag landed
          // after the insert failed — and the calendar shows the plan once.
          if (inWindow.calendar_event_id !== null && inWindow.calendar_event_id !== e.eventId) {
            await calendar.deleteEvent(calendarId, e.eventId);
            report.deleted++;
          }
          continue;
        }
        const row = known.get(e.nextActionId);
        // Row gone, or done, or holding a different event: this one is a
        // leftover and the calendar shows the plan. Row present with this
        // very event → the visit moved out of the window; leave it.
        if (!row || row.completed_at || row.calendar_event_id !== e.eventId) {
          await calendar.deleteEvent(calendarId, e.eventId);
          report.deleted++;
        }
        continue;
      }
      // A hand-made event. Yesterday's lunch is not a visit somebody still
      // owes: only today and onward become open rows (review, 2026-10-12).
      if (e.date < today) continue;
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
    } catch (err) {
      report.errors.push(`${e.eventId}: ${message(err)}`);
    }
  }

  return report;
}

async function reconcileVisit(
  calendar: TeamCalendarPort,
  store: TeamCalendarStore,
  calendarId: string,
  v: VisitRow,
  eventById: Map<string, TeamEvent>,
  report: TeamSyncReport,
): Promise<void> {
  const ev = v.calendar_event_id ? eventById.get(v.calendar_event_id) : undefined;
  const live = ev && !ev.cancelled ? ev : undefined;

  if (v.completed_at) {
    // Completion wins on both origins: the calendar shows the plan.
    if (live) {
      await calendar.deleteEvent(calendarId, live.eventId);
      report.deleted++;
    }
    if (v.calendar_event_id) await store.clearProjection(v.id);
    return;
  }

  if (v.calendar_origin === "google") {
    if (!live) {
      // Its event is gone or cancelled in Google: Google owns it.
      await store.deleteImported(v.id);
      report.importedDeleted++;
      return;
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
    return;
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
