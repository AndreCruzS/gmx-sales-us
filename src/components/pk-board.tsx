"use client";

// THE PK FOLLOW-UP BOARD (spec 2026-11-02 §3, the approved mockup): what the
// desk owes after each PK, one band per PK, newest first.
//
// Top to bottom: the six figures (summarize), the toolbar (search, owner,
// Action required, "Unread only", "Show done"), then the bands. "Show done"
// off hides closed items (done, and Eliminate, which the database closes) —
// they still count in the band's %, which is worked out over the whole band,
// never over what the filters leave. Everything here is read-only: a row
// calls onOpen, the band's foot calls onAdd, and the page does the writing.

import { useMemo, useState, type ReactNode } from "react";
import { PkBandView } from "@/components/pk-band";
import {
  bandProgress,
  isAlertPassed,
  isUnread,
  summarize,
  type PkBand,
  type PkItem,
  type PkNote,
  type PkRead,
  type PkSubtask,
  type Required,
} from "@/lib/domain/pk-follow-up";

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** Open before closed, then the nearest alert, then by name. */
function rowOrder(a: PkItem, b: PkItem): number {
  const ca = a.completed_at === null ? 0 : 1;
  const cb = b.completed_at === null ? 0 : 1;
  return ca - cb || a.due_date.localeCompare(b.due_date) || a.action.localeCompare(b.action);
}

export function PkBoard({
  bands,
  notes,
  subtasks,
  reads,
  names,
  me,
  todayIso,
  onOpen,
  onAdd,
  actions,
}: {
  bands: PkBand[];
  notes: PkNote[];
  subtasks: PkSubtask[];
  reads: PkRead[];
  names: Map<string, string>;
  /** My membership id. */
  me: string;
  todayIso: string;
  onOpen: (itemId: string) => void;
  onAdd: (activityId: string, action: string) => void;
  /**
   * The toolbar's right end (the Excel export goes here). A function gets the
   * bands as the filters leave them: only the PKs with a row showing, and in
   * each only the rows showing.
   */
  actions?: ReactNode | ((visible: PkBand[]) => ReactNode);
}) {
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [required, setRequired] = useState<Required | "">("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());

  // ── WHAT EACH ITEM CARRIES ──────────────────────────────────────────────
  const notesBy = useMemo(() => {
    const m = groupBy(notes, (n) => n.next_action_id);
    for (const list of m.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return m;
  }, [notes]);
  const subsBy = useMemo(() => {
    const m = groupBy(subtasks, (s) => s.next_action_id);
    for (const list of m.values()) list.sort((a, b) => a.position - b.position);
    return m;
  }, [subtasks]);
  const myReads = useMemo(
    () => new Map(reads.filter((r) => r.membership_id === me).map((r) => [r.next_action_id, r] as const)),
    [reads, me],
  );
  const unreadIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of bands) {
      for (const i of b.items) {
        if (isUnread(i, notesBy.get(i.id) ?? [], myReads.get(i.id), me)) s.add(i.id);
      }
    }
    return s;
  }, [bands, notesBy, myReads, me]);

  const summary = useMemo(
    () => summarize(bands, (i) => unreadIds.has(i.id), todayIso),
    [bands, unreadIds, todayIso],
  );

  const owners = useMemo(() => {
    const ids = new Set<string>();
    for (const b of bands) for (const i of b.items) ids.add(i.owner_id);
    return [...ids]
      .map((id) => ({ id, name: names.get(id) ?? "Someone" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [bands, names]);

  // ── THE FILTERS ─────────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const narrowed = q !== "" || owner !== "" || required !== "" || unreadOnly;
  const passes = (b: PkBand, i: PkItem): boolean => {
    if (!showDone && i.completed_at !== null) return false;
    if (owner && i.owner_id !== owner) return false;
    if (required && i.action_required !== required) return false;
    if (unreadOnly && !unreadIds.has(i.id)) return false;
    if (q) {
      const hay = [i.action, b.dealer, ...(notesBy.get(i.id) ?? []).map((n) => n.body)]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  // What the filters leave, for the export: each PK with the rows showing.
  // A PK with no row left drops out once a filter is on.
  const visible = bands
    .map((b) => ({ ...b, items: b.items.filter((i) => passes(b, i)).sort(rowOrder) }))
    .filter((b) => b.items.length > 0 || !narrowed);

  const toggle = (id: string) =>
    setFolded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const figures: { k: string; v: number; s: string; bad?: boolean }[] = [
    { k: "PKs open", v: summary.pksOpen, s: "with something open" },
    { k: "Follow-ups", v: summary.followUps, s: "not done" },
    { k: "Alert passed", v: summary.alertPassed, s: "past PK date + days", bad: true },
    { k: "On us", v: summary.onUs, s: "pending action" },
    { k: "Waiting on them", v: summary.waiting, s: "awaiting response" },
    { k: "New for you", v: summary.newForMe, s: "since you last looked" },
  ];

  return (
    <>
      <section className="pk-summary" aria-label="PK follow-up in figures">
        {figures.map((f) => (
          <div key={f.k} className="pk-stat" data-bad={(f.bad && f.v > 0) || undefined}>
            <span className="pk-stat-k">{f.k}</span>
            <span className="pk-stat-v">{f.v}</span>
            <span className="pk-stat-s">{f.s}</span>
          </div>
        ))}
      </section>

      <section className="pk-tools" aria-label="Filters">
        <input
          type="search"
          className="pk-input pk-search"
          placeholder="Search actions, dealers and notes"
          aria-label="Search actions, dealers and notes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="pk-input"
          aria-label="Owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">Everyone</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select
          className="pk-input"
          aria-label="Action required"
          value={required}
          onChange={(e) => setRequired(e.target.value as Required | "")}
        >
          <option value="">Any action required</option>
          <option value="PENDING_ACTION">Pending action</option>
          <option value="AWAITING_RESPONSE">Awaiting response</option>
          <option value="NONE">No action required</option>
        </select>
        <label className="pk-toggle">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Unread only
        </label>
        <label className="pk-toggle">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show done
        </label>
        {actions && (
          <span className="pk-tools-end">{typeof actions === "function" ? actions(visible) : actions}</span>
        )}
      </section>

      {bands.length === 0 ? (
        <p className="t-sub">
          No PKs yet. A PK logged as a visit shows up here with the follow-ups taken on the day.
        </p>
      ) : (
        <div className="pk-board-wrap">
          <div className="pk-board" role="group" aria-label="Follow-ups by PK">
            <div className="pk-cols" aria-hidden="true">
              <span>Action</span>
              <span>Action required</span>
              <span>Status</span>
              <span>Latest note</span>
              <span>Priority</span>
              <span>Alert</span>
              <span>Owner</span>
            </div>
            {bands.map((b, n) => {
              const rows = b.items.filter((i) => passes(b, i)).sort(rowOrder);
              return (
                <PkBandView
                  key={b.activityId}
                  band={b}
                  hue={(n % 3) + 1}
                  facts={{
                    progress: bandProgress(b.items, b.items.flatMap((i) => subsBy.get(i.id) ?? [])),
                    alertsPassed: b.items.filter((i) => isAlertPassed(i, todayIso)).length,
                    // Open items only, as the summary's "New for you" counts them.
                    unread: b.items.filter((i) => i.completed_at === null && unreadIds.has(i.id)).length,
                  }}
                  rows={rows}
                  rowFacts={(id) => ({
                    notes: notesBy.get(id) ?? [],
                    subtasks: subsBy.get(id) ?? [],
                    unread: unreadIds.has(id),
                  })}
                  names={names}
                  todayIso={todayIso}
                  folded={folded.has(b.activityId)}
                  filtered={narrowed}
                  onToggle={() => toggle(b.activityId)}
                  onOpen={onOpen}
                  onAdd={onAdd}
                />
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
