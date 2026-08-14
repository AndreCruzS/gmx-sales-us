"use client";

// Bianca's rollout tracker, drawn as the journey it is.
//
// The spreadsheet is a row per branch and a column per gate: PK class,
// merchandiser, display wall, material in stock. Four things that have to be
// true before a dealer can actually sell, and the tracker exists because they
// usually are not.
//
// Drawn as a TIMELINE because that is how the business talks about it — a
// branch moves along it — but NOT as a funnel, and the difference matters. A
// funnel says each stage is a subset of the one before. This one is not: the
// real tracker has walls standing in branches with no merchandiser behind
// them, and material sitting in branches that never had the class. A funnel
// would report those branches as further along than they are and hide the very
// gap the book exists to show. So each gate carries its own count against the
// same total, and the rail says "next", not "therefore".

import { PIPELINE_GATES, type RolloutCounts } from "@/lib/domain/rollout";

export function RolloutTimeline({
  counts,
  heading = "Getting dealers selling",
}: {
  counts: RolloutCounts;
  heading?: string;
}) {
  const total = counts.branches ?? 0;
  if (total === 0) return null;

  const gates = PIPELINE_GATES.map((g) => {
    const done = counts[g.key] ?? 0;
    const pending = counts[g.pendingKey] ?? 0;
    return { ...g, done, pending };
  });

  return (
    <section>
      <div className="section-head">
        <h2 className="t-section">{heading}</h2>
        <span className="t-meta">
          {total} {total === 1 ? "branch" : "branches"}
        </span>
      </div>

      <ol className="spine">
        {gates.map((g, i) => {
          const donePct = total === 0 ? 0 : (100 * g.done) / total;
          const pendingPct = total === 0 ? 0 : (100 * g.pending) / total;
          // The RAIL is a connector, not a state. Colouring it by progress
          // would say each gate follows from the one above, and they do not —
          // that is the whole reason this is not a funnel. Clay in particular
          // means slipping in this language, and a gate at 1 of 7 is not
          // slipping, it is early.
          //
          // The NODE carries the state, because it belongs to the gate itself:
          // filled when every branch is through, hollow when none is, and a
          // ring while it is being worked.
          const nodeState =
            g.done >= total ? "is-done" : g.done === 0 && g.pending === 0 ? "is-future" : "";
          return (
            <li key={g.key} className="spine-item">
              <div className="spine-rail" aria-hidden="true">
                <div className={`spine-seg ${i === 0 ? "is-off" : "is-future"}`} />
                <div className={`spine-node ${nodeState}`} />
                <div
                  className={`spine-seg ${i === gates.length - 1 ? "is-off" : "is-future"}`}
                />
              </div>
              <div className="spine-body">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="t-title">{g.label}</span>
                  <span className="t-meta tabular-nums">
                    {g.done}/{total}
                  </span>
                </div>
                {/* Three states, because her sheet has three. Amber is work in
                    flight — the merchandiser being hired, the wall going up —
                    and it is the column that tells her whether anything is
                    moving at all. */}
                <div
                  className="mt-1.5 flex h-2 overflow-hidden rounded"
                  style={{ background: "var(--rule)" }}
                  role="img"
                  aria-label={`${g.done} of ${total} branches done${
                    g.pending > 0 ? `, ${g.pending} in progress` : ""
                  }: ${g.label}`}
                >
                  <span style={{ width: `${donePct}%`, background: "var(--accent)" }} />
                  <span style={{ width: `${pendingPct}%`, background: "var(--warn)" }} />
                </div>
                <p className="t-sub mt-1">
                  {g.pending > 0 ? `${g.pending} in progress · ` : ""}
                  {g.hint}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="pva-legend mb-1">
        <span>
          <i className="pva-seg is-done" />
          done
        </span>
        <span>
          <i style={{ background: "var(--warn)" }} />
          in progress
        </span>
        <span>
          <i className="pva-seg is-left" />
          not started
        </span>
      </p>

      <p className="t-sub px-1">
        <b style={{ color: "var(--ink-primary)" }}>{counts.fully_through ?? 0}</b>{" "}
        through all four
        {(counts.not_started ?? 0) > 0
          ? `, ${counts.not_started} not started`
          : ""}
        . A branch can clear a later gate with an earlier one still open — that
        gap is the queue.
      </p>
    </section>
  );
}
