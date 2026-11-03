"use client";

// ONE THING TO BOOK, as Say it reads it (lib/voice/command.ts): a visit, a
// call or a meeting, a to-do, or a quote — every field editable. Shared by
// Say it's own cards and the "Also to book" part of the debrief sheet (spec
// 2026-11-04-one-mic-design.md), so a booking looks and behaves the same
// whether it was said online and confirmed on the spot or written up later in
// Review.
//
// Two modes:
//   · "confirm" — its own button, which writes it at once (Say it);
//   · "include" — a checkbox, and the sheet writes it on Save (Review).
// A quote always keeps its button: it opens the quote builder on the account.

import { CheckIcon } from "@/components/icons";
import { formatTime, timedFields } from "@/lib/domain/commitments";
import { VISIT_OBJECTIVES, humanize, type VisitObjective } from "@/lib/domain/enums";
import type { Command, CommandRep, CommandTeammate, FollowUpType } from "@/lib/voice/command";

export interface BookingCardState extends Command {
  key: string;
  done: boolean;
  /** "include" mode: written on Save when checked. */
  include?: boolean;
}

const KIND_LABEL: Record<Command["kind"], string> = {
  VISIT: "Visit",
  FOLLOW_UP: "Follow-up",
  QUOTE: "Quote",
};

const FOLLOW_UP_LABEL: Record<FollowUpType, string> = {
  CALL: "Call",
  MEETING: "Meeting",
  TASK: "To-do",
};

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Where a card lands (2026-11-04): a visit always on the agenda; a call or a
 * meeting on the agenda when it has a time, else on the routine list as a
 * to-do — the rep's rule, "sem hora, continua como pendência".
 */
export function lands(c: Pick<Command, "kind" | "followUpType" | "time">): "agenda" | "routine" | "quote" {
  if (c.kind === "QUOTE") return "quote";
  if (c.kind === "VISIT") return "agenda";
  return c.followUpType !== "TASK" && c.followUpType !== null && c.time ? "agenda" : "routine";
}

export function headLabel(c: Pick<Command, "kind" | "followUpType">): string {
  return c.kind === "FOLLOW_UP" && c.followUpType ? FOLLOW_UP_LABEL[c.followUpType] : KIND_LABEL[c.kind];
}

/** Why it cannot be written yet, in the rep's words; null when it can. */
export function bookingProblem(c: Command): string | null {
  if (c.kind === "QUOTE") return c.accountId ? null : "Which account is the quote for?";
  // A follow-up WITH a teammate ("call Bia") needs no account.
  const internal = c.kind === "FOLLOW_UP" && c.teammateId !== null;
  if (!c.accountId && !internal) return "Pick the account first.";
  if (!c.dueDate) return "Pick the day.";
  if (c.kind === "VISIT" && !c.objective) return "Every visit has a purpose — pick it.";
  if (!c.action.trim()) return "Say what it is.";
  return null;
}

/** The next_action a visit, call, meeting or to-do becomes. Not for a quote. */
export function bookingPayload(
  c: Command,
  ids: { id: string; orgId: string; membershipId: string },
): Record<string, unknown> {
  return {
    id: ids.id,
    org_id: ids.orgId,
    action: c.action.trim(),
    owner_id: c.ownerId ?? ids.membershipId,
    due_date: c.dueDate,
    account_id: c.accountId,
    source: "VOICE",
    ...(c.kind === "VISIT"
      ? { objective: c.objective, kind: "VISIT" as const, ...timedFields(c.time, "VISIT") }
      : {}),
    // A timed call or meeting is an agenda commitment; without a time it stays
    // a to-do and the database files it on the routine list.
    ...(c.kind === "FOLLOW_UP" && lands(c) === "agenda" && c.followUpType && c.followUpType !== "TASK"
      ? { kind: c.followUpType, ...timedFields(c.time, c.followUpType) }
      : {}),
  };
}

export function BookingCard({
  card,
  choices,
  reps,
  team,
  mode,
  onPatch,
  onConfirm,
}: {
  card: BookingCardState;
  choices: { id: string; name: string }[];
  reps: CommandRep[];
  team: CommandTeammate[];
  mode: "confirm" | "include";
  onPatch: (p: Partial<BookingCardState>) => void;
  /** "confirm" mode, and a quote in either mode. */
  onConfirm?: () => void;
}) {
  const c = card;
  const mate = c.teammateId ? team.find((t) => t.membershipId === c.teammateId) : undefined;
  const withButton = mode === "confirm" || c.kind === "QUOTE";
  return (
    <section className="card card-pad say-card" data-off={(mode === "include" && !c.include) || undefined}>
      <div className="say-card-head">
        <p className="t-meta uppercase tracking-wide">
          {headLabel(c)}
          {mate && <span className="say-mate"> · with {mate.name}</span>}
        </p>
        {c.dueDate && (
          <p className="t-meta">
            {DAY.format(new Date(`${c.dueDate}T12:00:00`))}
            {c.time && lands(c) === "agenda" ? ` · ${formatTime(c.time)}` : ""}
          </p>
        )}
      </div>
      {c.done ? (
        <p className="t-sub flex items-center gap-1.5">
          <CheckIcon size={16} />{" "}
          {lands(c) === "agenda" ? "On the agenda" : lands(c) === "quote" ? "Opened" : "On your routine list"} —{" "}
          {c.action}
        </p>
      ) : (
        <>
          <input
            className="field say-action"
            style={{ background: "var(--surface-page)" }}
            value={c.action}
            onChange={(e) => onPatch({ action: e.target.value })}
            aria-label={c.kind === "QUOTE" ? "What they want" : "What to do"}
          />
          <div className="say-fields">
            <select
              className="field"
              style={{ background: "var(--surface-page)" }}
              value={c.accountId ?? ""}
              onChange={(e) => onPatch({ accountId: e.target.value || null })}
              aria-label="Which account"
            >
              <option value="">
                {mate
                  ? `No account · with ${mate.name}`
                  : c.accountHeard
                    ? `Which account? (heard “${c.accountHeard}”)`
                    : "Which account?"}
              </option>
              {choices.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {c.kind !== "QUOTE" && (
              <input
                type="date"
                className="field"
                style={{ background: "var(--surface-page)" }}
                value={c.dueDate ?? ""}
                onChange={(e) => onPatch({ dueDate: e.target.value || null })}
                aria-label="Which day"
              />
            )}
            {c.kind === "FOLLOW_UP" && (
              <select
                className="field"
                style={{ background: "var(--surface-page)" }}
                value={c.followUpType ?? "TASK"}
                onChange={(e) => onPatch({ followUpType: e.target.value as FollowUpType })}
                aria-label="What it is"
              >
                <option value="CALL">Call</option>
                <option value="MEETING">Meeting</option>
                <option value="TASK">To-do</option>
              </select>
            )}
            {(c.kind === "VISIT" || (c.kind === "FOLLOW_UP" && c.followUpType !== "TASK")) && (
              <input
                type="time"
                className="field"
                style={{ background: "var(--surface-page)" }}
                value={c.time ?? ""}
                onChange={(e) => onPatch({ time: e.target.value || null })}
                aria-label={c.kind === "VISIT" ? "What time (optional)" : "What time"}
              />
            )}
            {c.kind === "VISIT" && (
              <select
                className="field"
                style={{ background: "var(--surface-page)" }}
                value={c.objective ?? ""}
                onChange={(e) => onPatch({ objective: (e.target.value || null) as VisitObjective | null })}
                aria-label="Why are you going"
              >
                <option value="">Why are you going?</option>
                {VISIT_OBJECTIVES.filter((o) => o !== "OTHER").map((o) => (
                  <option key={o} value={o}>
                    {humanize(o)}
                  </option>
                ))}
              </select>
            )}
            {reps.length > 0 && c.kind !== "QUOTE" && (
              <select
                className="field"
                style={{ background: "var(--surface-page)" }}
                value={c.ownerId ?? ""}
                onChange={(e) => onPatch({ ownerId: e.target.value || null })}
                aria-label="Whose is it"
              >
                <option value="">For me</option>
                {reps.map((r) => (
                  <option key={r.membershipId} value={r.membershipId}>
                    For {r.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {withButton ? (
            <button type="button" className="btn-primary say-go" onClick={onConfirm}>
              {c.kind === "VISIT"
                ? "Book it"
                : c.kind === "QUOTE"
                  ? "Draft the quote"
                  : lands(c) === "agenda"
                    ? "Put it on the agenda"
                    : "Add it"}
            </button>
          ) : (
            <label className="say-include">
              <input
                type="checkbox"
                checked={c.include ?? true}
                onChange={(e) => onPatch({ include: e.target.checked })}
              />
              {lands(c) === "agenda" ? "Put it on the agenda when I save" : "Add it to my list when I save"}
            </label>
          )}
        </>
      )}
    </section>
  );
}
