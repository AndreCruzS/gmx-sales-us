// The PK follow-up export (spec 2026-11-02 §5): what the board shows, as the
// two sheets of an Excel file. Pure: bands, notes and subtasks in, rows of
// cells out. The writing itself (write-excel-file) lives with the button, so
// the library loads on click only.
//
// Sheet "PK follow-ups": a bold line per PK, then one row per follow-up.
// Sheet "Subtasks": one row per subtask, named by its PK and action.

import {
  PRIORITY_LABEL,
  PROGRESS_LABEL,
  bandProgress,
  pkDateOf,
  type PkBand,
  type PkItem,
  type PkNote,
  type PkSubtask,
} from "@/lib/domain/pk-follow-up";

/**
 * One cell, in the shape write-excel-file takes (its own `Cell` also accepts
 * bare values; these rows always use the object form). `null` is an empty cell.
 */
export type Cell = {
  value: string | number | Date;
  fontWeight?: "bold";
  /** Combines this cell with the next `columnSpan - 1` in its row. */
  columnSpan?: number;
  /** Number or date format (Date cells only here). */
  format?: string;
  wrap?: boolean;
} | null;

export interface PkExportSheets {
  followUps: Cell[][];
  subtasks: Cell[][];
}

const DATE_FORMAT = "mmm d, yyyy";
const FOLLOW_UP_HEADS = [
  "Action",
  "Status",
  "Priority",
  "Days",
  "Alert date",
  "Owner",
  "Subtasks",
  "Notes",
];
const SUBTASK_HEADS = ["PK", "Action", "Subtask", "Done"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 'Oct 20' from 'YYYY-MM-DD'. */
function monthDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** 'Nov 2, 2026' from 'YYYY-MM-DD'. */
function longDate(iso: string): string {
  const [y] = iso.split("-").map(Number);
  return `${monthDay(iso)}, ${y}`;
}

/** The file's name for the day: `Action items · Nov 2, 2026.xlsx`. */
export function pkExportFileName(today: string): string {
  return `Action items · ${longDate(today)}.xlsx`;
}

/** A calendar day as a date cell: UTC midnight, so no zone can move the day. */
function dayCell(iso: string): Cell {
  const [y, m, d] = iso.split("-").map(Number);
  return { value: new Date(Date.UTC(y, m - 1, d)), format: DATE_FORMAT };
}

function text(value: string | number | null | undefined): Cell {
  return value === null || value === undefined || value === "" ? null : { value };
}

/** 'Oct 21, 2:05 PM', in the reader's own zone. */
function stamp(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${monthDay(pkDateOf(iso))}, ${h % 12 === 0 ? 12 : h % 12}:${min} ${h < 12 ? "AM" : "PM"}`;
}

function bandTitle(b: PkBand, p: number | null): string {
  const parts = [b.dealer, `PK ${monthDay(b.pkDate)}`];
  if (b.location) parts.push(b.location);
  if (p !== null) parts.push(`${Math.round(p * 100)}%`);
  return parts.join(" · ");
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(key(r));
    if (list) list.push(r);
    else m.set(key(r), [r]);
  }
  return m;
}

function noteLine(n: PkNote, names: Map<string, string>): string {
  const who = names.get(n.author_id) ?? "Someone";
  return `${who} · ${stamp(n.created_at)}: ${n.body}${n.edited_at ? " (edited)" : ""}`;
}

/** The alert belongs to a prioritised item that is not Eliminate. */
function hasAlert(i: PkItem): boolean {
  return i.priority !== null && i.priority !== "ELIMINATE";
}

/**
 * The rows of both sheets for the bands given (the board passes what its
 * filters leave). Notes read oldest first; a note's author is looked up in
 * `names` (memberships), "Someone" when unknown. A band's % is worked out over
 * its own items unless `progress` gives it (by activity id): the board passes
 * the whole band's figure, so a filter never changes it.
 */
export function pkExportSheets(
  bands: PkBand[],
  notes: PkNote[],
  subtasks: PkSubtask[],
  names: Map<string, string>,
  progress?: Map<string, number | null>,
): PkExportSheets {
  const notesBy = groupBy(
    [...notes].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    (n) => n.next_action_id,
  );
  const subsBy = groupBy(
    [...subtasks].sort((a, b) => a.position - b.position),
    (s) => s.next_action_id,
  );

  const followUps: Cell[][] = [FOLLOW_UP_HEADS.map((h) => ({ value: h, fontWeight: "bold" as const }))];
  const subRows: Cell[][] = [SUBTASK_HEADS.map((h) => ({ value: h, fontWeight: "bold" as const }))];

  for (const b of bands) {
    const p = progress?.has(b.activityId)
      ? progress.get(b.activityId)!
      : bandProgress(b.items, b.items.flatMap((i) => subsBy.get(i.id) ?? []));
    const title = bandTitle(b, p);
    const head: Cell[] = FOLLOW_UP_HEADS.map(() => null);
    head[0] = { value: title, fontWeight: "bold", columnSpan: FOLLOW_UP_HEADS.length };
    followUps.push(head);

    for (const i of b.items) {
      const subs = subsBy.get(i.id) ?? [];
      const lines = (notesBy.get(i.id) ?? []).map((n) => noteLine(n, names));
      followUps.push([
        text(i.action),
        text(PROGRESS_LABEL[i.progress]),
        i.priority ? text(PRIORITY_LABEL[i.priority]) : null,
        hasAlert(i) && i.priority_days !== null ? { value: i.priority_days } : null,
        hasAlert(i) ? dayCell(i.due_date) : null,
        text(names.get(i.owner_id) ?? "Someone"),
        subs.length > 0
          ? { value: `${subs.filter((s) => s.done_at !== null).length}/${subs.length}` }
          : null,
        lines.length > 0 ? { value: lines.join("\n"), wrap: true } : null,
      ]);
      const pk = `${b.dealer} · PK ${monthDay(b.pkDate)}`;
      for (const s of subs) {
        subRows.push([text(pk), text(i.action), text(s.title), s.done_at ? dayCell(pkDateOf(s.done_at)) : null]);
      }
    }
  }

  return { followUps, subtasks: subRows };
}
