import { describe, expect, it } from "vitest";
import {
  planPatch,
  subtaskBar,
  alertBase,
  isOnUs,
  canEditItem,
  firstNameOf,
  trapTarget,
  alertDate,
  bandProgress,
  daysToAlert,
  isAlertPassed,
  isUnread,
  mirrorUpdate,
  pkDateOf,
  shownPriority,
  summarize,
  type PkBand,
  type PkItem,
  type PkNote,
  type PkRead,
  type PkSubtask,
} from "@/lib/domain/pk-follow-up";

function item(over: Partial<PkItem> = {}): PkItem {
  return {
    id: "i1",
    action: "Call back",
    owner_id: "m1",
    due_date: "2026-10-22",
    completed_at: null,
    priority: "DELEGATE",
    priority_days: 2,
    important: false,
    progress: "NOT_STARTED",
    last_changed_by: null,
    last_changed_at: null,
    updated_at: "2026-10-20T00:00:00Z",
    ...over,
  };
}

function sub(next_action_id: string, n: number, done: boolean): PkSubtask {
  return { id: `${next_action_id}-s${n}`, next_action_id, title: `s${n}`, done_at: done ? "2026-10-21T10:00:00Z" : null, position: n };
}

describe("pkDateOf", () => {
  it("returns the local calendar date of a midday timestamp", () => {
    expect(pkDateOf("2026-10-20T18:00:00Z")).toBe("2026-10-20");
  });
});

describe("alertDate", () => {
  it("adds days on the calendar", () => {
    expect(alertDate("2026-10-20", 2)).toBe("2026-10-22");
  });
  it("rolls the month", () => {
    expect(alertDate("2026-10-30", 7)).toBe("2026-11-06");
  });
});

describe("isAlertPassed / daysToAlert", () => {
  it("is true when open, prioritised and past due", () => {
    expect(isAlertPassed(item(), "2026-11-02")).toBe(true);
  });
  it("is false when due today", () => {
    expect(isAlertPassed(item({ due_date: "2026-11-02" }), "2026-11-02")).toBe(false);
  });
  it("is false for ELIMINATE, no priority or completed", () => {
    expect(isAlertPassed(item({ priority: "ELIMINATE" }), "2026-11-02")).toBe(false);
    expect(isAlertPassed(item({ priority: null }), "2026-11-02")).toBe(false);
    expect(isAlertPassed(item({ completed_at: "2026-10-23T10:00:00Z" }), "2026-11-02")).toBe(false);
  });
  it("counts days to the alert, negative when passed, null without one", () => {
    expect(daysToAlert(item(), "2026-11-02")).toBe(-11);
    expect(daysToAlert(item({ due_date: "2026-11-05" }), "2026-11-02")).toBe(3);
    expect(daysToAlert(item({ due_date: "2026-11-02" }), "2026-11-02")).toBe(0);
    expect(daysToAlert(item({ priority: null }), "2026-11-02")).toBeNull();
    expect(daysToAlert(item({ priority: "ELIMINATE" }), "2026-11-02")).toBeNull();
    expect(daysToAlert(item({ completed_at: "2026-10-23T10:00:00Z" }), "2026-11-02")).toBeNull();
  });
});

describe("isAlertPassed / daysToAlert read the deadline (2026-11-10)", () => {
  it("is passed for an open item with a priority whose deadline is behind today", () => {
    const i = item({ important: true, priority: "DO_NOW", due_date: "2026-11-09" });
    expect(isAlertPassed(i, "2026-11-10")).toBe(true);
    expect(daysToAlert(i, "2026-11-10")).toBe(-1);
  });
  it("counts calendar days to the deadline", () => {
    expect(daysToAlert(item({ important: true, priority: "PLAN", due_date: "2026-11-16" }), "2026-11-10")).toBe(6);
  });
});

describe("shownPriority (the tag on a row)", () => {
  // Tue 2026-11-10: urgent through Thu 2026-11-12.
  const today = "2026-11-10";
  it("derives it from Important? and the deadline when Important? is answered", () => {
    expect(shownPriority(item({ important: true, priority: "PLAN", due_date: "2026-11-11" }), today, false)).toBe("DO_NOW");
    expect(shownPriority(item({ important: true, priority: "DO_NOW", due_date: "2026-11-20" }), today, false)).toBe("PLAN");
  });
  it("is Delegate for urgent and not important when the owner gives work to others", () => {
    const i = item({ important: false, priority: "PLAN", due_date: "2026-11-12" });
    expect(shownPriority(i, today, true)).toBe("DELEGATE");
    expect(shownPriority(i, today, false)).toBe("PLAN");
  });
  it("shows Eliminate for not important and not urgent (a hint; the row is not closed)", () => {
    expect(shownPriority(item({ important: false, priority: "PLAN", due_date: "2026-11-30" }), today, false)).toBe("ELIMINATE");
  });
  it("keeps the stored priority while Important? is unanswered (legacy rows)", () => {
    expect(shownPriority(item({ important: null, priority: "DELEGATE", due_date: "2026-11-30" }), today, false)).toBe("DELEGATE");
    expect(shownPriority(item({ important: null, priority: null }), today, false)).toBeNull();
  });
  it("keeps an Eliminate the person confirmed, whatever the date now says", () => {
    expect(shownPriority(item({ important: false, priority: "ELIMINATE", due_date: "2026-11-09" }), today, false)).toBe("ELIMINATE");
  });
});

describe("bandProgress", () => {
  it("counts subtasks, or the item itself when it has none, and skips ELIMINATE", () => {
    const a = item({ id: "a" });
    const b = item({ id: "b", progress: "DONE" });
    const c = item({ id: "c", priority: "ELIMINATE" });
    const subs = [
      ...[0, 1, 2, 3, 4].map((n) => sub("a", n, n < 2)),
      ...[0, 1, 2].map((n) => sub("c", n, true)),
    ];
    expect(bandProgress([a, b, c], subs)).toBe(0.5);
  });
  it("is null when every item is ELIMINATE or there are none", () => {
    expect(bandProgress([item({ priority: "ELIMINATE" })], [])).toBeNull();
    expect(bandProgress([], [])).toBeNull();
  });
});

describe("isUnread", () => {
  const read: PkRead = { membership_id: "me", next_action_id: "i1", last_read_at: "2026-10-21T12:00:00Z" };
  const note = (author_id: string, created_at: string): PkNote => ({
    id: "n1", next_action_id: "i1", author_id, body: "x", created_at, edited_at: null,
  });
  it("ignores my own note after my read", () => {
    expect(isUnread(item(), [note("me", "2026-10-22T09:00:00Z")], read, "me")).toBe(false);
  });
  it("flags another's note after my read", () => {
    expect(isUnread(item(), [note("other", "2026-10-22T09:00:00Z")], read, "me")).toBe(true);
  });
  it("ignores another's note before my read", () => {
    expect(isUnread(item(), [note("other", "2026-10-20T09:00:00Z")], read, "me")).toBe(false);
  });
  it("flags another's status change after my read", () => {
    const i = item({ last_changed_by: "other", last_changed_at: "2026-10-22T09:00:00Z" });
    expect(isUnread(i, [], read, "me")).toBe(true);
  });
  it("ignores my own status change", () => {
    const i = item({ last_changed_by: "me", last_changed_at: "2026-10-22T09:00:00Z" });
    expect(isUnread(i, [], read, "me")).toBe(false);
  });
  it("compares instants, not strings, across offsets", () => {
    // 13:00+02:00 is 11:00Z, before the 12:00Z read
    expect(isUnread(item(), [note("other", "2026-10-21T13:00:00+02:00")], read, "me")).toBe(false);
  });
  it("without a read row: quiet is read, others' activity is unread", () => {
    expect(isUnread(item(), [], undefined, "me")).toBe(false);
    expect(isUnread(item(), [note("other", "2026-10-22T09:00:00Z")], undefined, "me")).toBe(true);
  });
});

describe("summarize", () => {
  const band = (id: string, items: PkItem[]): PkBand => ({
    activityId: id, accountId: null, dealer: id, pkDate: "2026-10-20", location: null, items,
  });
  it("counts open items only", () => {
    const closed = "2026-10-25T10:00:00Z";
    const bands = [
      band("b1", [
        item({ id: "1", progress: "STUCK" }),
        item({ id: "2", progress: "WAITING", due_date: "2026-11-09" }),
        item({ id: "3", completed_at: closed }),
      ]),
      band("b2", [item({ id: "4", completed_at: closed }), item({ id: "5", priority: "ELIMINATE", completed_at: closed })]),
    ];
    expect(summarize(bands, (i) => i.id === "2" || i.id === "4", "2026-11-02")).toEqual({
      pksOpen: 1, followUps: 2, alertPassed: 1, onUs: 1, waiting: 1, newForMe: 1,
    });
  });
});

describe("mirrorUpdate", () => {
  const NOW = "2026-11-02T15:00:00.000Z";

  it("Done closes the item and stamps me", () => {
    const n = mirrorUpdate(item(), { progress: "DONE" }, "me", NOW);
    expect(n.completed_at).toBe(NOW);
    expect(n.last_changed_by).toBe("me");
    expect(n.last_changed_at).toBe(NOW);
  });

  it("leaving Done reopens it", () => {
    const n = mirrorUpdate(item({ progress: "DONE", completed_at: "2026-10-30T00:00:00Z" }), { progress: "STUCK" }, "me", NOW);
    expect(n.completed_at).toBeNull();
  });

  it("Eliminate closes it and drops the days; the due date stays", () => {
    const n = mirrorUpdate(item(), { priority: "ELIMINATE" as const, priority_days: null }, "me", NOW);
    expect(n.completed_at).toBe(NOW);
    expect(n.priority_days).toBeNull();
    expect(n.due_date).toBe("2026-10-22");
  });

  it("leaving Eliminate reopens it unless it is Done", () => {
    const open = mirrorUpdate(
      item({ priority: "ELIMINATE", priority_days: null, completed_at: "2026-10-30T00:00:00Z" }),
      { priority: "PLAN" as const, priority_days: 7, due_date: "2026-10-27" },
      "me",
      NOW,
    );
    expect(open.completed_at).toBeNull();
    expect(open.due_date).toBe("2026-10-27");
    const done = mirrorUpdate(
      item({ priority: "ELIMINATE", priority_days: null, progress: "DONE", completed_at: "2026-10-30T00:00:00Z" }),
      { priority: "PLAN" as const, priority_days: 7, due_date: "2026-10-27" },
      "me",
      NOW,
    );
    expect(done.completed_at).toBe("2026-10-30T00:00:00Z");
  });

  it("Done on an Eliminate item keeps it closed", () => {
    const n = mirrorUpdate(
      item({ priority: "ELIMINATE", priority_days: null, completed_at: "2026-10-30T00:00:00Z" }),
      { progress: "DONE" },
      "me",
      NOW,
    );
    expect(n.completed_at).toBe("2026-10-30T00:00:00Z");
    expect(n.progress).toBe("DONE");
  });

  it("Waiting on dealer stamps me and closes nothing", () => {
    const n = mirrorUpdate(item(), { progress: "WAITING" }, "me", NOW);
    expect(n.completed_at).toBeNull();
    expect(n.last_changed_by).toBe("me");
  });

  it("leaving Done while eliminated keeps it closed", () => {
    const n = mirrorUpdate(
      item({ priority: "ELIMINATE", priority_days: null, progress: "DONE", completed_at: "2026-10-30T00:00:00Z" }),
      { progress: "WORKING_ON_IT" },
      "me",
      NOW,
    );
    expect(n.completed_at).toBe("2026-10-30T00:00:00Z");
  });

  it("a priority change on an open item leaves it open", () => {
    const n = mirrorUpdate(item(), { priority: "PLAN" as const, priority_days: 7, due_date: "2026-10-27" }, "me", NOW);
    expect(n.completed_at).toBeNull();
    expect(n.due_date).toBe("2026-10-27");
  });

  it("sending Eliminate again does not restamp the close", () => {
    const n = mirrorUpdate(
      item({ priority: "ELIMINATE", priority_days: null, completed_at: "2026-10-30T00:00:00Z" }),
      { priority: "ELIMINATE" as const, priority_days: null },
      "me",
      NOW,
    );
    expect(n.completed_at).toBe("2026-10-30T00:00:00Z");
    expect(n.last_changed_by).toBeNull();
  });

  it("no change stamps nobody", () => {
    const n = mirrorUpdate(item(), { progress: "NOT_STARTED" }, "me", NOW);
    expect(n.last_changed_by).toBeNull();
  });
});

describe("trapTarget", () => {
  it("wraps Tab from the last control to the first", () => {
    expect(trapTarget(5, 4, false)).toBe(0);
  });
  it("wraps Shift+Tab from the first control to the last", () => {
    expect(trapTarget(5, 0, true)).toBe(4);
  });
  it("lets the browser move between controls in the middle", () => {
    expect(trapTarget(5, 2, false)).toBeNull();
    expect(trapTarget(5, 2, true)).toBeNull();
  });
  it("pulls focus back in when it sits outside the drawer", () => {
    expect(trapTarget(5, -1, false)).toBe(0);
    expect(trapTarget(5, -1, true)).toBe(4);
  });
  it("does nothing when there is nothing to focus", () => {
    expect(trapTarget(0, -1, false)).toBeNull();
  });
});

describe("isOnUs", () => {
  it("is ours unless it waits on the dealer or is done", () => {
    expect(isOnUs("NOT_STARTED")).toBe(true);
    expect(isOnUs("WORKING_ON_IT")).toBe(true);
    expect(isOnUs("STUCK")).toBe(true);
    expect(isOnUs("WAITING")).toBe(false);
    expect(isOnUs("DONE")).toBe(false);
  });
});

describe("PK follow-up for reps (spec 2026-11-03)", () => {
  it("the owner and the desk move an item; a rep reads someone else's", () => {
    expect(canEditItem("tj", "tj", false)).toBe(true);
    expect(canEditItem("joao", "tj", false)).toBe(false);
    expect(canEditItem("joao", "bianca", true)).toBe(true);
  });

  it("names a PK by its runner's first name", () => {
    expect(firstNameOf("Joao Manager")).toBe("Joao");
    expect(firstNameOf("  Deonn  Deford ")).toBe("Deonn");
    expect(firstNameOf(undefined)).toBe("Someone");
  });
});

describe("subtaskBar (2026-11-06: the In progress cell fills with its subtasks)", () => {
  const sub = (done: boolean) => ({ id: "s", next_action_id: "n", title: "t", done_at: done ? "2026-11-06T00:00:00Z" : null, position: 0 });
  it("is the share of subtasks done, rounded", () => {
    expect(subtaskBar("WORKING_ON_IT", [sub(true), sub(true), sub(false), sub(false), sub(false)])).toEqual({ done: 2, total: 5, pct: 40 });
    expect(subtaskBar("WORKING_ON_IT", [sub(true), sub(false), sub(false)])).toEqual({ done: 1, total: 3, pct: 33 });
  });
  it("shows 0% when none is done yet", () => {
    expect(subtaskBar("WORKING_ON_IT", [sub(false)])).toEqual({ done: 0, total: 1, pct: 0 });
  });
  it("is only for In progress, and only with subtasks", () => {
    expect(subtaskBar("WORKING_ON_IT", [])).toBeNull();
    for (const p of ["NOT_STARTED", "WAITING", "STUCK", "DONE"] as const) {
      expect(subtaskBar(p, [sub(true)])).toBeNull();
    }
  });
});

describe("alertBase (2026-11-06: classifying an old PK's items must not make them late on arrival)", () => {
  const none = { priority: null, priority_days: null, due_date: "2026-11-06" };
  it("a first priority counts from today when the PK is already past", () => {
    expect(alertBase("2026-10-20", none, "2026-11-09")).toBe("2026-11-09");
  });
  it("a first priority on the PK day counts from the PK", () => {
    expect(alertBase("2026-11-09", none, "2026-11-09")).toBe("2026-11-09");
  });
  it("an item that has a priority keeps the base it got", () => {
    expect(alertBase("2026-10-20", { priority: "PLAN", priority_days: 7, due_date: "2026-11-16" }, "2026-11-20")).toBe("2026-11-09");
    expect(alertBase("2026-10-20", { priority: "DELEGATE", priority_days: 2, due_date: "2026-10-22" }, "2026-11-09")).toBe("2026-10-20");
  });
  it("an eliminated item getting a priority again counts from today", () => {
    expect(alertBase("2026-10-20", { priority: "ELIMINATE", priority_days: null, due_date: "2026-10-27" }, "2026-11-09")).toBe("2026-11-09");
  });
});

describe("planPatch (the drawer's Important?/deadline write)", () => {
  const pkDate = "2026-11-02";
  const item = { priority: "PLAN" as const, important: true, due_date: "2026-11-09" };

  it("a new deadline carries the recomputed priority and the days after the PK", () => {
    expect(planPatch(item, { due_date: "2026-11-11", priority: "DO_NOW" }, pkDate)).toEqual({
      due_date: "2026-11-11",
      priority: "DO_NOW",
      priority_days: 9,
    });
  });

  it("a deadline moved on an ELIMINATED item does not send a priority (it stays closed)", () => {
    const gone = { priority: "ELIMINATE" as const, important: false, due_date: "2026-11-09" };
    const patch = planPatch(gone, { due_date: "2026-11-20", priority: "PLAN" }, pkDate);
    expect(patch).toEqual({ due_date: "2026-11-20" });
    expect(patch).not.toHaveProperty("priority");
    expect(patch).not.toHaveProperty("priority_days");
  });

  it("a new Important? answer on an eliminated item may reopen it", () => {
    const gone = { priority: "ELIMINATE" as const, important: false, due_date: "2026-11-09" };
    expect(planPatch(gone, { important: true, priority: "PLAN" }, pkDate)).toMatchObject({
      important: true,
      priority: "PLAN",
    });
  });

  it("Eliminate confirmed is written alone", () => {
    expect(planPatch(item, { priority: "ELIMINATE" }, pkDate)).toEqual({ priority: "ELIMINATE" });
  });

  it("while Important? is unanswered a legacy priority stands and is not sent", () => {
    const legacy = { priority: "DELEGATE" as const, important: null, due_date: "2026-11-09" };
    expect(planPatch(legacy, { due_date: "2026-11-12", priority: null }, pkDate)).toEqual({
      due_date: "2026-11-12",
      priority_days: 10,
    });
  });
});
