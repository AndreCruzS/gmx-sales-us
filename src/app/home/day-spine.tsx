"use client";

// "Today & what's next" — the rep's day drawn as one line.
//
// The rail is the whole idea: each stop's segment is coloured by what is true
// of it, so the eye reads the day's shape before it reads a single word. A
// stop that owes a debrief sits above the NOW ring, because it is the one
// thing on this screen a rep can still put right today.

import Link from "next/link";
import { useState } from "react";
import { MicrophoneIcon } from "@/components/icons";
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
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDebrief(stop, note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form className="debrief mt-2.5" onSubmit={submit}>
      <p className="debrief-prompt">
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
        disabled={!note.trim() || busy}
      >
        {busy ? "Logging…" : "Log & continue"}
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
  const { before, after, stops, done, needsDebrief } = timeline;
  if (stops === 0) return null;

  const lastBefore = before.length > 0 ? before[before.length - 1].state : null;

  return (
    <section>
      <div className="section-head">
        <h2 className="t-section">
          Today <span style={{ color: "var(--ink-muted)" }}>&amp; what&rsquo;s next</span>
        </h2>
        <Link href="/visits" className="t-action">
          The whole week
        </Link>
      </div>

      {/* One line of counts, so the shape of the day is legible before the
          detail. Miles are not tracked, so they are not claimed. */}
      <p className="t-meta mb-3 px-1">
        <b style={{ color: "var(--ink-primary)" }}>{stops}</b>{" "}
        {stops === 1 ? "stop" : "stops"} · <b style={{ color: "var(--ink-primary)" }}>{done}</b> done
        {needsDebrief > 0 && (
          <>
            {" · "}
            <span style={{ color: "var(--danger)", fontWeight: 700 }}>
              {needsDebrief} {needsDebrief === 1 ? "needs" : "need"} a debrief
            </span>
          </>
        )}
      </p>

      <ol className="spine">
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
