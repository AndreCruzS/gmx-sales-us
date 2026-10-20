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
// IN THE REP'S OWN CALENDAR WHEN THEY LET US (Andre, 2026-10-20: "se eu
// permiti o meu calendar na plataforma ... usar a minha conta pra fazer como
// eu tivesse criado e não precisar de aceite"). A shared calendar from another
// domain waits for the rep to accept it. A rep who connected Google gave the
// app their events permission, so for them the visits are written straight
// into their PRIMARY calendar — "GMX · " in the title, the app's colour, a
// private tag on each — and only tagged events are ever listed, touched or
// removed there. The shared calendar is the fallback for a rep who has not
// connected, and is deleted the day they do, so a visit never shows twice.
//
// One rep failing does not stop the others; errors are named per rep.

import { humanize } from "@/lib/domain/enums";
import { syncWindow } from "./team-sync";
import type { TeamCalendarPort, TeamEvent, TeamEventPayload, VisitRow } from "./team-port";

export interface MirrorRep {
  membershipId: string;
  email: string;
  fullName: string;
  /** The rep's own Google refresh token when it can write events; else null. */
  ownGrant: string | null;
}

/** The registered id that means "the rep's own primary calendar". */
export const OWN_CALENDAR = "primary";

/** Opens a port onto a rep's own Google account, from their grant. */
export type OwnCalendarFactory = (refreshToken: string) => TeamCalendarPort;

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
  /** Reps written straight into their own primary calendar. */
  own: number;
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

/** The rep's own calendar needs no rep label: every event on it is theirs.
 *  In their primary calendar it wears "GMX · ", beside their own events. */
export function mirrorTitle(v: Pick<VisitRow, "action" | "accountName">, own = false): string {
  const t = v.accountName ? `${v.action} — ${v.accountName}` : v.action;
  return own ? `GMX · ${t}` : t;
}

function payloadFor(v: VisitRow, own: boolean): TeamEventPayload {
  return {
    date: v.due_date,
    title: mirrorTitle(v, own),
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
  ownCalendar?: OwnCalendarFactory,
): Promise<MirrorReport> {
  const report: MirrorReport = {
    reps: 0,
    own: 0,
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
        ownCalendar,
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
  ownCalendar: OwnCalendarFactory | undefined,
  store: MirrorStore,
  rep: MirrorRep,
  visits: VisitRow[],
  fromDate: string,
  toDate: string,
  report: MirrorReport,
): Promise<void> {
  const saved = await store.getMirror(rep.membershipId);

  // ── The rep's own calendar, when they gave us their grant ────────────────
  if (rep.ownGrant && ownCalendar) {
    // The shared copy goes first: two calendars showing one visit is the
    // one thing this must never do.
    if (saved && saved.calendarId !== OWN_CALENDAR) {
      await calendar.deleteCalendar(saved.calendarId);
    }
    if (!saved || saved.calendarId !== OWN_CALENDAR) {
      await store.saveMirror(rep.membershipId, { calendarId: OWN_CALENDAR, sharedWith: null });
    }
    report.own++;
    await project(ownCalendar(rep.ownGrant), OWN_CALENDAR, true, rep, visits, fromDate, toDate, report);
    return;
  }

  // ── Else the shared calendar in the owner's account ─────────────────────
  // A row left by the own mode names the rep's primary, which in the owner's
  // account would be the OWNER's primary: it is not ours to reuse.
  let calendarId = saved && saved.calendarId !== OWN_CALENDAR ? saved.calendarId : null;
  let sharedWith = calendarId ? (saved?.sharedWith ?? null) : null;
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

  await project(calendar, calendarId, false, rep, visits, fromDate, toDate, report);
}

/** Visits → events on one calendar: insert, update, and remove what is ours. */
async function project(
  calendar: TeamCalendarPort,
  calendarId: string,
  own: boolean,
  rep: MirrorRep,
  visits: VisitRow[],
  fromDate: string,
  toDate: string,
  report: MirrorReport,
): Promise<void> {
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
      const want = payloadFor(v, own);
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
