"use client";

// THE PK FOLLOW-UP BOARD (spec 2026-11-02 §3, the approved mockup): what the
// desk owes after each PK, one band per PK, newest first.
//
// Top to bottom: the toolbar (search, owner, status, "Unread only", "Show
// done"), then the bands. Bianca asked for no figures strip on top (11-10).
// "Show done" off hides closed items (done, and Eliminate, which the database closes) —
// they still count in the band's %, which is worked out over the whole band,
// never over what the filters leave. Everything here is read-only: a row
// calls onOpen, the band's foot calls onAdd, and the page does the writing.

import { useMemo, useState, type ReactNode } from "react";
import { PkBandView } from "@/components/pk-band";
import {
  PROGRESS_LABEL,
  bandProgress,
  isOnUs,
  isAlertPassed,
  isUnread,
  firstNameOf,
  type PkBand,
  type PkItem,
  type PkNote,
  type PkRead,
  type PkSubtask,
  type Progress,
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
  roles = new Map(),
  me,
  desk = true,
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
  /** Membership roles: an owner who gives work to others gets Delegate. */
  roles?: Map<string, string>;
  /** My membership id. */
  me: string;
  /**
   * The desk (admin, manager, assistant) filters by any owner and adds to any
   * PK. A rep filters "Everyone · Mine" and adds only to a PK he ran
   * (spec 2026-11-03 §5).
   */
  desk?: boolean;
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
  const [status, setStatus] = useState<Progress | "ON_US" | "">("");
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

  const owners = useMemo(() => {
    const ids = new Set<string>();
    for (const b of bands) for (const i of b.items) ids.add(i.owner_id);
    return [...ids]
      .map((id) => ({ id, name: names.get(id) ?? "Someone" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [bands, names]);

  // ── THE FILTERS ─────────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const narrowed = q !== "" || owner !== "" || status !== "" || unreadOnly;
  const passes = (b: PkBand, i: PkItem): boolean => {
    if (!showDone && i.completed_at !== null) return false;
    if (owner && i.owner_id !== owner) return false;
    if (status === "ON_US" ? !isOnUs(i.progress) : status && i.progress !== status) return false;
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

  return (
    <>
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
          {desk ? (
            owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))
          ) : (
            <option value={me}>Mine</option>
          )}
        </select>
        <select
          className="pk-input"
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as Progress | "ON_US" | "")}
        >
          <option value="">Any status</option>
          <option value="ON_US">On us</option>
          <option value="NOT_STARTED">{PROGRESS_LABEL.NOT_STARTED}</option>
          <option value="WORKING_ON_IT">{PROGRESS_LABEL.WORKING_ON_IT}</option>
          <option value="WAITING">{PROGRESS_LABEL.WAITING}</option>
          <option value="STUCK">{PROGRESS_LABEL.STUCK}</option>
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
          {desk
            ? "No PKs yet. A PK logged as a visit shows up here with the follow-ups taken on the day."
            : "No PKs yet. A PK you log as a visit shows up here with its follow-ups."}
        </p>
      ) : (
        <div className="pk-board-wrap">
          <div className="pk-board" role="group" aria-label="Follow-ups by PK">
            <div className="pk-cols" aria-hidden="true">
              <span>Action</span>
              <span>Status</span>
              <span>Latest note</span>
              <span>Priority</span>
              <span>Deadline</span>
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
                    // Open items only, as the Home card's "new" counts them.
                    unread: b.items.filter((i) => i.completed_at === null && unreadIds.has(i.id)).length,
                  }}
                  rows={rows}
                  rowFacts={(id) => ({
                    notes: notesBy.get(id) ?? [],
                    subtasks: subsBy.get(id) ?? [],
                    unread: unreadIds.has(id),
                  })}
                  names={names}
                  roles={roles}
                  todayIso={todayIso}
                  folded={folded.has(b.activityId)}
                  filtered={narrowed}
                  canAdd={desk || b.ranBy === me}
                  scopeNote={
                    !desk && b.ranBy && b.ranBy !== me
                      ? `${firstNameOf(names.get(b.ranBy))}'s PK · only your follow-ups show here`
                      : null
                  }
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
