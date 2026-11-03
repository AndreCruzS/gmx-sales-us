"use client";

// WHAT WE OWE DEALERS (Bianca, meeting 2026-10-27; reshaped 2026-11-03).
// Everything the team still owes a dealer, on one list read by urgency —
// Late, This week, Later — so nothing hides behind a tab. The kinds of her
// visit reports (Action, To coordinate, Follow-up, Promise, Deadline) are a
// tag on each row and a filter with its count, not a page each.
//
// A PK's follow-ups have their own board (/dealers/pk); here they are one
// line at the foot that leads there, so the same item is never told twice in
// two vocabularies.
//
// Visits are not to-dos: a row with no item_type is on the agenda, not here,
// and the page never hands one in.
//
// Kind and Whose are two menus of checkboxes (Andre, 2026-11-03: the chip
// rows read as labels, not as filters); several can be ticked in each, and
// nothing ticked means all. The kind counts answer for the people picked.
//
// A row says when, which dealer (and its tier), what, which kind and whose
// — and, when somebody else typed it, who did ("entered by André"), because
// the desk often writes up a rep's promise for them after a joint visit.

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckMenu } from "@/components/check-menu";
import { DealerItemForm } from "@/components/dealer-item-form";
import type { Tier } from "@/lib/domain/dealer-tiers";
import { ITEM_TYPES, ITEM_TYPE_LABEL, isLate, type ItemType } from "@/lib/domain/dealer-items";
import { displayAccountName } from "@/lib/format";

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
  priority?: string | null;
  account: { name: string } | null;
  /** The activity the item was taken at; PK_TRAINING means a PK follow-up. */
  activity?: { activity_type: string } | null;
}

/** A follow-up taken at a PK: it lives on the PK follow-up board. */
export function isPkItem(i: Pick<DealerItem, "activity">): boolean {
  return i.activity?.activity_type === "PK_TRAINING";
}

/** Whole days between two YYYY-MM-DD dates, as calendar labels. */
function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 'Nov 1' from 'YYYY-MM-DD': the date itself; the line under it says how far. */
function monthDay(iso: string): string {
  return `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
}

/** YYYY-MM-DD plus n days. */
function addDays(iso: string, n: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

type Group = "late" | "week" | "later";
const GROUPS: readonly Group[] = ["late", "week", "later"];
const GROUP_LABEL: Record<Group, string> = { late: "Late", week: "This week", later: "Later" };
/** Later can be long; it opens with this many and a "show the rest". */
const LATER_SHOWN = 8;

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
  // Empty = all kinds / everyone.
  const [kinds, setKinds] = useState<Set<ItemType>>(() => new Set());
  const [whos, setWhos] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [allLater, setAllLater] = useState(false);

  const pk = useMemo(() => items.filter(isPkItem), [items]);
  const owed = useMemo(() => items.filter((i) => !isPkItem(i)), [items]);

  const people = useMemo(() => {
    const ids = [...new Set(owed.map((i) => i.owner_id))].filter((id) => id !== myId);
    return ids
      .map((id) => ({ id, name: names.get(id) ?? "Someone" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [owed, names, myId]);

  const scoped = useMemo(
    () => (whos.size > 0 ? owed.filter((i) => whos.has(i.owner_id)) : owed),
    [owed, whos],
  );

  const counts = useMemo(() => {
    const c = new Map<ItemType, number>();
    for (const i of scoped) c.set(i.item_type, (c.get(i.item_type) ?? 0) + 1);
    return c;
  }, [scoped]);

  const groups = useMemo(() => {
    const weekEnd = addDays(todayIso, 6);
    const g: Record<Group, DealerItem[]> = { late: [], week: [], later: [] };
    const rows = scoped
      .filter((i) => kinds.size === 0 || kinds.has(i.item_type))
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id));
    for (const i of rows) {
      if (isLate(i, todayIso)) g.late.push(i);
      else if (i.due_date <= weekEnd) g.week.push(i);
      else g.later.push(i);
    }
    return g;
  }, [scoped, kinds, todayIso]);
  const shownTotal = groups.late.length + groups.week.length + groups.later.length;
  const lateAll = useMemo(() => scoped.filter((i) => isLate(i, todayIso)).length, [scoped, todayIso]);

  const pkLate = pk.filter((i) => i.priority != null && i.due_date < todayIso).length;

  function row(i: DealerItem) {
    const late = isLate(i, todayIso);
    const tier = tierOf(i.account_id);
    const owner = names.get(i.owner_id) ?? "Someone";
    const enteredBy =
      i.entered_by && i.entered_by !== i.owner_id ? (names.get(i.entered_by) ?? "someone") : null;
    const name = i.account ? displayAccountName(i.account.name) : null;
    const gap = daysBetween(todayIso, i.due_date);
    const body = (
      <>
        <span className="dl-owe-when" data-late={late || undefined}>
          <b>{monthDay(i.due_date)}</b>
          <small>{late ? `${-gap}d late` : gap === 0 ? "today" : `in ${gap}d`}</small>
        </span>
        <span className="dl-owe-dealer">
          <b>{name ?? "No dealer"}</b>
          {tier && (
            <span className="dl-tier" data-tier={tier}>
              {tier}
            </span>
          )}
        </span>
        <span className="dl-owe-what">{i.action}</span>
        <span className="dl-owe-kind" data-kind={i.item_type}>
          {ITEM_TYPE_LABEL[i.item_type]}
        </span>
        <span className="dl-owe-who">
          {owner}
          {enteredBy && <small>entered by {enteredBy}</small>}
        </span>
      </>
    );
    return (
      <li key={i.id}>
        {i.account_id ? (
          <button
            type="button"
            className="dl-owe-row"
            onClick={() => onOpen(i.account_id as string, name ?? "")}
          >
            {body}
          </button>
        ) : (
          <div className="dl-owe-row">{body}</div>
        )}
      </li>
    );
  }

  return (
    <section className="adapt card dl-todos" data-desk="todos" data-span={span}>
      <div className="dl-owe-head">
        <div className="dl-owe-title">
          <span className="t-title">What we owe dealers</span>
          <span className="t-hint">
            {owed.length === 0
              ? "nothing open"
              : `${QTY.format(scoped.length)} open${lateAll > 0 ? ` · ${QTY.format(lateAll)} late` : ""}`}
          </span>
        </div>
        <button type="button" className="pk-btn dl-owe-add" onClick={() => setAdding((a) => !a)}>
          {adding ? "Close" : "+ Add"}
        </button>
      </div>

      {adding && <DealerItemForm onDone={() => setAdding(false)} onSaved={onAdded} />}

      {owed.length > 0 && (
        <div className="dl-owe-filters">
          <CheckMenu
            label="Kind"
            allLabel="All kinds"
            manyLabel={(n) => `${n} kinds`}
            options={ITEM_TYPES.filter((t) => (counts.get(t) ?? 0) > 0 || kinds.has(t)).map((t) => ({
              value: t,
              label: ITEM_TYPE_LABEL[t],
              count: counts.get(t) ?? 0,
            }))}
            picked={kinds}
            onChange={setKinds}
          />
          <CheckMenu
            label="Whose"
            allLabel="Everyone"
            manyLabel={(n) => `${n} people`}
            options={[
              ...(myId ? [{ value: myId, label: "Mine" }] : []),
              ...people.map((p) => ({ value: p.id, label: p.name })),
            ]}
            picked={whos}
            onChange={setWhos}
          />
        </div>
      )}

      {shownTotal === 0 ? (
        <p className="t-sub dl-todos-empty">
          {owed.length === 0
            ? "Nothing is owed to any dealer. A to-do lands here when a visit note, Say it or + Add sets one."
            : "Nothing matches these filters."}
        </p>
      ) : (
        GROUPS.map((g) => {
          const list = groups[g];
          if (list.length === 0) return null;
          const cut = g === "later" && !allLater ? list.slice(0, LATER_SHOWN) : list;
          return (
            <div key={g} className="dl-owe-group" data-group={g}>
              <p className="dl-owe-label">
                {GROUP_LABEL[g]} <span>{QTY.format(list.length)}</span>
              </p>
              <ul className="dl-owe-list">{cut.map(row)}</ul>
              {cut.length < list.length && (
                <button type="button" className="t-action dl-owe-more" onClick={() => setAllLater(true)}>
                  Show the other {QTY.format(list.length - cut.length)}
                </button>
              )}
            </div>
          );
        })
      )}

      {pk.length > 0 && (
        <Link href="/dealers/pk" className="dl-owe-pk">
          <span>
            {QTY.format(pk.length)} PK {pk.length === 1 ? "follow-up" : "follow-ups"}
            {pkLate > 0 && (
              <>
                {" · "}
                <b>
                  {QTY.format(pkLate)} {pkLate === 1 ? "alert" : "alerts"} passed
                </b>
              </>
            )}
          </span>
          <span>Open PK follow-up →</span>
        </Link>
      )}
    </section>
  );
}
