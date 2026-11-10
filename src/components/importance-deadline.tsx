"use client";

// IMPORTANT? AND A DEADLINE (2026-11-10): the two answers a task needs. The
// person says whether it matters; the deadline says whether it is urgent (no
// more than 2 business days away, or past), and the priority follows from the
// two (deadline.ts). Shared by the PK drawer and the My work page.
//
// Every change emits the priority that may be STORED (storedPriority — never
// Eliminate). The tag shows the derived one; when that is Eliminate it is a
// question with its own button, the only way this control writes Eliminate.
// A suggestion is shown with Apply and is never saved without that tap.
//
// The date box keeps a draft while it is typed into: a typed year passes
// through "0002-…", "0020-…", and none of those may become a write. The draft
// is committed on blur or Enter, or at once when the native picker sets a
// whole date; only a real day in or after 2000 (isDeadlineDay) is.

import { useId, useRef, useState } from "react";
import {
  derivePriority,
  isDeadlineDay,
  isUrgent,
  storedPriority,
  urgentCap,
  deadlineLabel,
} from "@/lib/domain/deadline";
import { PRIORITY_LABEL, type Priority } from "@/lib/domain/pk-follow-up";

export interface ImportanceDeadlineChange {
  important?: boolean | null;
  due_date?: string;
  /** What to store: storedPriority(...), or ELIMINATE when the person confirms it. */
  priority: Priority | null;
}

export interface DeadlineSuggestion {
  important: boolean;
  due_date: string;
  reason: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 'YYYY-MM-DD' → "Thu Nov 12". Calendar only, at UTC noon so no zone moves it. */
export function weekdayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${DAYS[day]} ${MONTHS[m - 1]} ${d}`;
}

export function ImportanceDeadline({
  important,
  due,
  today,
  ownerGivesWork,
  stored = null,
  done = false,
  onChange,
  suggest,
}: {
  important: boolean | null;
  /** The deadline, 'YYYY-MM-DD'. */
  due: string;
  /** The device's local date (localIsoDate). */
  today: string;
  /** The OWNER's role gives work to others (admin/support): urgent and not important is Delegate. */
  ownerGivesWork: boolean;
  /** The priority saved now; an Eliminate already confirmed is not asked again. */
  stored?: Priority | null;
  /** The task is done: its deadline no longer runs. */
  done?: boolean;
  onChange: (p: ImportanceDeadlineChange) => void;
  suggest?: () => Promise<DeadlineSuggestion | null>;
}) {
  // A row whose date was cleared (the voice sheet) has no deadline yet.
  const hasDue = isDeadlineDay(due);
  const derived = hasDue ? derivePriority(important, due, today, ownerGivesWork) : null;
  const urgent = hasDue && isUrgent(due, today);
  const label = hasDue ? deadlineLabel(due, today) : null;
  const late = label !== null && label.late && !done;
  const eliminated = stored === "ELIMINATE";
  const askEliminate = derived === "ELIMINATE" && !eliminated && !done;
  const dateId = useId();

  // The date box's draft, reset whenever the saved deadline changes.
  const [draft, setDraft] = useState(due);
  const [draftOf, setDraftOf] = useState(due);
  if (draftOf !== due) {
    setDraftOf(due);
    setDraft(due);
  }
  // True while keys are moving the box: its changes wait for blur or Enter.
  const typing = useRef(false);

  const [guess, setGuess] = useState<
    | { state: "idle" }
    | { state: "asking" }
    | { state: "failed" }
    | ({ state: "ready" } & DeadlineSuggestion)
  >({ state: "idle" });

  function setImportant(v: boolean) {
    if (v === important) return;
    onChange({ important: v, priority: hasDue ? storedPriority(v, due, today, ownerGivesWork) : null });
  }

  function setDue(next: string) {
    if (!isDeadlineDay(next) || next === due) return;
    onChange({ due_date: next, priority: storedPriority(important, next, today, ownerGivesWork) });
  }

  // The draft becomes the deadline, or goes back to it when it is no day.
  function commit(v: string) {
    typing.current = false;
    if (isDeadlineDay(v)) setDue(v);
    else setDraft(due);
  }

  async function ask() {
    if (!suggest) return;
    setGuess({ state: "asking" });
    try {
      const s = await suggest();
      setGuess(s ? { state: "ready", ...s } : { state: "failed" });
    } catch {
      setGuess({ state: "failed" });
    }
  }

  function apply(s: DeadlineSuggestion) {
    onChange({
      important: s.important,
      due_date: s.due_date,
      priority: storedPriority(s.important, s.due_date, today, ownerGivesWork),
    });
    setGuess({ state: "idle" });
  }

  const tag = eliminated ? "ELIMINATE" : derived;

  return (
    <div className="idl">
      <div className="idl-row">
        <div className="idl-field" role="group" aria-label="Important?">
          <span className="idl-lbl" aria-hidden="true">
            Important?
          </span>
          <span className="idl-seg">
            <button
              type="button"
              className="idl-seg-btn"
              aria-pressed={important === true}
              onClick={() => setImportant(true)}
            >
              Yes
            </button>
            <button
              type="button"
              className="idl-seg-btn"
              aria-pressed={important === false}
              onClick={() => setImportant(false)}
            >
              No
            </button>
          </span>
        </div>
        <div className="idl-field">
          <label className="idl-lbl" htmlFor={dateId}>
            Deadline
          </label>
          <span className="idl-due">
            <input
              id={dateId}
              className="idl-date"
              type="date"
              value={draft}
              required
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit(e.currentTarget.value);
                } else {
                  typing.current = true;
                }
              }}
              onChange={(e) => {
                setDraft(e.target.value);
                // The native picker sets a whole date at once: save it now.
                if (!typing.current) commit(e.target.value);
              }}
              onBlur={(e) => commit(e.currentTarget.value)}
            />
            <button
              type="button"
              className="idl-urgent"
              aria-pressed={urgent}
              disabled={urgent}
              title="Deadline within 2 business days"
              onClick={() => setDue(urgentCap(hasDue ? due : null, today))}
            >
              Urgent
            </button>
          </span>
        </div>
      </div>

      <p className="idl-line" data-late={late || undefined}>
        {tag ? (
          <span className="pk-prio" data-priority={tag}>
            {PRIORITY_LABEL[tag]}
            {askEliminate ? "?" : ""}
          </span>
        ) : (
          <span className="idl-none">No priority</span>
        )}
        {label ? (
          <span className="idl-when">
            {weekdayDate(due)} · {done ? "done" : label.text}
          </span>
        ) : (
          <span className="idl-none">No deadline</span>
        )}
      </p>
      {important === null && (
        <p className="t-hint">Answer Important? and the priority follows the deadline.</p>
      )}

      {askEliminate && (
        <p className="idl-elim">
          <span>Not important and not urgent.</span>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => onChange({ priority: "ELIMINATE" })}
          >
            Eliminate
          </button>
        </p>
      )}

      {suggest && (
        <div className="idl-suggest">
          {guess.state === "ready" ? (
            <>
              <p className="idl-suggest-text">
                <strong>
                  Suggested: {guess.important ? "Important" : "Not important"} ·{" "}
                  <span className="idl-fig">{weekdayDate(guess.due_date)}</span>
                </strong>
                {guess.reason ? ` · ${guess.reason}` : ""}
              </p>
              {guess.important === important && guess.due_date === due ? (
                <span className="t-hint">Matches what is set</span>
              ) : (
                <span className="idl-suggest-acts">
                  <button type="button" className="t-action" onClick={() => apply(guess)}>
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
              onClick={() => void ask()}
            >
              {guess.state === "asking" ? "Weighing it…" : "Suggest"}
            </button>
          )}
          {guess.state === "failed" && (
            <span className="t-hint">No suggestion this time — try again.</span>
          )}
        </div>
      )}
    </div>
  );
}
