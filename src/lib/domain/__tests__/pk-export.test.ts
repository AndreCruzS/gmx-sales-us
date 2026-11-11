// The PK follow-up export (spec 2026-11-02 §5): the rows are plain cells, so
// the tests read them as text; the last test writes a real workbook and reads
// it back, to prove both sheets reach the file.

import { describe, expect, it } from "vitest";
import readXlsxFile from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";
import { pkExportFileName, pkExportSheets, type Cell } from "@/lib/domain/pk-export";
import type { PkBand, PkItem, PkNote, PkSubtask } from "@/lib/domain/pk-follow-up";

const names = new Map([
  ["m1", "Bianca"],
  ["m2", "Joao"],
]);

function item(over: Partial<PkItem> & { id: string }): PkItem {
  return {
    action: "Send the price list",
    owner_id: "m1",
    due_date: "2026-10-22",
    completed_at: null,
    priority: "DELEGATE",
    priority_days: 2,
    important: false,
    progress: "WORKING_ON_IT",
    last_changed_by: null,
    last_changed_at: null,
    updated_at: "2026-10-20T12:00:00Z",
    ...over,
  };
}

function band(items: PkItem[]): PkBand {
  return {
    activityId: "a1",
    accountId: "acc1",
    dealer: "BFS Heber",
    pkDate: "2026-10-20",
    location: "Heber, UT",
    items,
  };
}

/** A note stamped in the machine's own zone, so "h:mm a" reads the same anywhere. */
function note(id: string, over: Partial<PkNote> = {}): PkNote {
  return {
    id,
    next_action_id: "i1",
    author_id: "m2",
    body: "Called them",
    created_at: new Date(2026, 9, 21, 14, 5).toISOString(),
    edited_at: null,
    ...over,
  };
}

function text(c: Cell): string {
  if (c === null) return "";
  if (c.value instanceof Date) return c.value.toISOString().slice(0, 10);
  return String(c.value ?? "");
}

describe("pkExportFileName", () => {
  it("names the file by the day", () => {
    expect(pkExportFileName("2026-11-02")).toBe("Action items · Nov 2, 2026.xlsx");
  });
});

describe("pkExportSheets", () => {
  it("heads each PK with a bold row, then one row per follow-up", () => {
    const { followUps } = pkExportSheets([band([item({ id: "i1" })])], [], [], names);
    const head = followUps[1]!;
    expect(head[0]).toMatchObject({ fontWeight: "bold", columnSpan: 8 });
    expect(text(head[0])).toBe("BFS Heber · PK Oct 20 · Heber, UT · 0%");
    const row = followUps[2]!.map(text);
    expect(row.slice(0, 6)).toEqual(["Send the price list", "In progress", "Delegate", "2", "2026-10-22", "Bianca"]);
  });

  it("heads the columns with the board's Days and Alert date", () => {
    const { followUps } = pkExportSheets([band([item({ id: "i1" })])], [], [], names);
    expect(followUps[0]!.map(text)).toEqual([
      "Action",
      "Status",
      "Priority",
      "Days",
      "Alert date",
      "Owner",
      "Subtasks",
      "Notes",
    ]);
  });

  it("writes the drawer's Days for an old PK prioritised later, not the days since the PK", () => {
    const { followUps } = pkExportSheets(
      [band([item({ id: "i1", priority: "DO_NOW", priority_days: 2, due_date: "2026-11-12" })])],
      [],
      [],
      names,
    );
    expect(text(followUps[2]![3]!)).toBe("2");
  });

  it("works the days out of the PK and the alert when none were stored", () => {
    const { followUps } = pkExportSheets(
      [band([item({ id: "i1", priority: "PLAN", priority_days: null, due_date: "2026-10-27" })])],
      [],
      [],
      names,
    );
    expect(text(followUps[2]![3]!)).toBe("7");
  });

  it("writes the one status in the board's words", () => {
    const { followUps } = pkExportSheets([band([item({ id: "i1", progress: "WAITING" })])], [], [], names);
    expect(text(followUps[2]![1]!)).toBe("Waiting on dealer");
  });

  it("writes the alert as a real date", () => {
    const { followUps } = pkExportSheets([band([item({ id: "i1" })])], [], [], names);
    const cell = followUps[2]![4] as Exclude<Cell, null>;
    expect(cell.value).toBeInstanceOf(Date);
    expect(cell.format).toBe("mmm d, yyyy");
  });

  it("leaves the alert empty for Eliminate and for an unset priority", () => {
    const { followUps } = pkExportSheets(
      [
        band([
          item({ id: "i1", priority: "ELIMINATE", priority_days: null }),
          item({ id: "i2", priority: null, priority_days: null }),
        ]),
      ],
      [],
      [],
      names,
    );
    for (const r of [followUps[2]!, followUps[3]!]) {
      expect(r[3]).toBeNull();
      expect(r[4]).toBeNull();
    }
  });

  it("joins the notes oldest first and marks the edited ones", () => {
    const later = note("n2", { body: "Sent it", created_at: new Date(2026, 9, 22, 9, 30).toISOString() });
    const first = note("n1", { edited_at: new Date(2026, 9, 21, 15, 0).toISOString() });
    const { followUps } = pkExportSheets([band([item({ id: "i1" })])], [later, first], [], names);
    expect(text(followUps[2]![7]!)).toBe(
      "Joao · Oct 21, 2:05 PM: Called them (edited)\nJoao · Oct 22, 9:30 AM: Sent it",
    );
  });

  it("counts the subtasks done and lists them on their own sheet", () => {
    const subs: PkSubtask[] = [
      { id: "s1", next_action_id: "i1", title: "Pull the list", done_at: new Date(2026, 9, 21, 10).toISOString(), position: 1 },
      { id: "s2", next_action_id: "i1", title: "Mail it", done_at: null, position: 2 },
    ];
    const out = pkExportSheets([band([item({ id: "i1" })])], [], subs, names);
    expect(text(out.followUps[2]![6]!)).toBe("1/2");
    // Column labels, then one row per subtask.
    expect(out.subtasks.map((r) => r.map(text))).toEqual([
      ["PK", "Action", "Subtask", "Done"],
      ["BFS Heber · PK Oct 20", "Send the price list", "Pull the list", "2026-10-21"],
      ["BFS Heber · PK Oct 20", "Send the price list", "Mail it", ""],
    ]);
    expect(out.subtasks[2]![3]).toBeNull();
  });

  it("leaves out the place and the percent a PK does not have", () => {
    const b = { ...band([]), location: null };
    const { followUps } = pkExportSheets([b], [], [], names);
    expect(text(followUps[1]![0])).toBe("BFS Heber · PK Oct 20");
  });

  it("round-trips through a real workbook with both sheets", async () => {
    const { followUps, subtasks } = pkExportSheets(
      [band([item({ id: "i1" })])],
      [note("n1")],
      [{ id: "s1", next_action_id: "i1", title: "Mail it", done_at: null, position: 1 }],
      names,
    );
    const buf = await writeXlsxFile([
      { data: followUps, sheet: "Action items" },
      { data: subtasks, sheet: "Subtasks" },
    ]).toBuffer();
    const sheets = await readXlsxFile(buf);
    expect(sheets.map((s) => s.sheet)).toEqual(["Action items", "Subtasks"]);
    const [fu, st] = sheets.map((s) => s.data);
    expect(fu![0]![0]).toBe("Action");
    expect(fu![2]![0]).toBe("Send the price list");
    expect((fu![2]![4] as unknown as Date).toISOString().slice(0, 10)).toBe("2026-10-22");
    expect(st![1]![2]).toBe("Mail it");
  });
});
