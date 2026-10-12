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
    Object.assign(ev, {
      date: e.date,
      title: e.title,
      nextActionId: e.nextActionId,
      membershipId: e.membershipId,
    });
  }
  async deleteEvent(id: string, eventId: string) {
    this.events.set(
      id,
      this.events.get(id)!.filter((x) => x.eventId !== eventId),
    );
  }
  /** Test helper: an event somebody typed into Google by hand. */
  handMade(id: string, date: string, title: string) {
    const eventId = `ev-${++this.seq}`;
    this.events.get(id)!.push({
      eventId,
      date,
      title,
      nextActionId: null,
      membershipId: null,
      cancelled: false,
    });
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
      (v) =>
        v.due_date >= from &&
        v.due_date <= to &&
        (v.completed_at === null || v.calendar_event_id !== null),
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
    expect(
      eventTitle({ action: "Visit", accountName: "Ganahl Lumber", ownerFirstName: "Deonn" }),
    ).toBe("Visit — Ganahl Lumber · Deonn");
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
    expect(cal.events.get(id)![0]).toMatchObject({
      nextActionId: store.visits[0].id,
      membershipId: OWNER,
    });
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
    expect(store.visits[0]).toMatchObject({
      due_date: "2026-10-22",
      action: "Salt Lake follow-up (moved)",
    });
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
    expect(cal.events.get(id)![0]).toMatchObject({
      membershipId: "m-deonn",
      title: "Salt Lake follow-up · Deonn",
    });
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
    expect(r).toMatchObject({
      inserted: 0,
      updated: 0,
      deleted: 0,
      imported: 0,
      importedUpdated: 0,
      importedDeleted: 0,
    });
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
