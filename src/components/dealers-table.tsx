"use client";

// The Dealers board's presentational pieces: the tier figures and the table
// of a market's dealers. The page owns the data; these only draw it.

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
export function DealerTable({
  title,
  lines,
  names,
  todayIso,
  selectedKey,
  onOpen,
  onClear,
  span,
}: {
  title: string;
  lines: readonly DealerLine[];
  names: ReadonlyMap<string, string>;
  todayIso: string;
  selectedKey: string | null;
  onOpen: (l: DealerLine) => void;
  onClear: (() => void) | null;
  span: string;
}) {
  const size = usePageSize(15, 10);
  const { slice, page, pages, from, setPage, total } = usePaged(lines, size);

  return (
    <section
      className="adapt card dl-table-card"
      data-desk="table"
      data-span={span}
      key={`table-${title}`}
    >
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

      {total > 0 && (
        <div className="dl-table-wrap">
          <table className="dl-table">
            <thead>
              <tr>
                <th scope="col">Dealer</th>
                <th scope="col">Tier</th>
                <th scope="col">Last visit</th>
                <th scope="col">Open</th>
                <th scope="col">Rep</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((l) => {
                const stale =
                  l.lastVisit === null || daysBetween(l.lastVisit, todayIso) > STALE_DAYS;
                return (
                  <tr
                    key={l.key}
                    data-selected={selectedKey === l.key || undefined}
                    onClick={() => onOpen(l)}
                  >
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
                    <td>
                      {l.tier ? (
                        <span className="dl-tier" data-tier={l.tier}>
                          {l.tier}
                        </span>
                      ) : (
                        <span className="t-hint">no sales</span>
                      )}
                    </td>
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
      )}

      {pages > 1 && (
        <Pager
          page={page}
          pages={pages}
          from={from}
          shown={slice.length}
          total={total}
          onPage={setPage}
          className="fu-pager"
        />
      )}
    </section>
  );
}
