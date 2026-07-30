// The shape the AI extraction must produce (spec §5 step 5): the prose summary
// AND the structured Activity fields plus concrete next actions with dates.
// This is a DRAFT — nothing becomes a record until the rep reviews it (D9).

import { z } from "zod";
import {
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  VISIT_OBJECTIVES,
} from "@/lib/domain/enums";

// A routine item (chore) the rep already had open, offered to the model as
// context so it can propose a disposition instead of inventing one from
// scratch. Mirrors src/lib/routine/items.ts's shape at the id/kind/action
// level — kept as a plain string trio here since the extraction prompt only
// ever needs to print it, not act on it.
export const routineContextItem = z.object({
  item_id: z.string(),
  kind: z.string(),
  action: z.string(),
});
export type RoutineContextItem = z.infer<typeof routineContextItem>;

export const debriefDraftSchema = z.object({
  summary: z.string().describe("2-3 sentence prose summary of the debrief"),
  activity_type: z
    .enum(ACTIVITY_TYPES)
    .describe("best-fit activity type for what was described"),
  what_happened: z.string().describe("what happened, in the rep's terms"),
  key_information: z
    .string()
    .nullable()
    .describe("commercially useful facts learned (stock, competitors, people)"),
  commercial_potential: z
    .string()
    .nullable()
    .describe("assessment of commercial potential, if any was voiced"),
  outcomes: z.array(z.enum(ACTIVITY_OUTCOMES)),
  follow_up_required: z.boolean(),
  next_actions: z
    .array(
      z.object({
        action: z.string(),
        due_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("concrete date; resolve relative mentions from the capture date"),
        objective: z.enum(VISIT_OBJECTIVES).nullable(),
        kind: z
          .enum(["SAMPLE_FOLLOW_UP", "QUOTE_FOLLOW_UP", "VISIT", "OTHER"])
          .nullable(),
      }),
    )
    .describe("every commitment or follow-up mentioned, with a date each"),
  routine_dispositions: z
    .array(
      z.object({
        item_id: z
          .string()
          .describe("id of an open routine item explicitly addressed"),
        disposition: z.enum(["DONE", "DISPLAY_VERIFIED"]),
        note: z.string().nullable(),
      }),
    )
    .describe("ONLY items the rep actually addressed; empty when none"),
});
export type DebriefDraft = z.infer<typeof debriefDraftSchema>;

// The hallucination guard (spec: dispositions must never reference an item
// id the model invented). Filters routine_dispositions down to ones whose
// item_id is actually among the open items we told the model about. Returns
// a new object/array — the caller's draft is never mutated.
export function sanitizeDraft(
  draft: DebriefDraft,
  openItemIds: string[],
): DebriefDraft {
  const allowed = new Set(openItemIds);
  return {
    ...draft,
    routine_dispositions: draft.routine_dispositions.filter((d) =>
      allowed.has(d.item_id),
    ),
  };
}

export function extractionPrompt(
  capturedAtIso: string,
  language: string,
  routineContext?: RoutineContextItem[],
) {
  const base = `You are processing a field sales rep's voice debrief for a building-materials
distributor CRM (two-step distribution: manufacturer → distributor → dealer →
contractor/architect). The debrief was captured at ${capturedAtIso}.
The rep speaks ${language === "pt" ? "Portuguese" : language === "es" ? "Spanish" : "English"};
produce all output fields in English, keeping proper nouns as spoken.

Extract ONLY what was actually said — do not invent commitments, dates, or
assessments. Resolve relative dates ("next Friday", "in two weeks") against the
capture date. Every follow-up or promise gets a next action with a concrete
date. If no follow-ups were mentioned, return an empty next_actions array and
follow_up_required=false.`;

  if (!routineContext || routineContext.length === 0) {
    return base;
  }

  const items = routineContext
    .map((item) => `- ${item.item_id} (${item.kind}): ${item.action}`)
    .join("\n");

  return `${base}

The rep has these open routine items:
${items}
Propose a disposition ONLY for items the rep explicitly mentioned. Never invent item ids.`;
}
