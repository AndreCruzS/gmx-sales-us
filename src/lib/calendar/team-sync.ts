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
    // Tagged events belong to a row — present, or gone from the window
    // (completed, deleted in the app). Either way they are not new.
    if (e.nextActionId) continue;
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
