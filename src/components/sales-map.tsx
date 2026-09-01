"use client";

// ── The country itself — the company's action on the map of the USA ──────────
//
// The desk's region view opens on the actual map, and the map is dense on
// purpose: every state wears ITS MARKET'S colour (the same hue its card and
// its slice of the total bar wear), deeper with volume, and every branch
// address is pinned, sized by what moved through it.
//
// The map is also the DOOR: clicking a market's ground (a state, a pin, or
// its card below) picks that market — the camera flies to its states, the
// rest of the country blurs and fades, and the detail module opens beside
// it. Clicking the picked ground again, or open water, flies home. The
// flight is one CSS transform transition on a group; the geometry never
// re-renders, only the camera moves.
//
// NO DEALER DOTS, deliberately: the files carry no dealer addresses, and a
// company's NAME is a trap ("Austin Hardwoods" sits in Santa Ana; "Lansing
// Building Products" in Virginia) — a dot without an address is fiction, and
// the first draft of this map proved it by floating dealers in the Pacific.
// What the map says instead is what we know: the dealer count is written
// beside the pin and the names live in the pin's tooltip. The day dealer
// accounts carry real addresses, they come back as dots at those addresses.
//
// The shapes are the US Atlas topology, pre-projected to a 975×610 canvas,
// imported LAZILY so the phone bundle never carries the country. Branch pins
// sit at their city's coordinates through the same Albers projection; a city
// we hold no coordinates for falls back to the centre of its state — placed,
// honestly, rather than dropped.

import { useEffect, useMemo, useState } from "react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import type { BranchRef, SellThroughRow } from "@/lib/domain/sell-through";

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// US Atlas state ids are FIPS codes; the rows speak postal. One table, here,
// because no dependency small enough exists for it.
const FIPS_POSTAL: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY", "72": "PR",
};

// The branch cities we actually have, by hand — eight addresses do not
// deserve a geocoder. Anything not listed lands on its state's centre.
const CITY_COORDS: Record<string, [number, number]> = {
  "riverside|CA": [-117.3962, 33.9533],
  "dallas|TX": [-96.797, 32.7767],
  "houston|TX": [-95.3698, 29.7604],
  "memphis|TN": [-90.049, 35.1495],
  "nashville|TN": [-86.7816, 36.1627],
  "atlanta|GA": [-84.388, 33.749],
  "salt lake city|UT": [-111.891, 40.7608],
  "detroit|MI": [-83.0458, 42.3314],
};

// Each state wears its market's colour. The neutrals are THEME TOKENS —
// paper darker than the card by day, lighter by night — and the volume mix
// leans on the map's own ground, so a state deepens from whatever surface
// it lies on. Hardcoded hexes here were the whole dark-mode bug.
const COVERED_ZERO = "var(--map-covered)";
const PAPER = "var(--map-paper)";
const GROUND = "var(--map-ground)";
const REST_HUE = "#8a9299";
/** The legend's intensity strip, hue-agnostic: the first market's blue is as
 *  good a demonstrator as any. */
const LEGEND_STEPS = [25, 44, 63, 81, 100] as const;

// The pre-projected US Atlas projection, for placing lat/lng pins on it.
const PROJECT = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const PLANAR_PATH = geoPath();

const VIEW_W = 975;
const VIEW_H = 610;

interface StateFeature {
  id: string;
  path: string;
  centroid: [number, number];
  bounds: [[number, number], [number, number]];
  name: string;
}

// The topology loads once per session, whoever asks first.
let statesCache: StateFeature[] | null = null;
let statesLoading: Promise<StateFeature[]> | null = null;
async function loadStates(): Promise<StateFeature[]> {
  if (statesCache) return statesCache;
  statesLoading ??= (async () => {
    const [{ feature }, topo] = await Promise.all([
      import("topojson-client"),
      import("us-atlas/states-albers-10m.json"),
    ]);
    /* eslint-disable @typescript-eslint/no-explicit-any -- the atlas JSON has
       no shipped topology type; it is consumed once, right here. */
    const t = topo.default as any;
    const fc = feature(t, t.objects.states) as any;
    statesCache = (fc.features as any[]).map((f) => ({
      id: String(f.id),
      path: PLANAR_PATH(f) ?? "",
      centroid: PLANAR_PATH.centroid(f) as [number, number],
      bounds: PLANAR_PATH.bounds(f) as [[number, number], [number, number]],
      name: String(f.properties?.name ?? ""),
    }));
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return statesCache;
  })();
  return statesLoading;
}

export function SalesMap({
  rows,
  branches,
  unit,
  month,
  regionHue,
  picked,
  onPick,
}: {
  rows: readonly SellThroughRow[];
  branches: readonly BranchRef[];
  unit: string;
  month: string;
  /** Market key → the market's categorical colour, from the same map the
   *  total bar and the cards read. The states inherit it. */
  regionHue: ReadonlyMap<string, string>;
  /** The picked market, or null for the whole country. The camera follows. */
  picked: string | null;
  /** Click a market's ground to pick it; the picked ground or open water to
   *  fly home. Null means "back to the country". */
  onPick: (regionKey: string | null) => void;
}) {
  const [states, setStates] = useState<StateFeature[] | null>(statesCache);
  const [tip, setTip] = useState<{
    name: string;
    sub: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!states) void loadStates().then(setStates);
  }, [states]);

  const { byState, stateRegion, pins, maxState, maxPin } = useMemo(() => {
    const byState = new Map<string, number>();
    const byBranch = new Map<string, number>();
    const branchDealers = new Map<
      string,
      Map<string, { name: string; qty: number }>
    >();
    const branchRegion = new Map<string, Map<string, number>>();
    // Which market owns each state, by volume — in practice one, but a state
    // split between two markets goes to the bigger half, not a flicker.
    const regionVotes = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const q = Number(r.quantity) || 0;
      const rk = r.region_id ?? "unmapped";
      if (r.branch_state) {
        byState.set(r.branch_state, (byState.get(r.branch_state) ?? 0) + q);
        const votes =
          regionVotes.get(r.branch_state) ?? new Map<string, number>();
        votes.set(rk, (votes.get(rk) ?? 0) + q);
        regionVotes.set(r.branch_state, votes);
      }
      byBranch.set(r.branch_id, (byBranch.get(r.branch_id) ?? 0) + q);
      const bv = branchRegion.get(r.branch_id) ?? new Map<string, number>();
      bv.set(rk, (bv.get(rk) ?? 0) + q);
      branchRegion.set(r.branch_id, bv);
      const dl =
        branchDealers.get(r.branch_id) ??
        new Map<string, { name: string; qty: number }>();
      const d = dl.get(r.dealer_label);
      if (d) d.qty += q;
      else
        dl.set(r.dealer_label, {
          name: r.dealer_name ?? r.dealer_label,
          qty: q,
        });
      branchDealers.set(r.branch_id, dl);
    }
    const stateRegion = new Map<string, string>();
    for (const [st, votes] of regionVotes) {
      const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) stateRegion.set(st, top[0]);
    }
    // Every branch on file is a pin — the quiet ones hollow. Coordinates via
    // the city table, else the state centre once the shapes have loaded.
    const pins = branches.map((b) => {
      const qty = byBranch.get(b.id) ?? 0;
      const key = `${(b.city ?? "").toLowerCase()}|${b.state ?? ""}`;
      const coords = CITY_COORDS[key];
      const rv = branchRegion.get(b.id);
      const top = rv ? [...rv.entries()].sort((a, b) => b[1] - a[1])[0] : null;
      const dealers = [...(branchDealers.get(b.id)?.values() ?? [])].sort(
        (a, b) => b.qty - a.qty,
      );
      return {
        id: b.id,
        name: b.name,
        city: b.city,
        state: b.state,
        qty,
        regionKey: top?.[0] ?? null,
        dealers,
        xy: (coords ? PROJECT(coords) : null) as [number, number] | null,
      };
    });
    const maxState = Math.max(...byState.values(), 1);
    const maxPin = Math.max(...pins.map((p) => p.qty), 1);
    return { byState, stateRegion, pins, maxState, maxPin };
  }, [rows, branches]);

  const coveredStates = useMemo(
    () => new Set(branches.map((b) => b.state).filter(Boolean) as string[]),
    [branches],
  );

  const hueOfRegion = (key: string | null) =>
    (key && regionHue.get(key)) || REST_HUE;

  const fillOf = (postal: string | undefined) => {
    if (!postal) return PAPER;
    const qty = byState.get(postal) ?? 0;
    if (qty <= 0) return coveredStates.has(postal) ? COVERED_ZERO : PAPER;
    const hue = hueOfRegion(stateRegion.get(postal) ?? null);
    // The market's own colour, deeper with volume — sqrt eases the skew so
    // 46k in one state does not wash every other market out.
    const t = Math.sqrt(qty / maxState);
    const mix = Math.round(25 + 75 * t);
    return `color-mix(in srgb, ${hue} ${mix}%, ${GROUND})`;
  };

  const centroidOf = (postal: string | null) =>
    states?.find((s) => FIPS_POSTAL[s.id] === postal)?.centroid ?? null;

  const show = (e: React.MouseEvent, name: string, sub: string) => {
    const rect = (e.currentTarget as Element)
      .closest(".salesmap")!
      .getBoundingClientRect();
    setTip({ name, sub, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const placed = pins
    .map((p) => ({ ...p, at: p.xy ?? centroidOf(p.state) }))
    .filter((p): p is typeof p & { at: [number, number] } => p.at !== null);

  // ── The camera ─────────────────────────────────────────────────────────────
  //
  // Picking a market frames its states: union their bounds, pad, and fit —
  // one translate+scale on the group, transitioned in CSS. Identity when
  // nothing is picked.
  const camera = useMemo(() => {
    if (!picked || !states) return { k: 1, tx: 0, ty: 0 };
    const mine = states.filter(
      (s) => stateRegion.get(FIPS_POSTAL[s.id] ?? "") === picked,
    );
    if (mine.length === 0) return { k: 1, tx: 0, ty: 0 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of mine) {
      x0 = Math.min(x0, s.bounds[0][0]);
      y0 = Math.min(y0, s.bounds[0][1]);
      x1 = Math.max(x1, s.bounds[1][0]);
      y1 = Math.max(y1, s.bounds[1][1]);
    }
    const w = x1 - x0 + 90;
    const h = y1 - y0 + 90;
    const k = Math.max(1, Math.min(VIEW_W / w, VIEW_H / h, 4.2));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    return { k, tx: VIEW_W / 2 - k * cx, ty: VIEW_H / 2 - k * cy };
  }, [picked, states, stateRegion]);

  const { k } = camera;

  return (
    <div className="salesmap" data-picked={picked ? "true" : undefined}>
      {states === null ? (
        <div className="salesmap-loading" aria-hidden="true" />
      ) : (
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="salesmap-svg"
          role="img"
          aria-label={`Sales by state, ${month}, every branch pinned. Click a market to open it.`}
          onClick={() => onPick(null)}
        >
          <g
            className="salesmap-zoom"
            style={{
              transform: `translate(${camera.tx}px, ${camera.ty}px) scale(${k})`,
            }}
          >
            {states.map((s) => {
              const postal = FIPS_POSTAL[s.id];
              const qty = byState.get(postal ?? "") ?? 0;
              const regionKey = stateRegion.get(postal ?? "") ?? null;
              const dimmed = picked !== null && regionKey !== picked;
              return (
                <path
                  key={s.id}
                  d={s.path}
                  fill={fillOf(postal)}
                  stroke="var(--map-line)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  data-dim={dimmed || undefined}
                  data-ground={regionKey ? "true" : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (regionKey) onPick(regionKey === picked ? null : regionKey);
                    else onPick(null);
                  }}
                  onMouseMove={(e) =>
                    show(
                      e,
                      s.name,
                      qty > 0
                        ? `${QTY.format(qty)} ${unit} · ${month}`
                        : coveredStates.has(postal ?? "")
                          ? "covered · nothing this period"
                          : "no coverage",
                    )
                  }
                  onMouseLeave={() => setTip(null)}
                />
              );
            })}

            {/* THE BRANCHES: our addresses, on top. Hollow means quiet. Radii
                and figures divide by the camera's scale so a flight never
                inflates them. */}
            {placed.map((p) => {
              const r = (p.qty > 0 ? 6 + 6 * Math.sqrt(p.qty / maxPin) : 5) / k;
              const dimmed = picked !== null && p.regionKey !== picked;
              return (
                <g key={p.id} data-dim={dimmed || undefined}>
                  {p.qty > 0 && p.dealers.length > 0 && (
                    <text
                      x={p.at[0] + r + 5 / k}
                      y={p.at[1] + 4 / k}
                      className="salesmap-count"
                      style={{ fontSize: `${13 / k}px` }}
                      aria-hidden="true"
                    >
                      {p.dealers.length}
                    </text>
                  )}
                  <circle
                    cx={p.at[0]}
                    cy={p.at[1]}
                    r={r}
                    className="salesmap-pin"
                    data-quiet={p.qty === 0 || undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (p.regionKey)
                        onPick(p.regionKey === picked ? null : p.regionKey);
                    }}
                    onMouseMove={(e) =>
                      show(
                        e,
                        p.name,
                        [
                          [p.city, p.state].filter(Boolean).join(", "),
                          p.qty > 0
                            ? `${QTY.format(p.qty)} ${unit} · ${p.dealers.length} ${
                                p.dealers.length === 1 ? "dealer" : "dealers"
                              }${
                                p.dealers.length > 0
                                  ? ` — ${p.dealers
                                      .slice(0, 3)
                                      .map((d) => d.name)
                                      .join(", ")}${
                                      p.dealers.length > 3 ? "…" : ""
                                    }`
                                  : ""
                              }`
                            : "quiet this period",
                        ]
                          .filter(Boolean)
                          .join(" · "),
                      )
                    }
                    onMouseLeave={() => setTip(null)}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      )}

      <p className="salesmap-legend">
        <span className="salesmap-scale" aria-hidden="true">
          {LEGEND_STEPS.map((m) => (
            <i
              key={m}
              style={{
                background: `color-mix(in srgb, var(--cat-1) ${m}%, var(--map-ground))`,
              }}
            />
          ))}
        </span>
        <span>fewer → more {unit} · each market its colour</span>
        <span>
          <i className="salesmap-key-pin" aria-hidden="true" /> branch
        </span>
        <span>
          <i className="salesmap-key-pin" data-quiet="true" aria-hidden="true" />{" "}
          branch, quiet
        </span>
        <span>
          <span className="salesmap-key-count" aria-hidden="true">
            12
          </span>{" "}
          dealers buying there
        </span>
        <span>
          <i className="salesmap-key-paper" aria-hidden="true" /> no coverage
        </span>
      </p>

      {tip && (
        <div
          className="cols-tip"
          style={{ left: tip.x, top: tip.y }}
          role="status"
        >
          <span className="cols-tip-name">{tip.name}</span>
          <span className="cols-tip-sub">{tip.sub}</span>
        </div>
      )}
    </div>
  );
}
