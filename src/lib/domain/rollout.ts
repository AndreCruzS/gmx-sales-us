// The rollout gates from the California tracker, named once.
//
// Three on screen since 2026-08-28 (the review with Bianca and João): the PK
// class leads and is a COUNT — the same counter gets taught more than once and
// the book remembers how many times — then material, then the display. The
// merchandiser gate still exists in the data but left the screen: assigning
// one is somebody's task, not a thing a dealer needs before selling. Reading
// order is not dependency: a branch can clear a later gate with an earlier one
// still open, and the whole point of the book is that many do.

export interface RolloutCounts {
  branches: number | null;
  pk_done: number | null;
  merchandiser_done: number | null;
  display_wall_done: number | null;
  material_done: number | null;
  fully_through: number | null;
  not_started?: number | null;
  // Her sheet records ok / pending / no. Counting only the "ok"s made a branch
  // with a wall going up look like one where nobody had started.
  pk_pending?: number | null;
  merchandiser_pending?: number | null;
  display_wall_pending?: number | null;
  material_pending?: number | null;
  /** Classes actually taught — can exceed pk_done: a counter taught twice. */
  pk_total?: number | null;
}

/** One branch's PK standing, for the gate's unfold and its checkbox. */
export interface PkAccount {
  account_id: string;
  name: string;
  pk_count: number;
}

/** One branch's material standing: the manual yes/no, and — when a monthly
 *  return shows the branch selling — the proof beside it. The evidence never
 *  writes the gate: past sales prove material was there THAT month, not that
 *  it is on the floor today, so the yes/no stays a person's word. */
export interface MaterialAccount {
  account_id: string;
  name: string;
  on: boolean;
  pending: boolean;
  evidence?: { period: string; lf: number };
}

/** One branch's display standing. The wall lives on the ACCOUNT (D-model):
 *  has_display_wall + display_last_verified_at — up and verified reads OK,
 *  up but unverified reads PENDING. The verified date is the citation: it
 *  says how fresh the word is. */
export interface DisplayAccount {
  account_id: string;
  name: string;
  on: boolean;
  pending: boolean;
  verifiedAt?: string | null;
}

export type GateKey =
  | "pk_done"
  | "merchandiser_done"
  | "display_wall_done"
  | "material_done";

export type GatePendingKey =
  | "pk_pending"
  | "merchandiser_pending"
  | "display_wall_pending"
  | "material_pending";

export const PIPELINE_GATES: readonly {
  key: GateKey;
  pendingKey: GatePendingKey;
  label: string;
  hint: string;
  /** yes-or-no gates show no amber: there is no half-stocked worth reporting. */
  binary?: boolean;
}[] = [
  {
    key: "pk_done",
    pendingKey: "pk_pending",
    label: "PK class",
    hint: "The counter staff know what they are selling",
  },
  {
    key: "material_done",
    pendingKey: "material_pending",
    label: "Material in stock",
    hint: "They can sell it the day it is asked for",
    binary: true,
  },
  {
    key: "display_wall_done",
    pendingKey: "display_wall_pending",
    label: "Display wall / rolling display",
    hint: "There is something to point at",
  },
];

/** How many of the VISIBLE gates the timeline reads against. */
export const GATE_COUNT = PIPELINE_GATES.length;

// ── READING THE GATES OFF `account_rollout_status` ──────────────────────────
//
// These used to live inside the Sales page, which is where the book was first
// drawn. The book moved to the REPS page on 2026-10-02 (Andre: "podemos
// transferir a section de getting dealers selling para a nova pagina de reps"),
// and rather than carry four memos across with it they became functions here —
// one place where a row of the view turns into what the timeline reads.

/** One row of `account_rollout_status`: a dealer and where it stands. */
export interface GateRow {
  account_id: string;
  org_id: string;
  /** Whose patch it is. null = nobody's — the page says so out loud. */
  owner_id?: string | null;
  name: string;
  pk_state: string;
  merchandiser_state: string;
  display_wall_state: string;
  material_state: string;
  pk_count: number;
}

/** How many of the THREE visible gates this dealer has cleared. The
 *  merchandiser stays in the data and out of every reading (2026-08-28). */
export function gatesCleared(b: GateRow): number {
  const on = (v: string) => (v === "OK" ? 1 : 0);
  return on(b.pk_state) + on(b.material_state) + on(b.display_wall_state);
}

/**
 * Summed from the same rows the unfold lists, so the book's counts and the
 * names behind them cannot disagree. `dashboard_rollout` still exists for the
 * desktop stopgap; this stopped asking two sources one question.
 */
export function countGates(rows: readonly GateRow[]): RolloutCounts | null {
  if (rows.length === 0) return null;
  const on = (v: string) => (v === "OK" ? 1 : 0);
  const pend = (v: string) => (v === "PENDING" ? 1 : 0);
  const sum = (f: (b: GateRow) => number) => rows.reduce((n, b) => n + f(b), 0);
  return {
    branches: rows.length,
    pk_done: sum((b) => on(b.pk_state)),
    merchandiser_done: sum((b) => on(b.merchandiser_state)),
    display_wall_done: sum((b) => on(b.display_wall_state)),
    material_done: sum((b) => on(b.material_state)),
    fully_through: rows.filter((b) => gatesCleared(b) === GATE_COUNT).length,
    not_started: rows.filter((b) => gatesCleared(b) === 0).length,
    pk_pending: sum((b) => pend(b.pk_state)),
    merchandiser_pending: 0,
    display_wall_pending: sum((b) => pend(b.display_wall_state)),
    material_pending: sum((b) => pend(b.material_state)),
    pk_total: sum((b) => b.pk_count),
  };
}

export function pkRoster(rows: readonly GateRow[]): PkAccount[] {
  return rows
    .map((b) => ({ account_id: b.account_id, name: b.name, pk_count: b.pk_count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The latest month each dealer is seen selling in — the Material gate's
 *  citation. Latest, not a list: one month of proof reads, three read as a
 *  spreadsheet. */
export function latestMaterialEvidence(
  rows: readonly { account_id: string; period: string; lf: number | string }[],
): Map<string, { period: string; lf: number }> {
  const m = new Map<string, { period: string; lf: number }>();
  for (const r of rows) {
    const cur = m.get(r.account_id);
    if (!cur || r.period > cur.period)
      m.set(r.account_id, { period: r.period, lf: Number(r.lf) });
  }
  return m;
}

export function materialRoster(
  rows: readonly GateRow[],
  evidence: ReadonlyMap<string, { period: string; lf: number }>,
): MaterialAccount[] {
  return rows.map((b) => ({
    account_id: b.account_id,
    name: b.name,
    on: b.material_state === "OK",
    pending: b.material_state === "PENDING",
    evidence: evidence.get(b.account_id),
  }));
}

export function displayRoster(
  rows: readonly GateRow[],
  walls: ReadonlyMap<string, { display_last_verified_at: string | null }>,
): DisplayAccount[] {
  return rows.map((b) => ({
    account_id: b.account_id,
    name: b.name,
    on: b.display_wall_state === "OK",
    pending: b.display_wall_state === "PENDING",
    verifiedAt: walls.get(b.account_id)?.display_last_verified_at ?? null,
  }));
}
