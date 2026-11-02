import { describe, expect, it } from "vitest";
import {
  alertDate,
  bandProgress,
  daysToAlert,
  isAlertPassed,
  isUnread,
  mirrorUpdate,
  pkDateOf,
  priorityPatch,
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
    action_required: "NONE",
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

describe("priorityPatch", () => {
  it("uses the default days", () => {
    expect(priorityPatch("2026-10-20", "DELEGATE")).toEqual({ priority: "DELEGATE", priority_days: 2, due_date: "2026-10-22" });
  });
  it("takes explicit days", () => {
    expect(priorityPatch("2026-10-20", "DELEGATE", 5)).toEqual({ priority: "DELEGATE", priority_days: 5, due_date: "2026-10-25" });
  });
  it("leaves the due date alone for ELIMINATE", () => {
    const p = priorityPatch("2026-10-20", "ELIMINATE");
    expect(p).toEqual({ priority: "ELIMINATE", priority_days: null });
    expect("due_date" in p).toBe(false);
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
        item({ id: "1", action_required: "PENDING_ACTION" }),
        item({ id: "2", action_required: "AWAITING_RESPONSE", due_date: "2026-11-09" }),
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
    const n = mirrorUpdate(item(), priorityPatch("2026-10-20", "ELIMINATE"), "me", NOW);
    expect(n.completed_at).toBe(NOW);
    expect(n.priority_days).toBeNull();
    expect(n.due_date).toBe("2026-10-22");
  });

  it("leaving Eliminate reopens it unless it is Done", () => {
    const open = mirrorUpdate(
      item({ priority: "ELIMINATE", priority_days: null, completed_at: "2026-10-30T00:00:00Z" }),
      priorityPatch("2026-10-20", "PLAN"),
      "me",
      NOW,
    );
    expect(open.completed_at).toBeNull();
    expect(open.due_date).toBe("2026-10-27");
    const done = mirrorUpdate(
      item({ priority: "ELIMINATE", priority_days: null, progress: "DONE", completed_at: "2026-10-30T00:00:00Z" }),
      priorityPatch("2026-10-20", "PLAN"),
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

  it("Action required alone stamps me and closes nothing", () => {
    const n = mirrorUpdate(item(), { action_required: "AWAITING_RESPONSE" }, "me", NOW);
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
    const n = mirrorUpdate(item(), priorityPatch("2026-10-20", "PLAN"), "me", NOW);
    expect(n.completed_at).toBeNull();
    expect(n.due_date).toBe("2026-10-27");
  });

  it("sending Eliminate again does not restamp the close", () => {
    const n = mirrorUpdate(
      item({ priority: "ELIMINATE", priority_days: null, completed_at: "2026-10-30T00:00:00Z" }),
      priorityPatch("2026-10-20", "ELIMINATE"),
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
