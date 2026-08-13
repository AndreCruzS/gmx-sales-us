"use client";

// "Today & what's next" — the rep's day drawn as one line.
//
// The rail is the whole idea: each stop's segment is coloured by what is true
// of it, so the eye reads the day's shape before it reads a single word. A
// stop that owes a debrief sits above the NOW ring, because it is the one
// thing on this screen a rep can still put right today.

import Link from "next/link";
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

function Stop({
  stop,
  prev,
  account,
  formatDay,
}: {
  stop: TimelineStop;
  prev: StopState | null;
  account: CachedAccount | undefined;
  formatDay: (iso: string) => string;
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

        {/* The one state a rep can act on from here. */}
        {stop.state === "flagged" && (
          <Link
            href={`/record?visit=${stop.id}`}
            className="btn-quiet mt-2 inline-flex"
            style={{ background: "var(--danger-tint)", color: "var(--danger)" }}
          >
            This one passed with nothing logged — how did it go?
          </Link>
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
}: {
  timeline: DayTimeline;
  accountsById: Map<string, CachedAccount>;
  formatDay: (iso: string) => string;
  nowLabel: string;
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
