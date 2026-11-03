"use client";

// ONE PK FOLLOW-UP, OPENED (spec 2026-11-02 §3, the approved mockup). It sits
// beside the board on the desk and over it below that, and reads top to
// bottom in the order the desk moves an item on:
//   · whose ball it is and how far along (the two statuses);
//   · the priority and its days, with the alert worked out in words —
//     "Alert: PK Oct 20 + 2 days = Oct 22 · deadline passed";
//   · the subtasks (pk-subtasks.tsx) and the notes log (pk-notes-log.tsx);
//   · who has seen it, and when.
//
// Opening it marks it read for me. The statuses and the priority go through
// the outbox like every other to-do edit, one at a time — each waits for the
// one before to land, so it carries the row's newest updated_at (D61) — and
// the board moves at once (use-pk-item-writes.ts).

import { useEffect, useRef, useState } from "react";
import {
  PkNotesLog,
  stampOf,
  type NoteVersion,
} from "@/components/pk-notes-log";
import { PkSubtasks } from "@/components/pk-subtasks";
import { shortDate } from "@/components/pk-band";
import { useOffline } from "@/components/offline-provider";
import { usePkItemWrites } from "@/components/use-pk-item-writes";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  PROGRESS_LABEL,
  alertDate,
  priorityPatch,
  trapTarget,
  type PkBand,
  type PkItem,
  type PkNote,
  type PkRead,
  type PkSubtask,
  type Priority,
  type Progress,
} from "@/lib/domain/pk-follow-up";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Update<T> = (fn: (list: T[]) => T[]) => void;

const PROGRESS_OPTIONS = Object.keys(PROGRESS_LABEL) as Progress[];
const PROGRESS_TONE = {
  NOT_STARTED: "not-started",
  WORKING_ON_IT: "working",
  WAITING: "waiting",
  STUCK: "stuck",
  DONE: "done",
} as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function daysBetween(from: string, to: string): number {
  const t = (s: string) =>
    Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(to) - t(from)) / 86_400_000);
}

/** The alert in words, or why there is none. */
function alertLine(
  item: PkItem,
  pkDate: string,
  days: number | null,
  todayIso: string,
): { text: string; passed: boolean } {
  if (item.priority === null)
    return { text: "Set a priority to get an alert", passed: false };
  if (item.priority === "ELIMINATE")
    return { text: "No alert — Eliminate", passed: false };
  if (days === null)
    return {
      text: "Type the days after the PK to get an alert",
      passed: false,
    };
  const at = alertDate(pkDate, days);
  const sum = `Alert: PK ${shortDate(pkDate)} + ${days} ${days === 1 ? "day" : "days"} = ${shortDate(at)}`;
  if (item.completed_at !== null)
    return { text: `${sum} · done`, passed: false };
  const left = daysBetween(todayIso, at);
  if (left < 0) return { text: `${sum} · deadline passed`, passed: true };
  if (left === 0) return { text: `${sum} · today`, passed: false };
  return {
    text: `${sum} · in ${left} ${left === 1 ? "day" : "days"}`,
    passed: false,
  };
}

export function PkItemDrawer({
  item,
  band,
  notes,
  versionsByNote,
  subtasks,
  reads,
  names,
  desk,
  me,
  todayIso,
  readOnly = false,
  onItem,
  onNotes,
  onSubtasks,
  onReads,
  onChanged,
  onClose,
}: {
  item: PkItem;
  band: PkBand;
  /** This item's notes, oldest first. */
  notes: PkNote[];
  versionsByNote: Map<string, NoteVersion[]>;
  /** This item's subtasks, in order. */
  subtasks: PkSubtask[];
  /** Every read row on this item. */
  reads: PkRead[];
  names: Map<string, string>;
  /** The desk's members, who are listed under "Seen" even before they read it. */
  desk: string[];
  /** My membership id. */
  me: string;
  todayIso: string;
  /**
   * Someone else's item in my PK (spec 2026-11-03 §2): status, priority and
   * days show as text, subtasks without boxes; notes and "Seen" work as usual.
   */
  readOnly?: boolean;
  /** The item as it now stands (an optimistic edit, or the saved row). */
  onItem: (next: PkItem) => void;
  onNotes: Update<PkNote>;
  onSubtasks: Update<PkSubtask>;
  onReads: Update<PkRead>;
  /** Re-reads this item and what hangs off it; resolves with the saved row. */
  onChanged: () => Promise<PkItem | null>;
  onClose: () => void;
}) {
  const { profile } = useOffline();
  const orgId = profile?.orgId ?? "";
  const [readFailed, setReadFailed] = useState(false);

  // ── OPENING IT IS READING IT ─────────────────────────────────────────────
  useEffect(() => {
    if (!me || !orgId) return;
    const row = {
      membership_id: me,
      next_action_id: item.id,
      last_read_at: new Date().toISOString(),
    };
    const mineOf = (r: PkRead) =>
      r.membership_id === me && r.next_action_id === item.id;
    const prior = reads.find(mineOf);
    // The dot goes at once; the server row follows. If it does not land, the
    // dot comes back and the reader is told.
    onReads((list) => [...list.filter((r) => !mineOf(r)), row]);
    void getSupabaseBrowserClient()
      .from("next_action_reads")
      .upsert(
        { org_id: orgId, ...row },
        { onConflict: "membership_id,next_action_id" },
      )
      .then(({ error }) => {
        if (!error) return;
        onReads((list) => [
          ...list.filter((r) => !mineOf(r)),
          ...(prior ? [prior] : []),
        ]);
        setReadFailed(true);
      });
    // Once per opening: the item's id, not its every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, me, orgId]);

  // ── ESCAPE, AND FOCUS ON OPEN ────────────────────────────────────────────
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // The page behind stays put while the panel is open; closing hands focus
    // back to the row that opened it.
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const root = document.documentElement;
    const priorOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      root.style.overflow = priorOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  // The panel is modal: Tab and Shift+Tab go round inside it and never reach
  // the board, the toolbar or the top bar behind.
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !asideRef.current) return;
      const inside = Array.from(
        asideRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.getClientRects().length > 0);
      const at = inside.indexOf(document.activeElement as HTMLElement);
      const next = trapTarget(inside.length, at, e.shiftKey);
      if (next === null) return;
      e.preventDefault();
      inside[next].focus();
    };
    window.addEventListener("keydown", onTab);
    return () => window.removeEventListener("keydown", onTab);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape in a box is the typist's, not the drawer's (as in the dealer sheet).
      const t = e.target as HTMLElement | null;
      if (
        t?.closest(
          "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
        )
      )
        return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── STATUS AND PRIORITY, THROUGH THE OUTBOX (use-pk-item-writes.ts) ──────
  const { write, refreshInTurn, writeNote } = usePkItemWrites({
    item,
    me,
    onItem,
    onChanged,
  });

  // The days box: the typed value drives the alert line; it is written when
  // the reader leaves the box or presses Enter.
  const [daysDraft, setDaysDraft] = useState<string | null>(null);
  const typed =
    daysDraft !== null && /^\d{1,3}$/.test(daysDraft.trim())
      ? Number(daysDraft.trim())
      : null;
  const shownDays = daysDraft !== null ? typed : item.priority_days;
  const live = item.priority !== null && item.priority !== "ELIMINATE";

  function commitDays() {
    if (daysDraft === null) return;
    setDaysDraft(null);
    if (!live || typed === null || typed === item.priority_days) return;
    write(priorityPatch(band.pkDate, item.priority as Priority, typed));
  }

  const alert = alertLine(item, band.pkDate, shownDays, todayIso);

  // ── WHO HAS SEEN IT ──────────────────────────────────────────────────────
  const readBy = new Map(
    reads.map((r) => [r.membership_id, r.last_read_at] as const),
  );
  const people = [...new Set([...desk, item.owner_id, ...readBy.keys()])];
  const seen = people
    .filter((id) => readBy.has(id))
    .sort((a, b) =>
      (readBy.get(b) as string).localeCompare(readBy.get(a) as string),
    );
  const notYet = people
    .filter((id) => !readBy.has(id))
    .sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? ""));
  const who = (id: string) =>
    `${names.get(id) ?? "Someone"}${id === me ? " (you)" : ""}`;

  return (
    <>
      <div className="pkd-scrim" aria-hidden="true" onClick={onClose} />
      <aside
        ref={asideRef}
        className="pkd"
        aria-label={item.action}
        role="dialog"
        aria-modal="true"
      >
        <header className="pkd-head">
          <div className="pkd-head-text">
            <p className="pkd-crumb">
              {band.dealer} · PK {shortDate(band.pkDate)}
              {band.location ? ` · ${band.location}` : ""}
            </p>
            <h2 className="pkd-title">{item.action}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="pkd-x"
            aria-label="Close"
            onClick={onClose}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="pkd-body">
          {readOnly ? (
            <>
              <p className="pkd-owned">
                Owned by <b>{names.get(item.owner_id) ?? "someone else"}</b>. Only they or the desk
                move it on; you can add a note.
              </p>
              <dl className="pkd-ro">
                <div>
                  <dt className="pkd-lbl">Status</dt>
                  <dd>
                    <span className="pkd-ro-chip" data-progress={PROGRESS_TONE[item.progress]}>
                      {PROGRESS_LABEL[item.progress]}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="pkd-lbl">Priority</dt>
                  <dd>{item.priority ? PRIORITY_LABEL[item.priority] : "Not set"}</dd>
                </div>
                <div>
                  <dt className="pkd-lbl">Days after the PK</dt>
                  <dd>{item.priority_days ?? "—"}</dd>
                </div>
              </dl>
              <p className="pkd-calc" data-passed={alert.passed || undefined}>
                {alert.text}
              </p>
            </>
          ) : (
          <>
          <label className="pkd-field">
            <span className="pkd-lbl">Status</span>
            <select
              className="pkd-select"
              data-progress={PROGRESS_TONE[item.progress]}
              value={item.progress}
              onChange={(e) => write({ progress: e.target.value as Progress })}
            >
              {PROGRESS_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {PROGRESS_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="pkd-two">
              <label className="pkd-field">
                <span className="pkd-lbl">Priority</span>
                <select
                  className="pkd-select"
                  value={item.priority ?? ""}
                  onChange={(e) => {
                    setDaysDraft(null);
                    write(
                      priorityPatch(band.pkDate, e.target.value as Priority),
                    );
                  }}
                >
                  {item.priority === null && (
                    <option value="" disabled>
                      Set a priority
                    </option>
                  )}
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pkd-field">
                <span className="pkd-lbl">Days after the PK</span>
                <input
                  className="pkd-select pkd-days"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={365}
                  disabled={!live}
                  value={
                    daysDraft ??
                    (item.priority_days === null
                      ? ""
                      : String(item.priority_days))
                  }
                  onChange={(e) => setDaysDraft(e.target.value)}
                  onBlur={commitDays}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitDays();
                    if (e.key === "Escape") setDaysDraft(null);
                  }}
                />
              </label>
            </div>
            <p className="pkd-calc" data-passed={alert.passed || undefined}>
              {alert.text}
            </p>
          </div>
          </>
          )}

          {readFailed && (
            <p className="pkd-error" role="alert">
              This item was not marked as read — it will show as new again next
              time.
            </p>
          )}
          {writeNote && (
            <p className="pkd-error" role="alert">
              {writeNote}
            </p>
          )}

          <PkSubtasks
            itemId={item.id}
            orgId={orgId}
            subtasks={subtasks}
            onSubtasks={onSubtasks}
            readOnly={readOnly}
          />

          <PkNotesLog
            itemId={item.id}
            orgId={orgId}
            notes={notes}
            versionsByNote={versionsByNote}
            names={names}
            me={me}
            onNotes={onNotes}
            onEdited={refreshInTurn}
          />

          <section>
            <h3 className="pkd-lbl">Seen</h3>
            <ul className="pkd-seen">
              {seen.map((id) => (
                <li key={id}>
                  <b>{who(id)}</b> ·{" "}
                  <span className="pkd-fig">
                    {stampOf(readBy.get(id) as string)}
                  </span>
                </li>
              ))}
              {notYet.map((id) => (
                <li key={id} className="pkd-quiet">
                  {who(id)} · Not viewed yet
                </li>
              ))}
            </ul>
          </section>

          <p className="pkd-crumb">
            Owner: {names.get(item.owner_id) ?? "Someone"}
          </p>
        </div>
      </aside>
    </>
  );
}
