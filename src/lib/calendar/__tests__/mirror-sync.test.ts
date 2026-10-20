// Each rep's mirror, proven with fakes: a rep gets "GMX · <name>" shared to
// read, holds their own open visits and nobody else's, follows the app when a
// visit moves, is done or changes hands, and a replay changes nothing.

import { beforeEach, describe, expect, it } from "vitest";
import type { VisitRow } from "../team-port";
import { mirrorSummary, mirrorTitle, syncRepMirrors, type MirrorRep, type MirrorStore } from "../mirror-sync";
import { FakeCalendar } from "./fake-calendar";

const TODAY = "2026-10-20";

class FakeMirrorStore implements MirrorStore {
  reps: MirrorRep[] = [
    { membershipId: "m-deonn", email: "deonn.deford@gmxgroup.com", fullName: "Deonn Deford" },
    { membershipId: "m-jason", email: "jason.benford@gmxgroup.com", fullName: "Jason Benford" },
  ];
  mirrors = new Map<string, { calendarId: string; sharedWith: string | null }>();
  visits: VisitRow[] = [];
  results = new Map<string, string | null>();
  async listReps() {
    return this.reps;
  }
  async getMirror(id: string) {
    return this.mirrors.get(id) ?? null;
  }
  async saveMirror(id: string, m: { calendarId: string; sharedWith: string | null }) {
    this.mirrors.set(id, { ...m });
  }
  async listOpenVisits(from: string, to: string) {
    return this.visits.filter((v) => v.completed_at === null && v.due_date >= from && v.due_date <= to);
  }
  async recordMirror(id: string, r: { syncedAt: string; error: string | null }) {
    this.results.set(id, r.error);
  }
}

function visit(over: Partial<VisitRow> & { id: string; owner_id: string }): VisitRow {
  return {
    action: "Visit",
    due_date: "2026-10-22",
    completed_at: null,
    objective: null,
    calendar_event_id: null,
    calendar_origin: "app",
    accountName: "Ganahl Anaheim",
    ownerFirstName: "Deonn",
    ...over,
  };
}

let cal: FakeCalendar;
let store: FakeMirrorStore;

function mirrorOf(id: string) {
  return cal.events.get(store.mirrors.get(id)!.calendarId)!;
}

beforeEach(() => {
  cal = new FakeCalendar();
  store = new FakeMirrorStore();
  store.visits = [
    visit({ id: "v1", owner_id: "m-deonn" }),
    visit({ id: "v2", owner_id: "m-deonn", due_date: "2026-10-24", accountName: null, action: "Ride-along" }),
    visit({ id: "v3", owner_id: "m-jason", accountName: "Truckee Tahoe Lumber", ownerFirstName: "Jason" }),
  ];
});

describe("each rep's calendar", () => {
  it("is made under the rep's name and shared with the rep to read", async () => {
    const r = await syncRepMirrors(cal, store, TODAY);
    expect(r.created).toBe(2);
    const id = store.mirrors.get("m-deonn")!.calendarId;
    expect(cal.calendars.get(id)).toBe(mirrorSummary("Deonn Deford"));
    expect(cal.calendars.get(id)).toBe("GMX · Deonn Deford");
    expect(cal.acls.get(id)!.get("deonn.deford@gmxgroup.com")).toBe("reader");
  });

  it("is shared once, not on every pass", async () => {
    await syncRepMirrors(cal, store, TODAY);
    const r = await syncRepMirrors(cal, store, TODAY);
    expect(r.shared).toBe(0);
  });

  it("is found by name when the registration was lost", async () => {
    await syncRepMirrors(cal, store, TODAY);
    const id = store.mirrors.get("m-deonn")!.calendarId;
    store.mirrors.clear();
    const r = await syncRepMirrors(cal, store, TODAY);
    expect(r.created).toBe(0);
    expect(store.mirrors.get("m-deonn")!.calendarId).toBe(id);
  });

  it("is made again when somebody deleted it in Google", async () => {
    await syncRepMirrors(cal, store, TODAY);
    cal.calendars.delete(store.mirrors.get("m-deonn")!.calendarId);
    const r = await syncRepMirrors(cal, store, TODAY);
    expect(r.created).toBe(1);
    expect(mirrorOf("m-deonn")).toHaveLength(2);
  });
});

describe("what a rep sees", () => {
  it("their own open visits and nobody else's", async () => {
    await syncRepMirrors(cal, store, TODAY);
    expect(mirrorOf("m-deonn").map((e) => e.nextActionId).sort()).toEqual(["v1", "v2"]);
    expect(mirrorOf("m-jason").map((e) => e.nextActionId)).toEqual(["v3"]);
  });

  it("titled without a rep label — every event on it is theirs", async () => {
    await syncRepMirrors(cal, store, TODAY);
    const titles = mirrorOf("m-deonn").map((e) => e.title).sort();
    expect(titles).toEqual(["Ride-along", "Visit — Ganahl Anaheim"]);
    expect(mirrorTitle({ action: "Visit", accountName: "X" })).toBe("Visit — X");
  });

  it("a moved visit moves", async () => {
    await syncRepMirrors(cal, store, TODAY);
    store.visits[0].due_date = "2026-10-29";
    const r = await syncRepMirrors(cal, store, TODAY);
    expect(r.updated).toBe(1);
    expect(mirrorOf("m-deonn").find((e) => e.nextActionId === "v1")!.date).toBe("2026-10-29");
  });

  it("a done visit leaves the calendar", async () => {
    await syncRepMirrors(cal, store, TODAY);
    store.visits[0].completed_at = "2026-10-22T18:00:00Z";
    const r = await syncRepMirrors(cal, store, TODAY);
    expect(r.deleted).toBe(1);
    expect(mirrorOf("m-deonn").map((e) => e.nextActionId)).toEqual(["v2"]);
  });

  it("a visit handed to another rep leaves one calendar for the other", async () => {
    await syncRepMirrors(cal, store, TODAY);
    store.visits[0].owner_id = "m-jason";
    await syncRepMirrors(cal, store, TODAY);
    expect(mirrorOf("m-deonn").map((e) => e.nextActionId)).toEqual(["v2"]);
    expect(mirrorOf("m-jason").map((e) => e.nextActionId).sort()).toEqual(["v1", "v3"]);
  });

  it("a deleted visit leaves too", async () => {
    await syncRepMirrors(cal, store, TODAY);
    store.visits = store.visits.filter((v) => v.id !== "v2");
    await syncRepMirrors(cal, store, TODAY);
    expect(mirrorOf("m-deonn").map((e) => e.nextActionId)).toEqual(["v1"]);
  });
});

describe("the mirror is one way", () => {
  it("an event typed into a mirror is left alone and never becomes a visit", async () => {
    await syncRepMirrors(cal, store, TODAY);
    const id = store.mirrors.get("m-deonn")!.calendarId;
    cal.handMade(id, "2026-10-23", "Dentist");
    await syncRepMirrors(cal, store, TODAY);
    expect(store.visits).toHaveLength(3);
    expect(mirrorOf("m-deonn").some((e) => e.title === "Dentist")).toBe(true);
  });

  it("a ghost — a second event for one visit — is removed", async () => {
    await syncRepMirrors(cal, store, TODAY);
    const id = store.mirrors.get("m-deonn")!.calendarId;
    await cal.insertEvent(id, {
      date: "2026-10-22",
      title: "Visit — Ganahl Anaheim",
      description: "",
      nextActionId: "v1",
      membershipId: "m-deonn",
      pinDate: true,
    });
    await syncRepMirrors(cal, store, TODAY);
    expect(mirrorOf("m-deonn").filter((e) => e.nextActionId === "v1")).toHaveLength(1);
  });

  it("a replay changes nothing", async () => {
    await syncRepMirrors(cal, store, TODAY);
    const r = await syncRepMirrors(cal, store, TODAY);
    expect([r.created, r.shared, r.inserted, r.updated, r.deleted]).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("one rep failing", () => {
  it("does not stop the others, and is named on that rep's row", async () => {
    const real = cal.grantReader.bind(cal);
    cal.grantReader = async (id, email) => {
      if (email.startsWith("deonn")) throw new Error("acl.insert 403: external sharing is off");
      return real(id, email);
    };
    const r = await syncRepMirrors(cal, store, TODAY);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("deonn.deford@gmxgroup.com");
    expect(store.results.get("m-deonn")).toContain("403");
    expect(store.results.get("m-jason")).toBeNull();
    expect(mirrorOf("m-jason")).toHaveLength(1);
  });
});
