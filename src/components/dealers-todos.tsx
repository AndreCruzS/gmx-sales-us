"use client";

// THE DEALERS BOARD'S TO-DOS (Bianca, meeting 2026-10-27): split the way her
// visit reports split them — Action items, To coordinate, Follow-ups — so the
// desk reads the team's open work in the shape it is written in. A promise and
// a deadline are things to DO, so they sit with the actions (bucketOf).
//
// Visits are not to-dos: a row with no item_type is on the agenda, not here,
// and the page never hands one in.
//
// Whose: Everyone, Mine, or one person — the same chip row the Reps board
// uses, never a dropdown. The tab counts answer for the person picked.
//
// The order is the one a manager reads in: what is late first, then by the
// date it is due. A row says who owns it and, when somebody else typed it,
// who did — "entered by André for Bianca" — because the desk often writes up
// a rep's promise for them after a joint visit.

import { useMemo, useState } from "react";
import { DealerItemForm } from "@/components/dealer-item-form";
import { Pager, usePaged, usePageSize } from "@/components/pager";
import type { Tier } from "@/lib/domain/dealer-tiers";
import {
  BUCKET_LABEL,
  ITEM_TYPE_LABEL,
  bucketOf,
  isLate,
  type Bucket,
  type ItemType,
} from "@/lib/domain/dealer-items";
import { displayAccountName, formatDay } from "@/lib/format";

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export interface DealerItem {
  id: string;
  action: string;
  due_date: string;
  owner_id: string;
  account_id: string | null;
  item_type: ItemType;
  source: string | null;
  entered_by: string | null;
  completed_at: string | null;
  account: { name: string } | null;
}

const BUCKETS: readonly Bucket[] = ["action", "coordinate", "follow_up"];

/** Where the row came from, in words — MANUAL says nothing, it is the norm. */
const SOURCE_WORDS: Record<string, string> = {
  VISIT_CAPTURE: "from a visit note",
  VOICE: "from Say it",
  EMAIL_AI: "found in email",
  EMAIL_BACKFILL: "from email history",
};

/** Whole days between two YYYY-MM-DD dates, as calendar labels. */
function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function DealersTodos({
  items,
  todayIso,
  myId,
  names,
  tierOf,
  onOpen,
  onAdded,
  span,
}: {
  items: readonly DealerItem[];
  todayIso: string;
  myId: string | null;
  names: ReadonlyMap<string, string>;
  /** The dealer's tier by account id, when the files give it one. */
  tierOf: (accountId: string | null) => Tier | null;
  onOpen: (accountId: string, name: string) => void;
  /** A to-do was just added from this card; the board shows it at once. */
  onAdded: (item: DealerItem) => void;
  span: string;
}) {
  const [bucket, setBucket] = useState<Bucket>("action");
  // null = Everyone; otherwise a membership id ("Mine" is the reader's own).
  const [who, setWho] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const people = useMemo(() => {
    const ids = [...new Set(items.map((i) => i.owner_id))].filter((id) => id !== myId);
    return ids
      .map((id) => ({ id, name: names.get(id) ?? "Someone" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, names, myId]);

  const scoped = useMemo(
    () => (who ? items.filter((i) => i.owner_id === who) : items),
    [items, who],
  );

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { action: 0, coordinate: 0, follow_up: 0 };
    for (const i of scoped) c[bucketOf(i.item_type)] += 1;
    return c;
  }, [scoped]);

  const rows = useMemo(
    () =>
      scoped
        .filter((i) => bucketOf(i.item_type) === bucket)
        .sort((a, b) => {
          const la = isLate(a, todayIso) ? 0 : 1;
          const lb = isLate(b, todayIso) ? 0 : 1;
          return la - lb || a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id);
        }),
    [scoped, bucket, todayIso],
  );
  const late = useMemo(() => scoped.filter((i) => isLate(i, todayIso)).length, [scoped, todayIso]);

  const size = usePageSize(8, 5);
  const { slice, page, pages, from, setPage, total } = usePaged(rows, size);

  return (
    <section className="adapt card dl-todos" data-desk="todos" data-span={span}>
      <div className="quiet-head">
        <span className="t-title">To-dos</span>
        <span className="flex items-baseline gap-3">
        <button type="button" className="t-action" onClick={() => setAdding((a) => !a)}>
          {adding ? "Close" : "+ Add"}
        </button>
        <span className="t-hint">
          {items.length === 0
            ? "nothing open"
            : `${QTY.format(scoped.length)} open${late > 0 ? ` · ${QTY.format(late)} late` : ""}`}
        </span>
        </span>
      </div>

      {adding && (
        <DealerItemForm onDone={() => setAdding(false)} onSaved={onAdded} />
      )}

      <div className="dl-todos-controls">
        <div className="chip-row" role="group" aria-label="Kind of to-do">
          {BUCKETS.map((b) => (
            <button
              key={b}
              type="button"
              className="chip"
              aria-pressed={bucket === b}
              onClick={() => setBucket(b)}
            >
              {BUCKET_LABEL[b]}
              <span className="chip-count">{QTY.format(counts[b])}</span>
            </button>
          ))}
        </div>
        <div className="chip-row dl-who" role="group" aria-label="Whose to-dos">
          <button
            type="button"
            className="chip"
            aria-pressed={who === null}
            onClick={() => setWho(null)}
          >
            Everyone
          </button>
          {myId && (
            <button
              type="button"
              className="chip"
              aria-pressed={who === myId}
              onClick={() => setWho(myId)}
            >
              Mine
            </button>
          )}
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              aria-pressed={who === p.id}
              onClick={() => setWho(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <p className="t-sub dl-todos-empty">
          {items.length === 0
            ? "No to-do is open on any account. They appear here when a visit note or Say it sets one."
            : `Nothing under ${BUCKET_LABEL[bucket].toLowerCase()}${who ? " for this person" : ""}.`}
        </p>
      ) : (
        <ul className="list">
          {slice.map((i) => {
            const isLateRow = isLate(i, todayIso);
            const tier = tierOf(i.account_id);
            const owner = names.get(i.owner_id) ?? "Someone";
            const enteredBy =
              i.entered_by && i.entered_by !== i.owner_id
                ? (names.get(i.entered_by) ?? "someone")
                : null;
            const source = i.source ? SOURCE_WORDS[i.source] : undefined;
            const name = i.account ? displayAccountName(i.account.name) : null;
            const body = (
              <>
                <span className="dl-todo-line">
                  {isLateRow ? (
                    <span className="dl-pill" data-tone="late">
                      {daysBetween(i.due_date, todayIso)}d late
                    </span>
                  ) : (
                    <span className="dl-pill">{formatDay(i.due_date)}</span>
                  )}
                  {tier && (
                    <span className="dl-tier" data-tier={tier}>
                      {tier}
                    </span>
                  )}
                  <span className="dl-todo-what">
                    {name && <b>{name}</b>}
                    {name ? " — " : ""}
                    {i.action}
                  </span>
                </span>
                <span className="t-hint dl-todo-sub">
                  {[
                    ITEM_TYPE_LABEL[i.item_type],
                    owner,
                    enteredBy ? `entered by ${enteredBy} for ${owner}` : null,
                    source ?? null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </>
            );
            return (
              <li key={i.id}>
                {i.account_id ? (
                  <button
                    type="button"
                    className="dl-todo"
                    onClick={() => onOpen(i.account_id as string, name ?? "")}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="dl-todo">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <Pager
          page={page}
          pages={pages}
          from={from}
          shown={slice.length}
          total={total}
          onPage={setPage}
          className="fu-pager"
        />
      )}
    </section>
  );
}
