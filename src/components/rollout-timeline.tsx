"use client";

// Bianca's rollout tracker, drawn as the journey it is.
//
// Three gates since the 2026-08-28 review: PK class (a count — the same
// counter gets taught again), material (yes or no), the display. Drawn as a
// TIMELINE because that is how the business talks about it — a branch moves
// along it — but NOT as a funnel, and the difference matters. A funnel says
// each stage is a subset of the one before. This one is not: the real tracker
// has walls standing in branches that never had the class, and a funnel would
// report those branches as further along than they are and hide the very gap
// the book exists to show. So each gate carries its own count against the
// same total, and the rail says "next", not "therefore".

import { GATE_COUNT, PIPELINE_GATES, type PkAccount, type RolloutCounts } from "@/lib/domain/rollout";

export function RolloutTimeline({
  counts,
  heading = "Getting dealers selling",
  pkAccounts,
  onPkCount,
}: {
  counts: RolloutCounts;
  heading?: string;
  /** Who has had the class, and who has not — the PK gate's unfold. Absent
   *  means the gate stays a bare count (the desktop stopgap does this). */
  pkAccounts?: readonly PkAccount[];
  /** Marking the checkbox writes 1, unmarking writes 0, "again" adds one. */
  onPkCount?: (accountId: string, next: number) => void;
}) {
  const total = counts.branches ?? 0;
  if (total === 0) return null;

  const gates = PIPELINE_GATES.map((g) => {
    const done = counts[g.key] ?? 0;
    // A yes-or-no gate has no half-done worth reporting: PENDING reads as NO.
    const pending = g.binary ? 0 : (counts[g.pendingKey] ?? 0);
    return { ...g, done, pending };
  });
  const anyPending = gates.some((g) => g.pending > 0);
  const pkTotal = counts.pk_total ?? 0;
  const taught = pkAccounts?.filter((a) => a.pk_count > 0) ?? [];
  const waiting = pkAccounts?.filter((a) => a.pk_count === 0) ?? [];

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
          // that is the whole reason this is not a funnel.
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
                    {/* The branches through the gate — and for PK, how much
                        teaching that actually took. Seven classes across five
                        counters is a different fact from five counters. */}
                    {g.key === "pk_done" && pkTotal > g.done
                      ? `${g.done}/${total} · ${pkTotal} classes`
                      : `${g.done}/${total}`}
                  </span>
                </div>
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

                {/* THE UNFOLD: who has had the class, folded away until asked.
                    And it is also where the class is RECORDED — a checkbox for
                    the first one, "again" for the next — because the person
                    reading this list is the person who just gave it. */}
                {g.key === "pk_done" && pkAccounts && pkAccounts.length > 0 && (
                  <details className="pk-unfold">
                    <summary className="t-hint">
                      {taught.length > 0
                        ? `who has had the class — ${taught.length} of ${pkAccounts.length}`
                        : "no branch has had the class yet — record the first"}
                    </summary>
                    <ul className="pk-list">
                      {[...taught, ...waiting].map((a) => (
                        <li key={a.account_id} className="pk-row">
                          <label className="pk-check">
                            <input
                              type="checkbox"
                              checked={a.pk_count > 0}
                              disabled={!onPkCount}
                              onChange={(e) =>
                                onPkCount?.(a.account_id, e.target.checked ? 1 : 0)
                              }
                            />
                            <span className="pk-name">{a.name}</span>
                          </label>
                          {a.pk_count > 0 && (
                            <span className="pk-side">
                              {a.pk_count > 1 && (
                                <span className="fig-sm pk-times">×{a.pk_count}</span>
                              )}
                              {onPkCount && (
                                <button
                                  type="button"
                                  className="btn-mini pk-again"
                                  aria-label={`One more class at ${a.name}`}
                                  onClick={() => onPkCount(a.account_id, a.pk_count + 1)}
                                >
                                  again
                                </button>
                              )}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
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
        {anyPending && (
          <span>
            <i style={{ background: "var(--warn)" }} />
            in progress
          </span>
        )}
        <span>
          <i className="pva-seg is-left" />
          not started
        </span>
      </p>

      <p className="t-sub px-1">
        <span className="fig-sm" style={{ color: "var(--ink-primary)" }}>
          {counts.fully_through ?? 0}
        </span>{" "}
        through all {GATE_COUNT === 3 ? "three" : GATE_COUNT}
        {(counts.not_started ?? 0) > 0 ? (
          <>
            {", "}
            <span className="fig-sm" style={{ color: "var(--ink-primary)" }}>
              {counts.not_started}
            </span>{" "}
            not started
          </>
        ) : (
          ""
        )}
        . A branch can clear a later gate with an earlier one still open — that
        gap is the queue.
      </p>
    </section>
  );
}
