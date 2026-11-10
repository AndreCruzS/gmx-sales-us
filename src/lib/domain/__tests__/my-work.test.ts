import { describe, expect, it } from "vitest";
import type { CachedAgendaItem } from "@/lib/offline/types";
import { boxOf, countBoxes, givers, groupForPage, shortDate } from "@/lib/domain/my-work";

const ME = "m-andre";
const BIANCA = "m-bianca";
const TODAY = "2026-11-10"; // a Tuesday
const NOW = "2026-11-10T15:00:00.000Z";

function item(over: Partial<CachedAgendaItem>): CachedAgendaItem {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    action: "Follow up",
    due_date: TODAY,
    completed_at: null,
    account_id: null,
    opportunity_id: null,
    objective: null,
    kind: "OTHER",
    owner_id: ME,
    priority: null,
    important: null,
    entered_by: ME,
    entered_by_name: null,
    source_type: null,
    created_at: "2026-11-01T12:00:00.000Z",
    updated_at: "2026-11-01T12:00:00.000Z",
    ...over,
  };
}

// The Done-means data of the spec (2026-11-10).
const lezzer = item({
  id: "lezzer",
  action: "Send render to Lezzer Lumber Butler",
  due_date: "2026-11-11",
  entered_by: BIANCA,
  entered_by_name: "Bianca Silva",
  created_at: "2026-11-10T13:00:00.000Z",
});
const dykes = item({
  id: "dykes",
  action: "Send render to Dykes Lumber Brooklyn",
  due_date: "2026-11-13",
  entered_by: BIANCA,
  entered_by_name: "Bianca Silva",
  created_at: "2026-11-10T13:05:00.000Z",
});
const anaheim = item({ id: "anaheim", action: "Visit", kind: "VISIT", due_date: "2026-10-22" });
const costaMesa = item({
  id: "costa-mesa",
  action: "Merchandising check visit",
  kind: "VISIT",
  due_date: "2026-10-27",
});
const DONE_MEANS = [lezzer, dykes, anaheim, costaMesa];

describe("boxOf", () => {
  it("an item nobody classified is No priority", () => {
    expect(boxOf(lezzer, TODAY, false)).toBe("NONE");
    expect(boxOf(dykes, TODAY, false)).toBe("NONE");
  });

  it("visits, calls and meetings are Scheduled whatever the priority", () => {
    expect(boxOf(anaheim, TODAY, false)).toBe("SCHEDULED");
    expect(boxOf(item({ kind: "CALL", priority: "DO_NOW", important: true }), TODAY, false)).toBe("SCHEDULED");
    expect(boxOf(item({ kind: "MEETING" }), TODAY, false)).toBe("SCHEDULED");
  });

  it("closed and eliminated items count nowhere", () => {
    expect(boxOf(item({ completed_at: NOW }), TODAY, false)).toBeNull();
    expect(boxOf(item({ priority: "ELIMINATE", important: false }), TODAY, false)).toBeNull();
  });

  it("the deadline decides: important and urgent is Do now, important and later is Plan", () => {
    expect(boxOf(item({ important: true, due_date: "2026-11-12" }), TODAY, false)).toBe("DO_NOW");
    expect(boxOf(item({ important: true, due_date: "2026-11-20" }), TODAY, false)).toBe("PLAN");
  });

  it("a rep-owned stored DELEGATE counts under Plan", () => {
    expect(
      boxOf(item({ important: false, priority: "DELEGATE", due_date: "2026-11-11" }), TODAY, false),
    ).toBe("PLAN");
  });

  it("not important and not urgent stays open (Eliminate is only a suggestion) under Plan", () => {
    expect(
      boxOf(item({ important: false, priority: "PLAN", due_date: "2026-12-01" }), TODAY, false),
    ).toBe("PLAN");
  });

  it("a cached row without important reads it from the stored priority", () => {
    expect(boxOf(item({ important: undefined, priority: "DO_NOW", due_date: "2026-11-20" }), TODAY, false)).toBe("PLAN");
    expect(boxOf(item({ important: undefined, priority: "PLAN", due_date: "2026-11-10" }), TODAY, false)).toBe("DO_NOW");
  });

  it("a null kind counts as a task", () => {
    expect(boxOf(item({ kind: null }), TODAY, false)).toBe("NONE");
  });
});

describe("countBoxes", () => {
  it("the Done-means case: two No priority, two Scheduled both overdue", () => {
    const c = countBoxes(DONE_MEANS, ME, TODAY, false);
    expect(c.NONE.n).toBe(2);
    expect(c.SCHEDULED).toEqual({ n: 2, late: 2, soon: 0, next: null });
    expect(c.DO_NOW.n).toBe(0);
    expect(c.PLAN.n).toBe(0);
    expect(c.NONE.next).toBe("2026-11-11");
  });

  it("keeps only the signed-in owner's items", () => {
    const theirs = item({ owner_id: BIANCA, important: true });
    const c = countBoxes([...DONE_MEANS, theirs], ME, TODAY, false);
    expect(c.DO_NOW.n).toBe(0);
    expect(c.NONE.n).toBe(2);
  });

  it("counts late, due within 2 business days and the next date", () => {
    const c = countBoxes(
      [
        item({ important: true, due_date: "2026-11-09" }),
        item({ important: true, due_date: "2026-11-10" }),
        item({ important: true, due_date: "2026-11-12" }),
      ],
      ME,
      TODAY,
      false,
    );
    expect(c.DO_NOW).toEqual({ n: 3, late: 1, soon: 2, next: "2026-11-10" });
  });
});

describe("givers", () => {
  it("the Done-means banner: Bianca gave 2", () => {
    expect(givers(DONE_MEANS, ME, null, NOW)).toEqual({ names: ["Bianca"], n: 2 });
  });

  it("nothing after the page was seen", () => {
    expect(givers(DONE_MEANS, ME, "2026-11-10T14:00:00.000Z", NOW)).toEqual({ names: [], n: 0 });
  });

  it("before the first visit only the last 7 days count", () => {
    const old = item({ entered_by: BIANCA, entered_by_name: "Bianca", created_at: "2026-11-01T12:00:00.000Z" });
    expect(givers([old], ME, null, NOW).n).toBe(0);
  });

  it("own, imported (null) and closed items never count; most items first", () => {
    const joao = item({ entered_by: "m-joao", entered_by_name: "João Pedro", created_at: NOW });
    const imported = item({ entered_by: null, created_at: NOW });
    const closed = item({ entered_by: BIANCA, created_at: NOW, completed_at: NOW });
    const r = givers([lezzer, dykes, joao, imported, closed, item({ created_at: NOW })], ME, null, NOW);
    expect(r).toEqual({ names: ["Bianca", "João"], n: 3 });
  });
});

describe("groupForPage", () => {
  const FRIDAY = "2026-11-13";
  const rows = [
    item({ id: "thu", important: true, due_date: "2026-11-12" }),
    item({ id: "fri", important: true, due_date: FRIDAY }),
    item({ id: "sat", important: true, due_date: "2026-11-14" }),
    item({ id: "mon", important: true, due_date: "2026-11-16" }),
    item({ id: "tue", important: true, due_date: "2026-11-17" }),
    item({ id: "wed", important: true, due_date: "2026-11-18" }),
  ];

  it("on a Friday, Monday and Tuesday are the next 2 business days", () => {
    const g = groupForPage(rows, "ALL", { me: ME, today: FRIDAY, gives: false, seenAt: null, now: NOW });
    expect(g.map((x) => [x.key, x.items.map((i) => i.id)])).toEqual([
      ["LATE", ["thu"]],
      ["TODAY", ["fri"]],
      ["SOON", ["sat", "mon", "tue"]],
      ["LATER", ["wed"]],
    ]);
  });

  it("filters to one box and drops empty groups", () => {
    const g = groupForPage(DONE_MEANS, "SCHEDULED", { me: ME, today: TODAY, gives: false, seenAt: null, now: NOW });
    expect(g).toHaveLength(1);
    expect(g[0].key).toBe("LATE");
    expect(g[0].items.map((i) => i.id)).toEqual(["anaheim", "costa-mesa"]);
  });

  it("New lists only what someone else gave since the page was last seen", () => {
    const g = groupForPage(DONE_MEANS, "NEW", { me: ME, today: TODAY, gives: false, seenAt: null, now: NOW });
    expect(g.flatMap((x) => x.items.map((i) => i.id))).toEqual(["lezzer", "dykes"]);
  });

  it("orders by date, then time, inside a group", () => {
    const g = groupForPage(
      [
        item({ id: "b", kind: "CALL", due_date: "2026-11-20", due_time: "14:00" }),
        item({ id: "a", kind: "CALL", due_date: "2026-11-20", due_time: "09:30" }),
        item({ id: "c", kind: "CALL", due_date: "2026-11-19" }),
      ],
      "ALL",
      { me: ME, today: TODAY, gives: false, seenAt: null, now: NOW },
    );
    expect(g[0].items.map((i) => i.id)).toEqual(["c", "a", "b"]);
  });
});

describe("shortDate", () => {
  it("reads like the mockup", () => {
    expect(shortDate("2026-11-17")).toBe("Nov 17");
  });
});
