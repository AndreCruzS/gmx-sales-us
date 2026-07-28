// One reconciliation pass for one rep's calendar (spec §6).
//
//   ensure the calendar exists (recreate if deleted out from under us)
//   ensure the readers (rep, manager, admins — never a domain-wide rule)
//   diff app-authored events against open next_actions:
//     agenda item with no event      → insert
//     event whose item changed       → update
//     event whose item is gone/done  → delete (the calendar shows the plan;
//                                      history lives in the app, D46)
//
// Idempotent by construction: next_action_id rides each event's private
// extendedProperties, so replays converge instead of duplicating.

import { humanize } from "@/lib/domain/enums";
import type {
  AgendaItemForCalendar,
  CalendarPort,
  CalendarStore,
  EventPayload,
} from "./port";

export interface CalendarSyncContext {
  repName: string;
}

export interface CalendarSyncReport {
  calendarId: string;
  created: boolean;
  inserted: number;
  updated: number;
  deleted: number;
}

function payloadFor(item: AgendaItemForCalendar): EventPayload {
  return {
    nextActionId: item.id,
    date: item.due_date,
    title: item.accountName ? `${item.action} — ${item.accountName}` : item.action,
    description: [
      item.objective ? `Purpose: ${humanize(item.objective)}` : null,
      "Planned in Commercial OS — edit it there, not here.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function syncRepCalendar(
  calendar: CalendarPort,
  store: CalendarStore,
  ctx: CalendarSyncContext,
): Promise<CalendarSyncReport> {
  // ── Ensure the calendar ───────────────────────────────────────────────────
  let calendarId = await store.getCalendarId();
  let created = false;
  if (!calendarId || !(await calendar.calendarExists(calendarId))) {
    calendarId = await calendar.createCalendar(`Commercial OS — ${ctx.repName}`);
    await store.saveCalendarId(calendarId);
    created = true;
  }

  // ── Ensure the readers ────────────────────────────────────────────────────
  // grantReader is idempotent server-side (same rule id overwrites), so
  // re-asserting on every pass also heals ACLs someone removed by hand.
  for (const email of await store.listReaderEmails()) {
    await calendar.grantReader(calendarId, email);
  }

  // ── Reconcile events against the agenda ───────────────────────────────────
  const [existing, open] = await Promise.all([
    calendar.listProjectedEvents(calendarId),
    store.listOpenNextActions(),
  ]);
  const byActionId = new Map(existing.map((e) => [e.nextActionId, e]));
  const openIds = new Set(open.map((i) => i.id));

  const report: CalendarSyncReport = {
    calendarId,
    created,
    inserted: 0,
    updated: 0,
    deleted: 0,
  };

  for (const item of open) {
    const want = payloadFor(item);
    const have = byActionId.get(item.id);
    if (!have) {
      await calendar.insertEvent(calendarId, want);
      report.inserted += 1;
    } else if (have.date !== want.date || have.title !== want.title) {
      await calendar.updateEvent(calendarId, have.eventId, want);
      report.updated += 1;
    }
  }

  for (const e of existing) {
    if (!openIds.has(e.nextActionId)) {
      await calendar.deleteEvent(calendarId, e.eventId);
      report.deleted += 1;
    }
  }

  return report;
}
