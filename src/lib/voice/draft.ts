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
/** One of the rep's own accounts, offered to the model so it can say WHICH
 *  business the note is about rather than leaving the one required field blank. */
export const accountContextItem = z.object({
  account_id: z.string(),
  name: z.string(),
});
export type AccountContextItem = z.infer<typeof accountContextItem>;

export const routineContextItem = z.object({
  item_id: z.string(),
  kind: z.string(),
  action: z.string(),
});
export type RoutineContextItem = z.infer<typeof routineContextItem>;

export const debriefDraftSchema = z.object({
  /**
   * WHO THE NOTE IS ABOUT, and it is the field that decides whether any of the
   * rest is usable.
   *
   * Everything else here was already being drafted, so a rep who recorded without
   * picking an account arrived at a fully written-up debrief with one empty
   * dropdown between them and saving it. The model had read the note and simply
   * had not been asked the only question that blocked them.
   *
   * Nullable and it means it. A note that names no business, or names one we do
   * not hold, must come back null: a wrong account here does not inconvenience
   * the rep, it files a visit against a company they never went to.
   */
  account_id: z
    .string()
    .nullable()
    .describe(
      "id of the account this debrief is about, chosen from the list of the " +
        "rep's accounts provided; null when the note does not clearly name one",
    ),
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
  /** The account ids the model was actually shown. Omit to drop any proposal —
   *  the right default, because a caller that cannot say what was offered cannot
   *  say the answer was not invented. */
  accountIds: string[] = [],
): DebriefDraft {
  const allowed = new Set(openItemIds);
  const allowedAccounts = new Set(accountIds);
  return {
    ...draft,
    // Same guard as the routine items, for a sharper reason: an invented account
    // id either fails a foreign key on Send or, worse, lands on a real account
    // that happens to match. Only an id we handed over survives.
    account_id:
      draft.account_id && allowedAccounts.has(draft.account_id)
        ? draft.account_id
        : null,
    routine_dispositions: draft.routine_dispositions.filter((d) =>
      allowed.has(d.item_id),
    ),
  };
}

export function extractionPrompt(
  capturedAtIso: string,
  language: string,
  routineContext?: RoutineContextItem[],
  accountContext?: AccountContextItem[],
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

  const parts = [base];

  // The accounts the rep actually holds. Named rather than described, because a
  // rep says "Ganahl" and "the Anaheim yard" while the file says "GANAHL LUMBER
  // - ANAHEIM #4471"; matching that is the model's job and it cannot do it blind.
  if (accountContext && accountContext.length > 0) {
    const list = accountContext
      .map((a) => `- ${a.account_id} — ${a.name}`)
      .join("\n");
    parts.push(`These are the rep's accounts, as "id — name":
${list}
Set account_id to the id of the one this debrief is about, matching the business
the rep names however loosely they say it. If the note names no business, or names
one that is not on this list, set account_id to null — a wrong account files a
visit against a company the rep never went to, so null is always the safer
answer. Never return an id that is not on this list.`);
  }

  if (routineContext && routineContext.length > 0) {
    const items = routineContext
      .map((item) => `- ${item.item_id} (${item.kind}): ${item.action}`)
      .join("\n");
    parts.push(`The rep has these open routine items:
${items}
Propose a disposition ONLY for items the rep explicitly mentioned. Never invent item ids.`);
  }

  return parts.join("\n\n");
}
