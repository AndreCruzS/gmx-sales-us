"use client";

// NEEDS YOUR ATTENTION, ONE WIDGET PER KIND (Andre, 2026-10-20: "deveria ser
// categorizada em widgets com paginação, não uma lista eterna de tudo
// misturado").
//
// One long list mixed a quote nobody chased with a wall nobody verified, and
// the reader had to read each line's sub-label to know which kind of problem
// it was. Now the kind is the widget: its name and count head the card, its
// rows are read a page at a time with the house pager on the card's floor,
// and a row says only what is particular to it — the account and the detail.
//
// ORDER: danger first (a broken promise or money on the table), then the
// biggest pile. The same line the old list drew, now between cards.

import Link from "next/link";
import { AlertIcon, ChevronRightIcon } from "@/components/icons";
import { Pager, usePaged, usePageSize } from "@/components/pager";
import { DANGER_EXCEPTIONS, exceptionLabel } from "@/lib/domain/exceptions";
import { displayAccountName, relativizeDates } from "@/lib/format";

export interface AttentionItem {
  exception_type: string;
  subject_type: string;
  subject_id: string;
  title: string | null;
  detail: string | null;
}

export interface AttentionGroup<T extends AttentionItem> {
  type: string;
  danger: boolean;
  rows: T[];
}

/** Rows by kind, danger first, then the biggest pile, then by name. */
export function groupAttention<T extends AttentionItem>(rows: readonly T[]): AttentionGroup<T>[] {
  const by = new Map<string, T[]>();
  for (const r of rows) {
    const list = by.get(r.exception_type);
    if (list) list.push(r);
    else by.set(r.exception_type, [r]);
  }
  return [...by.entries()]
    .map(([type, list]) => ({ type, danger: DANGER_EXCEPTIONS.has(type), rows: list }))
    .sort(
      (a, b) =>
        Number(b.danger) - Number(a.danger) ||
        b.rows.length - a.rows.length ||
        exceptionLabel(a.type).localeCompare(exceptionLabel(b.type)),
    );
}

function Widget<T extends AttentionItem>({ group, size }: { group: AttentionGroup<T>; size: number }) {
  const { slice, page, pages, from, setPage, total } = usePaged(group.rows, size);
  return (
    <section className="attn-widget card" data-danger={group.danger || undefined}>
      <div className="attn-head">
        <AlertIcon
          size={16}
          style={{ color: group.danger ? "var(--danger)" : "var(--accent-ink)" }}
        />
        <h3 className="t-title attn-name">{exceptionLabel(group.type)}</h3>
        {group.danger ? (
          <span className="tag tag-danger">{total}</span>
        ) : (
          <span className="t-meta">{total}</span>
        )}
      </div>
      <ul className="list">
        {slice.map((e) => {
          const body = (
            <span className="row-body min-w-0">
              <span className="t-title block truncate">
                {e.title ? displayAccountName(e.title) : exceptionLabel(e.exception_type)}
              </span>
              {e.detail && (
                <span className="t-sub block truncate">{relativizeDates(e.detail)}</span>
              )}
            </span>
          );
          return (
            <li key={`${e.exception_type}-${e.subject_id}`}>
              {e.subject_type === "account" ? (
                <Link href={`/accounts/${e.subject_id}`} className="row">
                  {body}
                  <ChevronRightIcon size={14} style={{ color: "var(--ink-muted)" }} />
                </Link>
              ) : (
                <div className="row">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {pages > 1 && (
        <Pager
          page={page}
          pages={pages}
          from={from}
          shown={slice.length}
          total={total}
          onPage={setPage}
        />
      )}
    </section>
  );
}

export function AttentionWidgets<T extends AttentionItem>({ rows }: { rows: readonly T[] }) {
  const size = usePageSize(5, 4);
  const groups = groupAttention(rows);
  return (
    <div className="attn-widgets">
      {groups.map((g) => (
        <Widget key={g.type} group={g} size={size} />
      ))}
    </div>
  );
}
