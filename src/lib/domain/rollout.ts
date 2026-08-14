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
}

export type GateKey =
  | "pk_done"
  | "merchandiser_done"
  | "display_wall_done"
  | "material_done";

export const PIPELINE_GATES: readonly {
  key: GateKey;
  label: string;
  hint: string;
}[] = [
  {
    key: "pk_done",
    label: "PK class done",
    hint: "The counter staff know what they are selling",
  },
  {
    key: "merchandiser_done",
    label: "Merchandiser assigned",
    hint: "Somebody owns the bay",
  },
  {
    key: "display_wall_done",
    label: "Display wall up",
    hint: "There is something to point at",
  },
  {
    key: "material_done",
    label: "Material in stock",
    hint: "They can sell it the day it is asked for",
  },
];
