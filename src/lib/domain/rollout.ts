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
