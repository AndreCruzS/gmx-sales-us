// The four gates from the California rollout tracker, named once.
//
// The order is the order the business walks a branch through, which is why the
// tracker's columns are in it — the class teaches the counter staff, the
// merchandiser owns the bay, the wall goes up, the material arrives. Reading
// order is not the same as dependency: a branch can clear a later gate with an
// earlier one still open, and the whole point of the book is that many do.

export interface RolloutCounts {
  branches: number | null;
  pk_done: number | null;
  merchandiser_done: number | null;
  display_wall_done: number | null;
  material_done: number | null;
  fully_through: number | null;
  not_started?: number | null;
  // Her sheet records ok / pending / no. Counting only the "ok"s made a branch
  // with a merchandiser being hired look like one where nobody had started.
  pk_pending?: number | null;
  merchandiser_pending?: number | null;
  display_wall_pending?: number | null;
  material_pending?: number | null;
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
}[] = [
  {
    key: "pk_done",
    pendingKey: "pk_pending",
    label: "PK class done",
    hint: "The counter staff know what they are selling",
  },
  {
    key: "merchandiser_done",
    pendingKey: "merchandiser_pending",
    label: "Merchandiser assigned",
    hint: "Somebody owns the bay",
  },
  {
    key: "display_wall_done",
    pendingKey: "display_wall_pending",
    label: "Display wall up",
    hint: "There is something to point at",
  },
  {
    key: "material_done",
    pendingKey: "material_pending",
    label: "Material in stock",
    hint: "They can sell it the day it is asked for",
  },
];
