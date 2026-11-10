"use client";

// ONE PK FOLLOW-UP, OPENED (spec 2026-11-02 §3, the approved mockup). It sits
// beside the board on the desk and over it below that, and reads top to
// bottom in the order the desk moves an item on:
//   · whose ball it is and how far along (the two statuses);
//   · the priority, its days and the deadline, as the PK Control board had
//     them (kept on purpose, 2026-11-10), with the alert worked out in words —
//     "Alert: PK Oct 20 + 2 days = Thu Oct 22 · 2d late". The deadline rule runs
//     under them (pickPatch / deadlinePatch): the pick answers Important?, and
//     a deadline that comes within 2 business days moves the item to Do now;
//   · the subtasks (pk-subtasks.tsx) and the notes log (pk-notes-log.tsx);
//   · who has seen it, and when.
//
// Opening it marks it read for me. The status and the two answers go through
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
import { weekdayDate } from "@/components/importance-deadline";
import { shortDate } from "@/components/pk-band";
import { useOffline } from "@/components/offline-provider";
import { usePkItemWrites } from "@/components/use-pk-item-writes";
import { ViaAgent } from "@/components/via-agent";
import {
  deadlineLabel,
  derivePriority,
  isDeadlineDay,
  isUrgent,
  storedPriority,
} from "@/lib/domain/deadline";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  PROGRESS_LABEL,
  alertBase,
  alertDate,
  deadlinePatch,
  pickPatch,
  planPatch,
  shownPriority,
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

/** The deadline in words for the read-only view: "Deadline Thu Nov 12 · 2d late". */
function deadlineLine(item: PkItem, todayIso: string): { text: string; late: boolean } {
  const when = weekdayDate(item.due_date);
  if (item.completed_at !== null) return { text: `Deadline ${when} · done`, late: false };
  const l = deadlineLabel(item.due_date, todayIso);
  return { text: `Deadline ${when} · ${l.text}`, late: l.late };
}

interface Suggestion {
  important: boolean;
  due_date: string;
  priority: Priority | null;
  reason: string;
}

/** The alert in words, or why there is none: "Alert: PK Oct 20 + 2 days = Thu Oct 22 · 2d late". */
function alertLine(
  item: PkItem,
  pkDate: string,
  base: string,
  days: number | null,
  todayIso: string,
): { text: string; passed: boolean } {
  if (item.priority === null) return { text: "Set a priority to get an alert", passed: false };
  if (item.priority === "ELIMINATE") return { text: "No alert — Eliminate", passed: false };
  if (days === null) return { text: "Type the days to get an alert", passed: false };
  const at = alertDate(base, days);
  const from = base === pkDate ? `PK ${shortDate(pkDate)}` : `prioritised ${shortDate(base)}`;
  const sum = `Alert: ${from} + ${days} ${days === 1 ? "day" : "days"} = ${weekdayDate(at)}`;
  if (item.completed_at !== null) return { text: `${sum} · done`, passed: false };
  const l = deadlineLabel(at, todayIso);
  return { text: `${sum} · ${l.text}`, passed: l.late };
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
  ownerGivesWork,
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
  /** The item's OWNER gives work to others (admin/support): urgent and not
   *  important is Delegate for them, Plan for a rep. */
  ownerGivesWork: boolean;
  /**
   * Someone else's item in my PK (spec 2026-11-03 §2): status, Important?,
   * priority and deadline show as text, subtasks without boxes; notes and "Seen" work as usual.
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

  // ── PRIORITY · DAYS · DEADLINE (the PK Control structure) ───────────────
  // The days count from the base (alertBase: the PK, or the day an old PK's
  // item got its first priority). The Days box and the date box each keep a
  // draft and write on blur or Enter; the date picker writes at once.
  const base = alertBase(band.pkDate, item, todayIso);
  const live = item.priority !== null && item.priority !== "ELIMINATE";
  const [daysDraft, setDaysDraft] = useState<string | null>(null);
  const typedDays =
    daysDraft !== null && /^\d{1,3}$/.test(daysDraft.trim()) ? Number(daysDraft.trim()) : null;
  const shownDays = daysDraft !== null ? typedDays : item.priority_days;
  const [dateDraft, setDateDraft] = useState<string | null>(null);
  const dateTyping = useRef(false);

  function pick(p: Priority) {
    setDaysDraft(null);
    setDateDraft(null);
    write(pickPatch(p, base, todayIso, ownerGivesWork));
  }

  function moveDeadline(due: string) {
    if (!isDeadlineDay(due) || due === item.due_date) return;
    write(deadlinePatch(item, due, base, todayIso, ownerGivesWork));
  }

  function commitDays() {
    if (daysDraft === null) return;
    setDaysDraft(null);
    if (!live || typedDays === null || typedDays === item.priority_days) return;
    moveDeadline(alertDate(base, typedDays));
  }

  function commitDate(v: string) {
    dateTyping.current = false;
    setDateDraft(null);
    moveDeadline(v);
  }

  const alert = alertLine(item, band.pkDate, base, shownDays, todayIso);

  // ── SUGGEST (Bianca, 2026-11-03: the Eisenhower matrix) ─────────────────
  // The AI answers Important? and proposes a deadline with a reason; nothing is
  // written until the reader taps Apply. Held with the item it was asked for.
  const [asked, setAsked] = useState<{
    id: string;
    g: { state: "idle" } | { state: "asking" } | { state: "failed" } | ({ state: "ready" } & Suggestion);
  }>({ id: item.id, g: { state: "idle" } });
  const guess = asked.id === item.id ? asked.g : ({ state: "idle" } as const);
  const forItem = item.id;
  const setGuess = (g: typeof asked.g) => setAsked({ id: forItem, g });

  async function suggest() {
    setGuess({ state: "asking" });
    try {
      const s = await fetchSuggestion();
      setGuess(s ? { state: "ready", ...s } : { state: "failed" });
    } catch {
      setGuess({ state: "failed" });
    }
  }

  function applySuggestion(s: Suggestion) {
    setDaysDraft(null);
    setDateDraft(null);
    write(
      planPatch(
        item,
        {
          important: s.important,
          due_date: s.due_date,
          priority: storedPriority(s.important, s.due_date, todayIso, ownerGivesWork),
        },
        base,
      ),
    );
    setGuess({ state: "idle" });
  }

  async function fetchSuggestion(): Promise<Suggestion | null> {
    const res = await fetch("/api/pk/suggest-priority", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: item.action,
        dealer: band.dealer,
        pkDate: band.pkDate,
        dueDate: item.due_date,
        today: todayIso,
        kind: null,
        ownerGivesWork,
        notes: notes.map((n) => n.body).slice(-20),
        subtasks: subtasks.map((t) => t.title).slice(0, 30),
      }),
    });
    const j = (await res.json()) as Partial<Suggestion>;
    if (!res.ok || typeof j.important !== "boolean" || typeof j.due_date !== "string") return null;
    return {
      important: j.important,
      due_date: j.due_date,
      priority: derivePriority(j.important, j.due_date, todayIso, ownerGivesWork),
      reason: j.reason ?? "",
    };
  }

  const shown = shownPriority(item, todayIso, ownerGivesWork);
  const line = deadlineLine(item, todayIso);
  // The select shows what the board shows; an Eliminate hint is asked below it.
  const hintEliminate =
    shown === "ELIMINATE" && item.priority !== "ELIMINATE" && item.completed_at === null;
  const selectValue = hintEliminate ? item.priority : shown;
  // The deadline moved the item on its own (a Plan whose date came close).
  const moved =
    !hintEliminate &&
    shown !== null &&
    item.priority !== null &&
    shown !== item.priority &&
    item.completed_at === null;
  // A rep's item has no Delegate (unless it already holds one).
  const options = PRIORITIES.filter(
    (p) => p !== "DELEGATE" || ownerGivesWork || item.priority === "DELEGATE",
  );

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
            <ViaAgent via={item.created_via} />
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
                  <dd>
                    {shown
                      ? `${PRIORITY_LABEL[shown]}${shown === "ELIMINATE" && item.priority !== "ELIMINATE" ? "?" : ""}`
                      : "Not set"}
                  </dd>
                </div>
                <div>
                  <dt className="pkd-lbl">Days</dt>
                  <dd>{item.priority_days ?? "—"}</dd>
                </div>
              </dl>
              <p className="pkd-calc" data-passed={line.late || undefined}>
                {line.text}
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
            <div className="pkd-three">
              <label className="pkd-field">
                <span className="pkd-lbl">Priority</span>
                <select
                  className="pkd-select"
                  value={selectValue ?? ""}
                  onChange={(e) => pick(e.target.value as Priority)}
                >
                  {selectValue === null && (
                    <option value="" disabled>
                      Set a priority
                    </option>
                  )}
                  {options.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pkd-field">
                <span className="pkd-lbl">Days</span>
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
              <label className="pkd-field">
                <span className="pkd-lbl">Deadline</span>
                <input
                  className="pkd-select pkd-days"
                  type="date"
                  required
                  disabled={!live}
                  value={dateDraft ?? item.due_date}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitDate(e.currentTarget.value);
                    } else if (e.key === "Escape") {
                      dateTyping.current = false;
                      setDateDraft(null);
                    } else {
                      dateTyping.current = true;
                    }
                  }}
                  onChange={(e) => {
                    setDateDraft(e.target.value);
                    // The native picker sets a whole date at once: save it now.
                    if (!dateTyping.current) commitDate(e.target.value);
                  }}
                  onBlur={(e) => {
                    if (dateDraft !== null) commitDate(e.currentTarget.value);
                  }}
                />
              </label>
            </div>
            <p className="pkd-calc" data-passed={alert.passed || undefined}>
              {alert.text}
            </p>
            {moved && shown && (
              <p className="t-hint">
                Now {PRIORITY_LABEL[shown]}: the deadline is{" "}
                {isUrgent(item.due_date, todayIso)
                  ? "within 2 business days"
                  : "more than 2 business days away"}
                .
              </p>
            )}
            {hintEliminate && (
              <p className="idl-elim">
                <span>Not important and not urgent.</span>
                <button type="button" className="btn-quiet" onClick={() => pick("ELIMINATE")}>
                  Eliminate
                </button>
              </p>
            )}
            <div className="pkd-suggest">
              {guess.state === "ready" ? (
                <>
                  <p className="pkd-suggest-text">
                    <strong>
                      Suggested: {guess.priority ? PRIORITY_LABEL[guess.priority] : "—"} ·{" "}
                      {weekdayDate(guess.due_date)}
                    </strong>
                    {guess.reason ? ` — ${guess.reason}` : ""}
                  </p>
                  {guess.important === item.important && guess.due_date === item.due_date ? (
                    <span className="pkd-suggest-acts t-hint">Matches what is set</span>
                  ) : (
                    <span className="pkd-suggest-acts">
                      <button
                        type="button"
                        className="t-action"
                        onClick={() => applySuggestion(guess)}
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        className="btn-quiet"
                        onClick={() => setGuess({ state: "idle" })}
                      >
                        Dismiss
                      </button>
                    </span>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="t-action"
                  disabled={guess.state === "asking"}
                  onClick={() => void suggest()}
                >
                  {guess.state === "asking" ? "Weighing it…" : "Suggest priority"}
                </button>
              )}
              {guess.state === "failed" && (
                <span className="t-hint">No suggestion this time — try again.</span>
              )}
            </div>
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
