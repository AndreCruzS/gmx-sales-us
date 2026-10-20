// Needs your attention, one widget per kind (Andre, 2026-10-20): the rows
// fall into one group per exception, danger first, then the biggest pile.

import { describe, expect, it } from "vitest";
import { groupAttention, type AttentionItem } from "@/components/attention-widgets";

function row(type: string, id: string): AttentionItem {
  return { exception_type: type, subject_type: "account", subject_id: id, title: id, detail: null };
}

describe("grouping the attention list", () => {
  const rows = [
    row("NO_CHAMPION", "a"),
    row("DISPLAY_NOT_VERIFIED", "b"),
    row("NO_CHAMPION", "c"),
    row("QUOTE_NO_FOLLOW_UP", "d"),
    row("NO_CHAMPION", "e"),
    row("STRATEGIC_ACCOUNT_QUIET", "f"),
    row("STRATEGIC_ACCOUNT_QUIET", "g"),
  ];

  it("one group per kind, every row in exactly one", () => {
    const g = groupAttention(rows);
    expect(g).toHaveLength(4);
    expect(g.reduce((n, x) => n + x.rows.length, 0)).toBe(rows.length);
  });

  it("danger first, then the biggest pile", () => {
    expect(groupAttention(rows).map((x) => x.type)).toEqual([
      "STRATEGIC_ACCOUNT_QUIET",
      "QUOTE_NO_FOLLOW_UP",
      "NO_CHAMPION",
      "DISPLAY_NOT_VERIFIED",
    ]);
  });

  it("keeps each group's rows in the order they came", () => {
    const captain = groupAttention(rows).find((x) => x.type === "NO_CHAMPION")!;
    expect(captain.rows.map((r) => r.subject_id)).toEqual(["a", "c", "e"]);
    expect(captain.danger).toBe(false);
  });

  it("nothing flagged, no widgets", () => {
    expect(groupAttention([])).toEqual([]);
  });
});

describe("which screen reads which kind (2026-10-20)", () => {
  it("every named kind is read on exactly one screen", async () => {
    const { AGENDA_EXCEPTION_TYPES, HOME_EXCEPTION_TYPES, EXCEPTION_LABEL } = await import(
      "@/lib/domain/exceptions"
    );
    const agenda = new Set<string>(AGENDA_EXCEPTION_TYPES);
    for (const t of Object.keys(EXCEPTION_LABEL)) {
      expect(agenda.has(t) !== HOME_EXCEPTION_TYPES.includes(t)).toBe(true);
    }
  });

  it("the agenda keeps what a date answers; the home keeps the account's health", async () => {
    const { AGENDA_EXCEPTION_TYPES, HOME_EXCEPTION_TYPES } = await import("@/lib/domain/exceptions");
    expect(AGENDA_EXCEPTION_TYPES).toContain("OVERDUE_FOLLOW_UP");
    expect(AGENDA_EXCEPTION_TYPES).toContain("NEXT_WEEK_NOT_PLANNED");
    expect(HOME_EXCEPTION_TYPES).toContain("NO_CHAMPION");
    expect(HOME_EXCEPTION_TYPES).toContain("DISPLAY_NOT_VERIFIED");
    expect(HOME_EXCEPTION_TYPES).toContain("STRATEGIC_ACCOUNT_QUIET");
  });
});
