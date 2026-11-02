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
// the board moves at once: mirrorUpdate plays the database's trigger locally
// (Done and Eliminate close the item), then the saved row replaces it.

import { useEffect, useRef, useState } from "react";
import { PkNotesLog, stampOf, type NoteVersion } from "@/components/pk-notes-log";
import { PkSubtasks } from "@/components/pk-subtasks";
import { shortDate } from "@/components/pk-band";
import { useOffline } from "@/components/offline-provider";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  PROGRESS_LABEL,
  alertDate,
  mirrorUpdate,
  priorityPatch,
  type PkBand,
  type PkItem,
  type PkItemPatch,
  type PkNote,
  type PkRead,
  type PkSubtask,
  type Priority,
  type Progress,
  type Required,
} from "@/lib/domain/pk-follow-up";
import { getOfflineLayer } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Update<T> = (fn: (list: T[]) => T[]) => void;

const REQUIRED_OPTIONS: { v: Required; label: string }[] = [
  { v: "PENDING_ACTION", label: "Pending action" },
  { v: "AWAITING_RESPONSE", label: "Awaiting response" },
  { v: "NONE", label: "No action required" },
];
const PROGRESS_OPTIONS = Object.keys(PROGRESS_LABEL) as Progress[];
const REQUIRED_TONE = { PENDING_ACTION: "pending", AWAITING_RESPONSE: "awaiting", NONE: "none" } as const;
const PROGRESS_TONE = {
  NOT_STARTED: "not-started",
  WORKING_ON_IT: "working",
  STUCK: "stuck",
  DONE: "done",
} as const;

function daysBetween(from: string, to: string): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(to) - t(from)) / 86_400_000);
}

/** The alert in words, or why there is none. */
function alertLine(
  item: PkItem,
  pkDate: string,
  days: number | null,
  todayIso: string,
): { text: string; passed: boolean } {
  if (item.priority === null) return { text: "Set a priority to get an alert", passed: false };
  if (item.priority === "ELIMINATE") return { text: "No alert — Eliminate", passed: false };
  if (days === null) return { text: "Type the days after the PK to get an alert", passed: false };
  const at = alertDate(pkDate, days);
  const sum = `Alert: PK ${shortDate(pkDate)} + ${days} ${days === 1 ? "day" : "days"} = ${shortDate(at)}`;
  if (item.completed_at !== null) return { text: `${sum} · done`, passed: false };
  const left = daysBetween(todayIso, at);
  if (left < 0) return { text: `${sum} · deadline passed`, passed: true };
  if (left === 0) return { text: `${sum} · today`, passed: false };
  return { text: `${sum} · in ${left} ${left === 1 ? "day" : "days"}`, passed: false };
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

  // ── OPENING IT IS READING IT ─────────────────────────────────────────────
  useEffect(() => {
    if (!me || !orgId) return;
    const row = { membership_id: me, next_action_id: item.id, last_read_at: new Date().toISOString() };
    // The dot goes at once; the server row follows.
    onReads((list) => [...list.filter((r) => !(r.membership_id === me && r.next_action_id === item.id)), row]);
    // A builder only runs when it is awaited or then'd. A failed read costs
    // nothing but the dot coming back on the next load.
    void getSupabaseBrowserClient()
      .from("next_action_reads")
      .upsert({ org_id: orgId, ...row }, { onConflict: "membership_id,next_action_id" })
      .then(() => undefined);
    // Once per opening: the item's id, not its every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, me, orgId]);

  // ── ESCAPE, AND FOCUS ON OPEN ────────────────────────────────────────────
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape in a box is the typist's, not the drawer's (as in the dealer sheet).
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── STATUS AND PRIORITY, THROUGH THE OUTBOX ──────────────────────────────
  // The newest item and the newest saved updated_at, for writes queued behind
  // one another.
  const itemRef = useRef(item);
  const baseRef = useRef(item.updated_at);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  useEffect(() => {
    itemRef.current = item;
    if (inFlight.current === 0) baseRef.current = item.updated_at;
  }, [item]);
  const [writeNote, setWriteNote] = useState<string | null>(null);

  function write(patch: PkItemPatch) {
    const next = mirrorUpdate(itemRef.current, patch, me, new Date().toISOString());
    itemRef.current = next;
    onItem(next);
    inFlight.current += 1;
    chain.current = chain.current.then(async () => {
      try {
        const layer = getOfflineLayer();
        const seq = await layer.sync.enqueue({
          clientId: item.id,
          entityType: "next_action",
          op: "update",
          payload: { id: item.id, ...patch },
          baseVersion: baseRef.current, // D61
          blobRef: null,
        });
        await layer.sync.drain();
        const rejected = (await layer.local.listRejected()).some((r) => r.seq === seq);
        const saved = await onChanged();
        if (saved) {
          baseRef.current = saved.updated_at;
          itemRef.current = saved;
        }
        setWriteNote(
          rejected
            ? "That change was not saved — someone moved this item at the same time. It shows what is saved now."
            : saved === null
              ? "Saved on this device. It reaches the others when the connection is back."
              : null,
        );
      } catch {
        setWriteNote("That change could not be saved on this device. Try again.");
        void onChanged();
      } finally {
        inFlight.current -= 1;
      }
    });
  }

  // The days box: the typed value drives the alert line; it is written when
  // the reader leaves the box or presses Enter.
  const [daysDraft, setDaysDraft] = useState<string | null>(null);
  const typed = daysDraft !== null && /^\d{1,3}$/.test(daysDraft.trim()) ? Number(daysDraft.trim()) : null;
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
  const readBy = new Map(reads.map((r) => [r.membership_id, r.last_read_at] as const));
  const people = [...new Set([...desk, item.owner_id, ...readBy.keys()])];
  const seen = people
    .filter((id) => readBy.has(id))
    .sort((a, b) => (readBy.get(b) as string).localeCompare(readBy.get(a) as string));
  const notYet = people
    .filter((id) => !readBy.has(id))
    .sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? ""));
  const who = (id: string) => `${names.get(id) ?? "Someone"}${id === me ? " (you)" : ""}`;

  return (
    <aside className="pkd" aria-label={item.action}>
      <header className="pkd-head">
        <div className="pkd-head-text">
          <p className="pkd-crumb">
            {band.dealer} · PK {shortDate(band.pkDate)}
            {band.location ? ` · ${band.location}` : ""}
          </p>
          <h2 className="pkd-title">{item.action}</h2>
        </div>
        <button ref={closeRef} type="button" className="pkd-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="pkd-body">
        <div className="pkd-two">
          <label className="pkd-field">
            <span className="pkd-lbl">Action required</span>
            <select
              className="pkd-select"
              data-required={REQUIRED_TONE[item.action_required]}
              value={item.action_required}
              onChange={(e) => write({ action_required: e.target.value as Required })}
            >
              {REQUIRED_OPTIONS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
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
        </div>

        <div>
          <div className="pkd-two">
            <label className="pkd-field">
              <span className="pkd-lbl">Priority</span>
              <select
                className="pkd-select"
                value={item.priority ?? ""}
                onChange={(e) => {
                  setDaysDraft(null);
                  write(priorityPatch(band.pkDate, e.target.value as Priority));
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
                value={daysDraft ?? (item.priority_days === null ? "" : String(item.priority_days))}
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

        {writeNote && (
          <p className="pkd-error" role="alert">
            {writeNote}
          </p>
        )}

        <PkSubtasks itemId={item.id} orgId={orgId} subtasks={subtasks} onSubtasks={onSubtasks} />

        <PkNotesLog
          itemId={item.id}
          orgId={orgId}
          notes={notes}
          versionsByNote={versionsByNote}
          names={names}
          me={me}
          onNotes={onNotes}
          onEdited={() => void onChanged()}
        />

        <section>
          <h3 className="pkd-lbl">Seen</h3>
          <ul className="pkd-seen">
            {seen.map((id) => (
              <li key={id}>
                <b>{who(id)}</b> · <span className="pkd-fig">{stampOf(readBy.get(id) as string)}</span>
              </li>
            ))}
            {notYet.map((id) => (
              <li key={id} className="pkd-quiet">
                {who(id)} · Not viewed yet
              </li>
            ))}
          </ul>
        </section>

        <p className="pkd-crumb">Owner: {names.get(item.owner_id) ?? "Someone"}</p>
      </div>
    </aside>
  );
}
