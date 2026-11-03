"use client";

// The Dealers board's presentational pieces: the tier figures and the table
// of a market's dealers. The page owns the data; these only draw it.

import { useState } from "react";
import { Pager, usePaged, usePageSize } from "@/components/pager";
import type { Tier } from "@/lib/domain/dealer-tiers";
import { formatDay } from "@/lib/format";

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Past this, a dealer's last visit reads as stale. */
const STALE_DAYS = 60;

/** One line of the dealer table — a tiered dealer or an untiered target. */
export interface DealerLine {
  key: string;
  accountId: string | null;
  name: string;
  tier: Tier | null;
  lf: number;
  market: string;
  ownerId: string | null;
  lastVisit: string | null;
  open: number;
  late: number;
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function TierTile({
  tier,
  label,
  count,
  note,
}: {
  tier: Tier | null;
  label: string;
  count: number;
  note: string;
}) {
  return (
    <div className="card card-pad dl-tile" data-tier={tier ?? "none"}>
      <div className="t-meta uppercase tracking-wide">{label}</div>
      <div className="fig fig-xl mt-1">{QTY.format(count)}</div>
      <div className="t-hint mt-0.5">{note}</div>
    </div>
  );
}

// ── The market's dealers ────────────────────────────────────────────────────
// For an admin the list is grouped by tier (Andre, 2026-11-03): one band per
// tier — Tier 1, Tier 2, Tier 3, No history — with its count, its LF and its
// late to-dos, that opens to the dealers in it. Tier 1 opens on arrival; the
// rest wait for a click. Without tiers (non-admins) it stays one table.

type GroupKey = Tier | "none";
const GROUPS: readonly { key: GroupKey; label: string; note: string }[] = [
  { key: "T1", label: "Tier 1", note: "the biggest buyers" },
  { key: "T2", label: "Tier 2", note: "steady · bought in 3+ months" },
  { key: "T3", label: "Tier 3", note: "occasional · under 3 months" },
  { key: "none", label: "No history", note: "no sales on file" },
];

function LinesTable({
  lines,
  names,
  todayIso,
  selectedKey,
  showTier,
  showLf,
  onOpen,
}: {
  lines: readonly DealerLine[];
  names: ReadonlyMap<string, string>;
  todayIso: string;
  selectedKey: string | null;
  showTier: boolean;
  showLf: boolean;
  onOpen: (l: DealerLine) => void;
}) {
  const size = usePageSize(15, 10);
  const { slice, page, pages, from, setPage, total } = usePaged(lines, size);
  return (
    <>
      <div className="dl-table-wrap">
        <table className="dl-table">
          <thead>
            <tr>
              <th scope="col">Dealer</th>
              {showTier && <th scope="col">Tier</th>}
              {showLf && (
                <th scope="col" className="dl-num">
                  LF · 12 mo
                </th>
              )}
              <th scope="col">Last visit</th>
              <th scope="col">Open</th>
              <th scope="col">Rep</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((l) => {
              const stale = l.lastVisit === null || daysBetween(l.lastVisit, todayIso) > STALE_DAYS;
              return (
                <tr key={l.key} data-selected={selectedKey === l.key || undefined} onClick={() => onOpen(l)}>
                  <td className="dl-dealer">
                    <button
                      type="button"
                      className="dl-open"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(l);
                      }}
                    >
                      {l.name}
                    </button>
                  </td>
                  {showTier && (
                    <td>
                      {l.tier ? (
                        <span className="dl-tier" data-tier={l.tier}>
                          {l.tier}
                        </span>
                      ) : (
                        <span className="t-hint">no sales</span>
                      )}
                    </td>
                  )}
                  {showLf && <td className="dl-num fig">{l.lf > 0 ? QTY.format(l.lf) : "—"}</td>}
                  <td>
                    <span className="dl-when" data-stale={stale || undefined}>
                      {l.lastVisit === null
                        ? "never"
                        : daysBetween(l.lastVisit, todayIso) > STALE_DAYS
                          ? `${daysBetween(l.lastVisit, todayIso)} days`
                          : formatDay(l.lastVisit)}
                    </span>
                  </td>
                  <td className="dl-open-cell">
                    {l.late > 0 && (
                      <span className="dl-pill" data-tone="late">
                        {l.late} late
                      </span>
                    )}
                    <span className="fig">{l.open}</span>
                  </td>
                  <td className="dl-rep">{l.ownerId ? (names.get(l.ownerId) ?? "—") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <Pager
          page={page}
          pages={pages}
          from={from}
          shown={slice.length}
          total={total}
          status={`${from + 1}–${from + slice.length} of ${total} dealers · page ${page + 1} of ${pages}`}
          onPage={setPage}
          className="dl-pager"
        />
      )}
    </>
  );
}

export function DealerTable({
  title,
  lines,
  names,
  todayIso,
  selectedKey,
  showTiers,
  onOpen,
  onClear,
  span,
}: {
  title: string;
  lines: readonly DealerLine[];
  names: ReadonlyMap<string, string>;
  todayIso: string;
  selectedKey: string | null;
  /** Admins only: a tier is worked out from every dealer's sales. */
  showTiers: boolean;
  onOpen: (l: DealerLine) => void;
  onClear: (() => void) | null;
  span: string;
}) {
  const [open, setOpen] = useState<ReadonlySet<GroupKey>>(() => new Set<GroupKey>(["T1"]));
  const total = lines.length;
  const toggle = (k: GroupKey) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <section className="adapt card dl-table-card" data-desk="table" data-span={span} key={`table-${title}`}>
      <div className="quiet-head dl-table-head">
        <span className="t-title">{title} · dealers</span>
        <span className="t-hint">
          {total === 0 ? "no dealers here" : `${QTY.format(total)} ${total === 1 ? "dealer" : "dealers"}`}
          {onClear && (
            <>
              {" · "}
              <button type="button" className="t-action" onClick={onClear}>
                All markets
              </button>
            </>
          )}
        </span>
      </div>

      {total > 0 && !showTiers && (
        <LinesTable
          lines={lines}
          names={names}
          todayIso={todayIso}
          selectedKey={selectedKey}
          showTier={false}
          showLf={false}
          onOpen={onOpen}
        />
      )}

      {total > 0 &&
        showTiers &&
        GROUPS.map((g) => {
          const mine = lines.filter((l) => (l.tier ?? "none") === g.key);
          const lf = mine.reduce((sum, l) => sum + l.lf, 0);
          const late = mine.reduce((sum, l) => sum + l.late, 0);
          const isOpen = open.has(g.key) && mine.length > 0;
          return (
            <div key={g.key} className="dl-tg" data-open={isOpen || undefined}>
              <button
                type="button"
                className="dl-tg-head"
                aria-expanded={isOpen}
                disabled={mine.length === 0}
                onClick={() => toggle(g.key)}
              >
                <svg className="dl-tg-chev" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M4.5 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                {g.key === "none" ? (
                  <span className="dl-tg-none">—</span>
                ) : (
                  <span className="dl-tier" data-tier={g.key}>
                    {g.key}
                  </span>
                )}
                <span className="dl-tg-name">{g.label}</span>
                <span className="dl-tg-note">{g.note}</span>
                <span className="dl-tg-facts">
                  <b>{QTY.format(mine.length)}</b> {mine.length === 1 ? "dealer" : "dealers"}
                  {lf > 0 && <> · {QTY.format(lf)} LF</>}
                  {late > 0 && <span className="dl-late-text"> · {QTY.format(late)} late</span>}
                </span>
              </button>
              {isOpen && (
                <LinesTable
                  lines={mine}
                  names={names}
                  todayIso={todayIso}
                  selectedKey={selectedKey}
                  showTier={false}
                  showLf={g.key !== "none"}
                  onOpen={onOpen}
                />
              )}
            </div>
          );
        })}
    </section>
  );
}
