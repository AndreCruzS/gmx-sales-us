"use client";

// "Today & what's next" — the rep's day drawn as one line.
//
// The rail is the whole idea: each stop's segment is coloured by what is true
// of it, so the eye reads the day's shape before it reads a single word. A
// stop that owes a debrief sits above the NOW ring, because it is the one
// thing on this screen a rep can still put right today.

import Link from "next/link";
import { useState } from "react";
import { CalendarIcon, ChevronDownIcon, MicrophoneIcon } from "@/components/icons";
import { humanize } from "@/lib/domain/enums";
import { displayAccountName } from "@/lib/format";
import type { CachedAccount } from "@/lib/offline";
import type { DayTimeline, StopState, TimelineStop } from "@/lib/routine/day-timeline";

const PILL: Record<StopState, { cls: string; label: string }> = {
  done: { cls: "pill-done", label: "Done" },
  flagged: { cls: "pill-flagged", label: "Needs debrief" },
  planned: { cls: "pill-planned", label: "Planned" },
};

// The segment ABOVE a stop carries the state of what came before it, so the
// line changes colour where the day changes character.
function segAbove(prev: StopState | null): string {
  if (prev === null) return "is-off";
  return prev === "planned" ? "is-future" : `is-${prev}`;
}

// Shortcuts for the line, not outcomes. ACTIVITY_OUTCOMES is a commercial
// vocabulary (QUOTE_REQUESTED, SAMPLE_REQUESTED); "nobody available" is not one
// of those, and forcing it into that enum would corrupt the reporting it feeds.
const QUICK_LINES = ["Went well", "Rescheduled", "Nobody available"];

function Debrief({
  stop,
  account,
  onDebrief,
}: {
  stop: TimelineStop;
  account: CachedAccount | undefined;
  onDebrief: (stop: TimelineStop, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [logged, setLogged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // `logged` latches: the row usually unmounts on success, but a slow pull
    // would otherwise leave the button live long enough to file the same visit
    // twice — which is a duplicate activity, not a harmless retry.
    if (!note.trim() || busy || logged) return;
    setBusy(true);
    setError(null);
    try {
      await onDebrief(stop, note.trim());
      setLogged(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="debrief mt-2.5" onSubmit={submit}>
      <p className="debrief-prompt">
        {/* the same flag the demo flies over a stop that owes an answer */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 21V4l14 6-14 5" />
        </svg>
        This stop passed with nothing logged. How did it go?
      </p>
      <div className="mt-2 flex gap-2">
        <input
          className="field flex-1"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="One line — what happened?"
          aria-label={`What happened at ${account ? displayAccountName(account.name) : "this stop"}`}
          enterKeyHint="done"
        />
        {/* Talking is the other way in, and that one does belong on /record —
            it is a recorder, not a form. */}
        <Link
          href={`/record?visit=${stop.id}`}
          className="debrief-mic"
          aria-label="Talk instead of typing"
        >
          <MicrophoneIcon size={18} />
        </Link>
      </div>
      <div className="chip-row mt-2">
        {QUICK_LINES.map((q) => (
          <button
            key={q}
            type="button"
            className="chip"
            aria-pressed={note === q}
            onClick={() => setNote(note === q ? "" : q)}
          >
            {q}
          </button>
        ))}
      </div>
      {error && (
        <p className="t-sub mt-2" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        className="btn-log mt-2.5"
        disabled={!note.trim() || busy || logged}
      >
        {logged ? "Logged" : busy ? "Logging…" : "Log & continue"}
      </button>
    </form>
  );
}

function Stop({
  stop,
  prev,
  account,
  formatDay,
  onDebrief,
}: {
  stop: TimelineStop;
  prev: StopState | null;
  account: CachedAccount | undefined;
  formatDay: (iso: string) => string;
  onDebrief?: (stop: TimelineStop, note: string) => Promise<void>;
}) {
  const pill = PILL[stop.state];
  const below = stop.state === "planned" ? "is-future" : `is-${stop.state}`;
  return (
    <li className="spine-item">
      <div className="spine-rail" aria-hidden="true">
        <div className={`spine-seg ${segAbove(prev)}`} />
        <div className={`spine-node is-${stop.state}`} />
        <div className={`spine-seg ${below}`} />
      </div>
      <div className="spine-body">
        <Link
          href={stop.accountId ? `/accounts/${stop.accountId}` : "/visits"}
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
        >
          <span className="spine-time">{formatDay(stop.dueDate)}</span>
          <span className={`pill ${pill.cls}`}>{pill.label}</span>
          <span className="t-title w-full">
            {account ? displayAccountName(account.name) : stop.action}
          </span>
          {(stop.objective || account) && (
            <span className="t-sub w-full">
              {account ? stop.action : ""}
              {account && stop.objective ? " · " : ""}
              {/* the objective is an enum on the row; it is never shown raw */}
              {stop.objective ? humanize(stop.objective) : ""}
            </span>
          )}
        </Link>

        {/* The one state a rep can act on, answered where they are. Sending
            someone to another screen to type one line is the friction this
            app exists to remove. */}
        {stop.state === "flagged" && onDebrief && (
          <Debrief stop={stop} account={account} onDebrief={onDebrief} />
        )}
      </div>
    </li>
  );
}

export function DaySpine({
  timeline,
  accountsById,
  formatDay,
  nowLabel,
  onDebrief,
}: {
  timeline: DayTimeline;
  accountsById: Map<string, CachedAccount>;
  formatDay: (iso: string) => string;
  nowLabel: string;
  onDebrief?: (stop: TimelineStop, note: string) => Promise<void>;
}) {
  // Folded is the phone's opening state. Below 1024px the CSS hides the spine
  // and shows the summary; above it the whole line has room, and the same flag
  // is inert. Keeping it in a media query rather than in `useState` means the
  // component never has to ask the window how wide it is during a render.
  const [folded, setFolded] = useState(true);

  const { before, after, stops, done, needsDebrief } = timeline;
  if (stops === 0) return null;

  const lastBefore = before.length > 0 ? before[before.length - 1].state : null;

  // What the fold is allowed to show. A stop that owes a debrief outranks the
  // one that is merely next, because it is the only thing on this screen the
  // rep can still put right today.
  const nextUp =
    before.find((s) => s.state === "flagged") ??
    after[0] ??
    before[before.length - 1] ??
    null;
  const nextAccount = nextUp?.accountId ? accountsById.get(nextUp.accountId) : undefined;

  return (
    <section className={folded ? "is-folded" : undefined}>
      <p className="spine-label mb-1">The route</p>
      <div className="route-head">
        <h2 className="day-title">
          Today <span>&amp; what&rsquo;s next</span>
        </h2>
        <button
          type="button"
          className="route-toggle"
          aria-expanded={!folded}
          aria-controls="day-spine"
          aria-label={folded ? "Show the whole day" : "Fold the day away"}
          onClick={() => setFolded(!folded)}
        >
          <ChevronDownIcon size={16} />
        </button>
      </div>

      {/* One line of counts, so the shape of the day is legible before the
          detail. Miles are not tracked, so they are not claimed. */}
      <p className="t-meta route-stats">
        <span>
          <b>{stops}</b> {stops === 1 ? "stop" : "stops"}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <b>{done}</b> done
        </span>
        {needsDebrief > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="is-owed">
              {needsDebrief} {needsDebrief === 1 ? "needs" : "need"} a debrief
            </span>
          </>
        )}
      </p>

      {nextUp && (
        <button type="button" className="route-summary" onClick={() => setFolded(false)}>
          <span className="rs-k">{nextUp.state === "planned" ? "Next up" : "Last stop"}</span>
          <span className="rs-main">
            {formatDay(nextUp.dueDate)} ·{" "}
            {nextAccount ? displayAccountName(nextAccount.name) : nextUp.action}
          </span>
          <span className="rs-sub">
            {nextAccount
              ? nextUp.action
              : nextUp.objective
                ? humanize(nextUp.objective)
                : ""}
          </span>
          {needsDebrief > 0 && (
            <span className="rs-flag">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 21V4l14 6-14 5" />
              </svg>
              {needsDebrief === 1 ? "Needs a debrief" : `${needsDebrief} need a debrief`}
            </span>
          )}
          <span className="rs-open">Show the whole day</span>
        </button>
      )}

      <div className="route-week mb-4">
        <Link href="/visits" className="btn-mini">
          <CalendarIcon size={16} />
          See the whole week
        </Link>
      </div>

      <ol className="spine" id="day-spine">
        {before.map((stop, i) => (
          <Stop
            key={stop.id}
            stop={stop}
            prev={i === 0 ? null : before[i - 1].state}
            account={stop.accountId ? accountsById.get(stop.accountId) : undefined}
            formatDay={formatDay}
            onDebrief={onDebrief}
          />
        ))}

        <li className="spine-item">
          <div className="spine-rail" aria-hidden="true">
            <div
              className={`spine-seg ${before.length === 0 ? "is-off" : segAbove(lastBefore)}`}
              style={{ flex: "0 0 10px", minHeight: 10 }}
            />
            <div className="spine-now" />
            <div className={`spine-seg ${after.length > 0 ? "is-future" : "is-off"}`} />
          </div>
          <div className="spine-body">
            <p className="spine-now-head">NOW · {nowLabel}</p>
            <p className="t-sub mt-0.5" style={{ maxWidth: "34ch" }}>
              {needsDebrief > 0
                ? `${needsDebrief === 1 ? "One stop" : `${needsDebrief} stops`} still ${needsDebrief === 1 ? "owes" : "owe"} a debrief before you head out.`
                : after.length > 0
                  ? `${after.length} still ahead of you.`
                  : "Everything behind you is logged."}
            </p>
          </div>
        </li>

        {after.length > 0 && (
          <li className="spine-item">
            <div className="spine-rail" aria-hidden="true">
              <div className="spine-seg is-future" />
              <div className="spine-seg is-future" style={{ flex: "0 0 0", minHeight: 0, width: 0 }} />
              <div className="spine-seg is-future" />
            </div>
            <div className="spine-body" style={{ padding: "6px 0 6px 14px" }}>
              <p className="spine-label">Coming up</p>
            </div>
          </li>
        )}

        {after.map((stop, i) => (
          <Stop
            key={stop.id}
            stop={stop}
            prev={i === 0 ? "planned" : after[i - 1].state}
            account={stop.accountId ? accountsById.get(stop.accountId) : undefined}
            formatDay={formatDay}
          />
        ))}
      </ol>
    </section>
  );
}
