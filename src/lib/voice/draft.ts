// The shape the AI extraction must produce (spec §5 step 5): the prose summary
// AND the structured Activity fields plus concrete next actions with dates.
// This is a DRAFT — nothing becomes a record until the rep reviews it (D9).

import { z } from "zod";
import { MATRIX_RULES, suggestDeadline } from "@/lib/domain/eisenhower";
import {
  defaultDeadline,
  derivePriority,
  isTask,
  storedPriority,
} from "@/lib/domain/deadline";
import type { Priority } from "@/lib/domain/pk-follow-up";
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
          .nullable()
          .describe(
            "ONLY a date that was said, resolved from the capture date; null when " +
              "none was said (the code sets the default and the urgent cap)",
          ),
        objective: z.enum(VISIT_OBJECTIVES).nullable(),
        kind: z
          .enum(["SAMPLE_FOLLOW_UP", "QUOTE_FOLLOW_UP", "VISIT", "OTHER"])
          .nullable(),
        // PK by voice (spec 2026-11-04 one-mic §4, part A), drafted only when
        // the note is a PK. Defaults keep every draft stored before them valid.
        // The priority is NOT drafted: the model says whether it is important
        // and whether it was urgent (said or implied); draftedAction() below
        // turns those and the deadline into the priority. Drafts stored
        // before it may still carry a `priority`.
        urgent: z
          .boolean()
          .nullable()
          .default(null)
          .describe("urgent: said or implied; null on a VISIT, CALL or MEETING"),
        important: z
          .boolean()
          .nullable()
          .default(null)
          .describe("the IMPORTANT answer; null on a VISIT, CALL or MEETING"),
        asked_by_dealer: z
          .boolean()
          .nullable()
          .default(null)
          .describe("true when the dealer asked for it or GMX promised it to them"),
        priority_reason: z
          .string()
          .nullable()
          .default(null)
          .describe('at most 15 words, "Important: … · Due: …"; null on a VISIT, CALL or MEETING'),
        progress: z
          .enum(["NOT_STARTED", "WORKING_ON_IT", "WAITING"])
          .nullable()
          .default(null)
          .describe("PK only: WAITING when the ball is with the dealer; WORKING_ON_IT when already under way; else NOT_STARTED"),
        subtasks: z
          .array(z.string())
          .default([])
          .describe("PK only: the parts of THIS follow-up when the rep lists them (the PDF, the data sheets, the sample book); empty otherwise"),
        note: z
          .string()
          .nullable()
          .default(null)
          .describe("PK only: context said about this item that is not the action itself, at most two sentences, never invented"),
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
  // The people the note carries (Andre, 2026-09-02): a debrief often ends
  // with "she sent me the contacts" and a recitation of names and e-mails
  // that used to land in key_information as a text blob nobody could call.
  // Each one extracted here is OFFERED on review — checked by default,
  // nothing saved without the rep looking (D9).
  contacts: z
    .array(
      z.object({
        name: z.string().describe("the person's name, exactly as spoken"),
        job_title: z
          .string()
          .nullable()
          .describe(
            "their role or place as given — 'Marketing Manager', 'Atwater yard' — null when none was said",
          ),
        email: z.string().nullable().describe("e-mail exactly as given, lowercased"),
        phone: z.string().nullable().describe("phone number exactly as given"),
      }),
    )
    .default([])
    .describe(
      "people the note names WITH a detail worth keeping — an e-mail, a phone, " +
        "a role at an account. People merely mentioned in passing, with nothing " +
        "to reach them by and no stated role, do not belong here. Never invent " +
        "or complete a detail that was not said. Empty when none.",
    ),
});
// The INPUT shape: drafts stored before a field existed lack it, so every
// defaulted field reads as optional here and is defaulted where it is used.
export type DebriefDraft = z.input<typeof debriefDraftSchema>;

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
    // Hygiene, not judgment: a contact suggestion needs a name and at least
    // one thing worth keeping — reachability or a role. What survives is
    // still only an OFFER; the review gate decides. `?? []` because drafts
    // extracted before the field existed lack it.
    contacts: (draft.contacts ?? [])
      .map((c) => ({
        name: c.name.trim(),
        job_title: c.job_title?.trim() || null,
        email: c.email?.trim().toLowerCase() || null,
        phone: c.phone?.trim() || null,
      }))
      .filter((c) => c.name && (c.email || c.phone || c.job_title)),
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
capture date. Every follow-up or promise gets a next action; its due_date is a concrete date
only when one was said, otherwise null. If no follow-ups were mentioned, return an empty next_actions array and
follow_up_required=false.

When the note names PEOPLE with details worth keeping — an e-mail address, a
phone number, a role or a yard/branch they answer for — list each one in
contacts, exactly as spoken. A recited list of contacts ("she sent me the
contacts: Robert at Atwater, robertd@...") is the classic case: every entry
becomes one contact. Spell e-mails out plainly (lowercase); never guess at or
complete a detail that was not said. People mentioned only in passing, with
nothing to reach them by and no stated role, are not contacts.

EVERY follow-up that is a task (not a VISIT, CALL or MEETING being booked) carries
urgent, important and priority_reason (the rules below), asked_by_dealer (true
when the dealer asked for it or it was promised to them) and a due_date that is
ONLY a date said out loud, null when none was said (the code sets the default
and caps an urgent one). A VISIT, CALL or MEETING keeps the date said and leaves
urgent, important and priority_reason null.

A note about a product-knowledge training — a "PK", a "treinamento", a training
given to a dealer's staff — is activity_type PK_TRAINING. On a PK only, each
next action also carries: progress (WAITING when the ball is with the dealer,
WORKING_ON_IT when already under way, else NOT_STARTED); subtasks (only when the
rep lists the parts of one follow-up — separate follow-ups stay separate
actions); and note (context said about that item, never invented). On any other
note leave those three null or empty.

${MATRIX_RULES}`;

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

/** What a drafted follow-up becomes in the debrief sheet: its deadline and its
 *  priority, worked out by the code (never the model) from what was said.
 *  VISIT/CALL/MEETING keep their booked date and take no priority. `today` is
 *  the device's local date; `pkDate` the PK's own date (PK defaults count from it). */
export interface DraftedAction {
  due_date: string;
  important: boolean | null;
  /** What may be stored; never ELIMINATE. */
  priority: Priority | null;
  /** False on a PK when the answers say Eliminate: not saved unless the person
   *  keeps it. Everyday (non-PK) follow-ups are always kept, as before
   *  2026-11-10; the sheet only asks "Eliminate?" and the person decides. */
  keep: boolean;
}

export function draftedAction(
  na: {
    due_date?: string | null;
    kind?: string | null;
    urgent?: boolean | null;
    important?: boolean | null;
    asked_by_dealer?: boolean | null;
    priority?: Priority | null;
  },
  ctx: { today: string; pkDate: string; isPk: boolean; ownerGivesWork: boolean },
): DraftedAction {
  const kind = na.kind ?? null;
  const fallback = defaultDeadline(kind, ctx.isPk, ctx.isPk ? ctx.pkDate : ctx.today);
  if (!isTask(kind)) {
    return { due_date: na.due_date ?? fallback, important: null, priority: null, keep: true };
  }
  // What the dealer asked for, or GMX promised, has them waiting: urgent.
  const urgent = na.urgent === true || na.asked_by_dealer === true;
  const due = suggestDeadline(
    { urgent, said_date: na.due_date ?? null },
    fallback,
    ctx.today,
  );
  const important = na.important ?? null;
  if (important === null) {
    // An older draft carried its own priority: it stands.
    const legacy = na.priority ?? null;
    return {
      due_date: due,
      important: null,
      priority: legacy === "ELIMINATE" ? null : legacy,
      keep: !ctx.isPk || legacy !== "ELIMINATE",
    };
  }
  return {
    due_date: due,
    important,
    priority: storedPriority(important, due, ctx.today, ctx.ownerGivesWork),
    keep: !ctx.isPk || derivePriority(important, due, ctx.today, ctx.ownerGivesWork) !== "ELIMINATE",
  };
}
