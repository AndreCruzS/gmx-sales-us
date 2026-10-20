// EACH REP'S MIRROR (Andre, 2026-10-20: João and Bianca see everyone's
// appointments on the team calendar, "but the rep CAN ONLY SEE THEIR OWN").
//
// Google cannot filter one shared calendar per viewer, so a rep is never put
// on the team calendar. Instead each active rep gets "GMX · <full name>", made
// in the same owner's account and shared with the rep to read, holding that
// rep's open visits and nothing else.
//
//   ensure the calendar: registered id, else by name, else create it
//   ensure the share: once per address, with Google's invitation e-mail
//   visits → events: missing → insert; moved/renamed → update;
//                    done, deleted or handed to someone else → the event goes
//
// ONE WAY, the app is the only author. Whoever books for the rep — Bianca in
// the app, or on the team calendar and then handed over — books where the
// visit lives; the mirror only shows it. Nothing typed into a mirror is read.
//
// One rep failing does not stop the others; errors are named per rep.

import { humanize } from "@/lib/domain/enums";
import { syncWindow } from "./team-sync";
import type { TeamCalendarPort, TeamEvent, TeamEventPayload, VisitRow } from "./team-port";

export interface MirrorRep {
  membershipId: string;
  email: string;
  fullName: string;
}

export interface MirrorStore {
  /** Active reps with an e-mail — everyone who gets a mirror. */
  listReps(): Promise<MirrorRep[]>;
  getMirror(membershipId: string): Promise<{ calendarId: string; sharedWith: string | null } | null>;
  saveMirror(membershipId: string, m: { calendarId: string; sharedWith: string | null }): Promise<void>;
  /** Open visits in the window, every owner. */
  listOpenVisits(fromDate: string, toDate: string): Promise<VisitRow[]>;
  recordMirror(membershipId: string, r: { syncedAt: string; error: string | null }): Promise<void>;
}

export interface MirrorReport {
  reps: number;
  created: number;
  shared: number;
  inserted: number;
  updated: number;
  deleted: number;
  errors: string[];
}

export function mirrorSummary(fullName: string): string {
  return `GMX · ${fullName}`;
}

/** The rep's own calendar needs no rep label: every event on it is theirs. */
export function mirrorTitle(v: Pick<VisitRow, "action" | "accountName">): string {
  return v.accountName ? `${v.action} — ${v.accountName}` : v.action;
}

function payloadFor(v: VisitRow): TeamEventPayload {
  return {
    date: v.due_date,
    title: mirrorTitle(v),
    description: [
      v.objective ? `Purpose: ${humanize(v.objective)}` : null,
      "Your GMX agenda — changes are made in Commercial OS.",
    ]
      .filter(Boolean)
      .join("\n"),
    nextActionId: v.id,
    membershipId: v.owner_id,
    pinDate: true,
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function syncRepMirrors(
  calendar: TeamCalendarPort,
  store: MirrorStore,
  today: string,
): Promise<MirrorReport> {
  const report: MirrorReport = {
    reps: 0,
    created: 0,
    shared: 0,
    inserted: 0,
    updated: 0,
    deleted: 0,
    errors: [],
  };
  const { fromDate, toDate } = syncWindow(today);
  const [reps, visits] = await Promise.all([
    store.listReps(),
    store.listOpenVisits(fromDate, toDate),
  ]);

  for (const rep of reps) {
    report.reps++;
    const before = report.errors.length;
    try {
      await mirrorOne(
        calendar,
        store,
        rep,
        visits.filter((v) => v.owner_id === rep.membershipId && v.completed_at === null),
        fromDate,
        toDate,
        report,
      );
    } catch (err) {
      report.errors.push(`${rep.email}: ${message(err)}`);
    }
    const mine = report.errors.slice(before);
    await store.recordMirror(rep.membershipId, {
      syncedAt: new Date().toISOString(),
      error: mine.length > 0 ? mine.join("; ") : null,
    });
  }
  return report;
}

async function mirrorOne(
  calendar: TeamCalendarPort,
  store: MirrorStore,
  rep: MirrorRep,
  visits: VisitRow[],
  fromDate: string,
  toDate: string,
  report: MirrorReport,
): Promise<void> {
  // ── Ensure the calendar ───────────────────────────────────────────────────
  const saved = await store.getMirror(rep.membershipId);
  let calendarId = saved?.calendarId ?? null;
  let sharedWith = saved?.sharedWith ?? null;
  if (calendarId && !(await calendar.calendarExists(calendarId))) {
    calendarId = null;
    sharedWith = null;
  }
  if (!calendarId) {
    const summary = mirrorSummary(rep.fullName);
    calendarId = await calendar.findCalendarByName(summary);
    if (!calendarId) {
      calendarId = await calendar.createCalendar(summary);
      report.created++;
    }
    sharedWith = null;
    await store.saveMirror(rep.membershipId, { calendarId, sharedWith });
  }

  // ── Ensure the share, once per address ────────────────────────────────────
  if (sharedWith !== rep.email) {
    await calendar.grantReader(calendarId, rep.email);
    await store.saveMirror(rep.membershipId, { calendarId, sharedWith: rep.email });
    report.shared++;
  }

  // ── Visits → events ───────────────────────────────────────────────────────
  const events = (await calendar.listEvents(calendarId, fromDate, toDate)).filter(
    (e) => !e.cancelled,
  );
  const byVisit = new Map<string, TeamEvent>();
  const extra: TeamEvent[] = [];
  for (const e of events) {
    if (e.nextActionId === null) continue; // not ours; a mirror reads nothing
    if (byVisit.has(e.nextActionId)) extra.push(e); // a ghost: show the plan once
    else byVisit.set(e.nextActionId, e);
  }

  const wanted = new Set<string>();
  for (const v of visits) {
    wanted.add(v.id);
    try {
      const want = payloadFor(v);
      const ev = byVisit.get(v.id);
      if (!ev) {
        await calendar.insertEvent(calendarId, want);
        report.inserted++;
      } else if (ev.date !== want.date || ev.title !== want.title) {
        await calendar.updateEvent(calendarId, ev.eventId, want);
        report.updated++;
      }
    } catch (err) {
      report.errors.push(`${rep.email} ${v.id}: ${message(err)}`);
    }
  }

  for (const e of [...extra, ...[...byVisit.values()].filter((e) => !wanted.has(e.nextActionId!))]) {
    try {
      await calendar.deleteEvent(calendarId, e.eventId);
      report.deleted++;
    } catch (err) {
      report.errors.push(`${rep.email} ${e.eventId}: ${message(err)}`);
    }
  }
}
