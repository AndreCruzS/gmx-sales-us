// The §6 reconciliation, proven with fakes: projection converges, replays
// don't duplicate, completion clears the calendar, ACLs re-assert.

import { beforeEach, describe, expect, it } from "vitest";
import type {
  AgendaItemForCalendar,
  CalendarPort,
  CalendarStore,
  EventPayload,
  ProjectedEvent,
} from "../port";
import { syncRepCalendar } from "../sync-core";

const CTX = { repName: "Deon Rep" };

class FakeCalendar implements CalendarPort {
  calendars = new Map<string, string>(); // id → summary
  acls = new Map<string, Set<string>>();
  events = new Map<string, ProjectedEvent[]>();
  private seq = 0;

  async createCalendar(summary: string) {
    const id = `cal-${++this.seq}`;
    this.calendars.set(id, summary);
    this.acls.set(id, new Set());
    this.events.set(id, []);
    return id;
  }
  async calendarExists(id: string) {
    return this.calendars.has(id);
  }
  async grantReader(id: string, email: string) {
    this.acls.get(id)?.add(email);
  }
  async listProjectedEvents(id: string) {
    return [...(this.events.get(id) ?? [])];
  }
  async insertEvent(id: string, e: EventPayload) {
    this.events.get(id)?.push({
      eventId: `ev-${++this.seq}`,
      nextActionId: e.nextActionId,
      date: e.date,
      title: e.title,
    });
  }
  async updateEvent(id: string, eventId: string, e: EventPayload) {
    const list = this.events.get(id) ?? [];
    const ev = list.find((x) => x.eventId === eventId);
    if (ev) {
      ev.date = e.date;
      ev.title = e.title;
    }
  }
  async deleteEvent(id: string, eventId: string) {
    this.events.set(
      id,
      (this.events.get(id) ?? []).filter((x) => x.eventId !== eventId),
    );
  }
}

class FakeStore implements CalendarStore {
  calendarId: string | null = null;
  open: AgendaItemForCalendar[] = [];
  readers = ["deon@gmxgroup.com", "joao@gmxgroup.com", "bianca@gmxgroup.com"];

  async getCalendarId() {
    return this.calendarId;
  }
  async saveCalendarId(id: string) {
    this.calendarId = id;
  }
  async listOpenNextActions() {
    return this.open;
  }
  async listReaderEmails() {
    return this.readers;
  }
}

const item = (over: Partial<AgendaItemForCalendar>): AgendaItemForCalendar => ({
  id: over.id ?? crypto.randomUUID(),
  action: "Store visit — verify display wall",
  due_date: "2026-07-30",
  objective: "MERCHANDISING_CHECK",
  accountName: "Ganahl Anaheim",
  ...over,
});

let cal: FakeCalendar;
let store: FakeStore;

beforeEach(() => {
  cal = new FakeCalendar();
  store = new FakeStore();
});

describe("calendar projection (spec §6)", () => {
  it("creates the rep's calendar once, names it, and grants the readers", async () => {
    store.open = [item({})];
    const r1 = await syncRepCalendar(cal, store, CTX);
    expect(r1.created).toBe(true);
    expect(cal.calendars.get(r1.calendarId)).toBe("Commercial OS — Deon Rep");
    expect([...(cal.acls.get(r1.calendarId) ?? [])]).toEqual(store.readers);

    const r2 = await syncRepCalendar(cal, store, CTX);
    expect(r2.created).toBe(false);
    expect(r2.calendarId).toBe(r1.calendarId);
  });

  it("recreates a calendar deleted out from under us", async () => {
    const r1 = await syncRepCalendar(cal, store, CTX);
    cal.calendars.delete(r1.calendarId);
    const r2 = await syncRepCalendar(cal, store, CTX);
    expect(r2.created).toBe(true);
    expect(r2.calendarId).not.toBe(r1.calendarId);
    expect(store.calendarId).toBe(r2.calendarId);
  });

  it("projects open actions as events titled action — account, and replay converges", async () => {
    store.open = [item({ id: "na-1" })];
    const r1 = await syncRepCalendar(cal, store, CTX);
    expect(r1.inserted).toBe(1);
    const events = cal.events.get(r1.calendarId)!;
    expect(events[0].title).toBe(
      "Store visit — verify display wall — Ganahl Anaheim",
    );
    expect(events[0].nextActionId).toBe("na-1");

    const r2 = await syncRepCalendar(cal, store, CTX);
    expect(r2.inserted).toBe(0);
    expect(cal.events.get(r1.calendarId)).toHaveLength(1);
  });

  it("moves the event when the due date moves", async () => {
    store.open = [item({ id: "na-1", due_date: "2026-07-30" })];
    const r1 = await syncRepCalendar(cal, store, CTX);
    store.open = [item({ id: "na-1", due_date: "2026-08-04" })];
    const r2 = await syncRepCalendar(cal, store, CTX);
    expect(r2.updated).toBe(1);
    expect(cal.events.get(r1.calendarId)![0].date).toBe("2026-08-04");
  });

  it("removes the event when the action completes — the calendar shows the plan", async () => {
    store.open = [item({ id: "na-1" }), item({ id: "na-2", action: "Send sample" })];
    const r1 = await syncRepCalendar(cal, store, CTX);
    expect(cal.events.get(r1.calendarId)).toHaveLength(2);

    store.open = store.open.filter((i) => i.id !== "na-1"); // marked done
    const r2 = await syncRepCalendar(cal, store, CTX);
    expect(r2.deleted).toBe(1);
    expect(cal.events.get(r1.calendarId)!.map((e) => e.nextActionId)).toEqual([
      "na-2",
    ]);
  });
});
