"use client";

// ONE PK ON THE BOARD: the band (dealer, PK date, place, how far along, what
// is late, what is new) and, unfolded, its follow-up rows — then a one-line
// "+ Add action" for something that came up after the visit.
//
// A row reads left to right the way the PK Control board did (spec §3):
// the action and its subtasks · Status · the latest note ·
// priority · the deadline · the owner. Both statuses fill their whole
// cell, which is the look the client asked to keep. A row opens the item
// (onOpen); this file never writes.

import { useMemo, useState, type CSSProperties } from "react";
import { initialsOf, rosterHues } from "@/lib/format";
import { ChevronDownIcon } from "@/components/icons";
import { deadlineLabel } from "@/lib/domain/deadline";
import { givesWorkToOthers } from "@/lib/domain/roles";
import {
  bandOrigin,
  daysOpen,
  PRIORITY_LABEL,
  PROGRESS_LABEL,
  daysToAlert,
  isAlertPassed,
  shownPriority,
  subtaskBar,
  type PkBand,
  type PkItem,
  type PkNote,
  type PkSubtask,
} from "@/lib/domain/pk-follow-up";

/** 'YYYY-MM-DD' → "Oct 22". Calendar only; the clock is never read here. */
export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const PROGRESS_TONE = {
  NOT_STARTED: "not-started",
  WORKING_ON_IT: "working",
  WAITING: "waiting",
  STUCK: "stuck",
  DONE: "done",
} as const;

export interface BandFacts {
  /** 0..1, or null when nothing in the band counts (all Eliminate, or empty). */
  progress: number | null;
  alertsPassed: number;
  unread: number;
}

export interface RowFacts {
  notes: PkNote[];
  subtasks: PkSubtask[];
  unread: boolean;
}

export function PkBandView({
  band,
  hue,
  facts,
  rows,
  rowFacts,
  names,
  roles,
  todayIso,
  folded,
  filtered,
  canAdd = true,
  scopeNote = null,
  onToggle,
  onOpen,
  onAdd,
}: {
  band: PkBand;
  /** 1..3 — the band colour, by position, as in the mockup. */
  hue: number;
  facts: BandFacts;
  /** The items the filters let through, in reading order. */
  rows: PkItem[];
  rowFacts: (id: string) => RowFacts;
  names: Map<string, string>;
  /** Membership roles: the owner's decides Plan or Delegate on the tag. */
  roles?: Map<string, string>;
  todayIso: string;
  folded: boolean;
  /** True when search, owner, status or "Unread only" is narrowing the list. */
  filtered: boolean;
  /** "+ Add action" at the foot: the desk, or the rep who ran the PK. */
  canAdd?: boolean;
  /** Under the head when the reader sees only part of the PK. */
  scopeNote?: string | null;
  onToggle: () => void;
  onOpen: (itemId: string) => void;
  onAdd: (activityId: string, action: string) => void;
}) {
  const [draft, setDraft] = useState("");
  // Same roster, same colour per person on every band.
  const hues = useMemo(() => rosterHues(names), [names]);
  const pct = facts.progress === null ? null : Math.round(facts.progress * 100);
  // Eliminate is on the board but out of the count, as it is out of the %.
  const total = band.items.filter((i) => i.priority !== "ELIMINATE").length;

  function add() {
    const text = draft.trim();
    if (!text) return;
    onAdd(band.activityId, text);
    setDraft("");
  }

  return (
    <div className="pk-band" data-hue={hue}>
      <button
        type="button"
        className="pk-band-head"
        aria-expanded={!folded}
        onClick={onToggle}
      >
        <ChevronDownIcon size={12} className="pk-chev" />
        <span className="pk-band-name">{band.dealer}</span>
        <span className="pk-band-pk">
          {bandOrigin(band, shortDate)}
          {band.location ? ` · ${band.location}` : ""}
        </span>
        <span className="pk-band-meta">
          {total} {total === 1 ? "action" : "actions"}
        </span>
        {pct !== null && (
          <>
            <span className="pk-meter" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </span>
            <span className="pk-band-meta">{pct}% done</span>
          </>
        )}
        {facts.alertsPassed > 0 && (
          <span className="pk-flag" data-tone="late">
            {facts.alertsPassed} {facts.alertsPassed === 1 ? "alert" : "alerts"} passed
          </span>
        )}
        {facts.unread > 0 && (
          <span className="pk-flag" data-tone="new">
            {facts.unread} new
          </span>
        )}
      </button>

      {!folded && (
        <>
          {scopeNote && <p className="pk-foot pk-scope">{scopeNote}</p>}
          {rows.map((i) => (
            <PkRow
              key={i.id}
              item={i}
              facts={rowFacts(i.id)}
              owner={names.get(i.owner_id) ?? "Someone"}
              ownerHue={hues.get(i.owner_id)}
              ownerGivesWork={givesWorkToOthers(roles?.get(i.owner_id))}
              todayIso={todayIso}
              onOpen={onOpen}
            />
          ))}
          {rows.length === 0 && (
            <p className="pk-foot pk-empty">
              {band.items.length === 0
                ? band.kind === "dealer"
                  ? "No tasks here yet."
                  : "No follow-ups from this PK yet."
                : filtered
                  ? "No actions here match the filters."
                  : "Everything here is done · tick Show done to see it."}
            </p>
          )}
          {canAdd && (
          <form
            className="pk-foot pk-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input
              className="pk-add-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="+ Add action"
              aria-label={`Add an action to ${band.kind === "dealer" ? "" : "the PK at "}${band.dealer}`}
            />
            {draft.trim() && (
              <button type="submit" className="pk-btn">
                Add
              </button>
            )}
          </form>
          )}
        </>
      )}
    </div>
  );
}

function PkRow({
  item,
  facts,
  owner,
  ownerHue,
  ownerGivesWork,
  todayIso,
  onOpen,
}: {
  item: PkItem;
  facts: RowFacts;
  owner: string;
  ownerHue: string | undefined;
  ownerGivesWork: boolean;
  todayIso: string;
  onOpen: (itemId: string) => void;
}) {
  const subsDone = facts.subtasks.filter((s) => s.done_at !== null).length;
  const bar = subtaskBar(item.progress, facts.subtasks);
  const latest = facts.notes[facts.notes.length - 1];
  const passed = isAlertPassed(item, todayIso);
  const days = daysToAlert(item, todayIso);
  const open = daysOpen(item, todayIso);
  // The tag follows the deadline once Important? is answered (shownPriority).
  const shown = shownPriority(item, todayIso, ownerGivesWork);
  const hint = shown === "ELIMINATE" && item.priority !== "ELIMINATE";

  return (
    <button
      type="button"
      className="pk-row"
      data-eliminated={item.priority === "ELIMINATE" || undefined}
      onClick={() => onOpen(item.id)}
    >
      <span className="pk-c pk-task">
        <span className="pk-task-text">{item.action}</span>
        {facts.subtasks.length > 0 && (
          <span className="pk-sub" title="Subtasks done">
            {subsDone}/{facts.subtasks.length}
          </span>
        )}
      </span>
      <span
        className="pk-cell"
        data-progress={PROGRESS_TONE[item.progress]}
        data-bar={bar ? "" : undefined}
        style={bar ? ({ "--pk-pct": `${bar.pct}%` } as CSSProperties) : undefined}
        title={bar ? `${bar.done} of ${bar.total} subtasks done` : undefined}
      >
        {PROGRESS_LABEL[item.progress]}
        {bar && <> · {bar.pct}%</>}
      </span>
      <span className="pk-c pk-note">
        <span
          className="pk-dot"
          data-unread={facts.unread || undefined}
          title={facts.unread ? "Changed since you last opened it" : "Seen"}
        />
        {facts.unread && <span className="sr-only">Unread.</span>}
        {latest ? (
          <span className="pk-note-text">{latest.body}</span>
        ) : (
          <span className="pk-note-text pk-quiet">No notes yet</span>
        )}
        {/* Beside the count, not in the text: the two-line clamp would cut it. */}
        {latest && latest.edited_at !== null && <span className="pk-edited">edited</span>}
        {facts.notes.length > 0 && (
          <span className="pk-count" title="Notes">
            {facts.notes.length}
          </span>
        )}
      </span>
      <span className="pk-c">
        {shown ? (
          // Only the chip: the deadline column says the date and how far off it is.
          <span className="pk-prio" data-priority={shown}>
            {PRIORITY_LABEL[shown]}
            {hint ? "?" : ""}
          </span>
        ) : (
          <span className="pk-quiet">No priority</span>
        )}
      </span>
      <span className="pk-c pk-alert" data-passed={passed || undefined}>
        {days === null ? (
          <small>—</small>
        ) : (
          <>
            <b>{shortDate(item.due_date)}</b>
            <small>{deadlineLabel(item.due_date, todayIso).text}</small>
          </>
        )}
      </span>
      {/* How long it has sat there (Andre, 2026-11-13). */}
      <span className="pk-c pk-open" title="Days since it was written">
        {open === null ? (
          <small>—</small>
        ) : (
          <>
            <b>{open}</b>
            <small>{open === 1 ? "day open" : "days open"}</small>
          </>
        )}
      </span>
      <span className="pk-c pk-owner">
        {/* Initials in a circle (Andre, 11-10); the full name for hover and
            screen readers. */}
        <i
          className="pk-ini"
          title={owner}
          aria-label={`Owner: ${owner}`}
          style={{ "--rep-hue": ownerHue ?? "var(--cat-rest)" } as CSSProperties}
        >
          {initialsOf(owner)}
        </i>
      </span>
    </button>
  );
}
