// ONE MICROPHONE (spec 2026-11-04-one-mic-design.md): one reading of anything
// a rep says. What HAPPENED becomes the visit (the debrief draft, as before);
// what is promised at that visit becomes its follow-ups (next_actions, as
// before); what is to be BOOKED — a visit, a call or a meeting with a time, a
// quote, or any to-do when no visit was described — becomes the bookings,
// read exactly as Say it reads them (lib/voice/command.ts).
//
// Pure: the schema, the prompt, and the sanitiser. Nothing is written by the
// model; the rep confirms every card (D9).

import { z } from "zod";
import {
  bookingRules,
  commandSchema,
  sanitizeCommands,
  type Command,
  type CommandAccount,
  type CommandRep,
  type CommandTeammate,
} from "./command";
import {
  debriefDraftSchema,
  extractionPrompt,
  sanitizeDraft,
  type DebriefDraft,
  type RoutineContextItem,
} from "./draft";

export const sayDraftSchema = debriefDraftSchema.extend({
  has_visit: z
    .boolean()
    .describe(
      "true ONLY when the rep reports something that already happened with a business — " +
        "a visit, a PK, a call or a meeting that took place. false when everything said is to be done or booked.",
    ),
  bookings: z
    .array(commandSchema.shape.commands.element)
    .max(5)
    .describe(
      "things to BOOK: a visit to make, a call or meeting WITH a time of day, a quote to draft; " +
        "and, when has_visit is false, every to-do as well. Empty when none.",
    ),
});
export type SayDraftRaw = z.infer<typeof sayDraftSchema>;

/**
 * What a processed capture stores in ai_draft: the debrief draft as before,
 * plus whether there was a visit, the sanitised bookings, and the people lists
 * the booking cards need (who a follow-up is with, who it may be booked for).
 * Every new field is optional, so drafts stored before this read as a visit
 * with no bookings — exactly what they were.
 */
export type SayStoredDraft = DebriefDraft & {
  has_visit?: boolean;
  commands?: Command[];
  reps?: CommandRep[];
  team?: CommandTeammate[];
};

/** A draft stored before one-mic is a visit. */
export function hasVisit(d: Pick<SayStoredDraft, "has_visit">): boolean {
  return d.has_visit !== false;
}

export function sayPrompt(opts: {
  capturedAtIso: string;
  language: string;
  today: string;
  routineContext?: RoutineContextItem[];
  accounts: readonly CommandAccount[];
  reps: readonly CommandRep[];
  team: readonly CommandTeammate[];
}): string {
  const debrief = extractionPrompt(
    opts.capturedAtIso,
    opts.language,
    opts.routineContext,
    opts.accounts.map((a) => ({
      account_id: a.id,
      name: a.city ? `${a.name} · ${a.city}` : a.name,
    })),
  );
  return [
    debrief,
    `WHAT HAPPENED, AND WHAT TO BOOK (one note can hold both).
- has_visit: true only when the note reports something that already happened with a business (was at, trained, met, called, they told me, fui na, treinei). Then summary, what_happened, activity_type, outcomes and the rest describe it, as above.
- When has_visit is false, nothing happened yet: summary is one line restating the request, what_happened is the same line, outcomes is empty, follow_up_required is false, and next_actions is empty.
- next_actions are ONLY the follow-ups promised at the visit described, with no clock time ("send them the literature tomorrow", "they want samples").
- bookings are everything to BOOK: a visit to make, a call or a meeting with a time of day, a quote to draft — whether or not it came out of the visit — and, when has_visit is false, every to-do too. Never put the same thing in both lists.
- bookings use the account ids from the same accounts list.`,
    `BOOKINGS:\n${bookingRules(opts.today, opts.reps, opts.team).join("\n")}`,
  ].join("\n\n");
}

const NOISE = new Set([
  "the", "and", "for", "with", "about", "their", "them", "they", "our", "from", "this", "that",
  "lumber", "supply", "co", "inc", "llc", "company", "to", "at", "on", "of", "a", "an",
]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !NOISE.has(w)),
  );
}

/**
 * Two lines that say the same thing: most of the shorter one's words are in
 * the other ("Call Buffalo Lumber buyer about samples" · "Call buyer about
 * samples"). The model puts one request in both lists often enough that the
 * cards must not trust it not to.
 */
export function sameThing(a: string, b: string): boolean {
  const x = tokens(a);
  const y = tokens(b);
  const small = x.size <= y.size ? x : y;
  const big = small === x ? y : x;
  if (small.size === 0) return false;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared += 1;
  return shared / small.size >= 0.75;
}

/** The draft as it is stored: the debrief guarded as before, the bookings as Say it guards them. */
export function sanitizeSayDraft(
  raw: SayDraftRaw,
  ctx: {
    openItemIds: string[];
    accounts: readonly CommandAccount[];
    reps: readonly CommandRep[];
    team: readonly CommandTeammate[];
    speakerId: string;
  },
): SayStoredDraft {
  const { has_visit, bookings, ...debrief } = raw;
  const draft = sanitizeDraft(
    debrief,
    ctx.openItemIds,
    ctx.accounts.map((a) => a.id),
  );
  const commands = sanitizeCommands({ commands: bookings }, ctx.accounts, ctx.reps, ctx.team, ctx.speakerId);
  // A plain to-do said with a visit is that visit's follow-up, whatever list
  // the model put it in (2026-11-04: "they want the literature tomorrow" came
  // back as a booking): no clock, nobody else, the same door, and a day.
  const followUp = (c: Command) =>
    has_visit &&
    c.kind === "FOLLOW_UP" &&
    c.followUpType === "TASK" &&
    !c.teammateId &&
    !c.ownerId &&
    c.dueDate !== null &&
    (c.accountId === null || c.accountId === draft.account_id);
  const kept = commands.filter((c) => !followUp(c));
  // A follow-up that repeats a booking is the booking (it carries the time,
  // the type, the person); a moved to-do that repeats a follow-up is dropped.
  const visitActions = draft.next_actions.filter(
    (na) => !kept.some((c) => sameThing(na.action, c.action)),
  );
  const moved = commands
    .filter(followUp)
    .filter((c) => !visitActions.some((na) => sameThing(na.action, c.action)))
    .map((c) => ({
      action: c.action,
      due_date: c.dueDate as string,
      objective: null,
      kind: null,
    }));
  return {
    ...draft,
    // Nothing happened yet: no follow-ups of a visit that does not exist.
    next_actions: has_visit ? [...visitActions, ...moved] : [],
    has_visit,
    commands: kept,
    reps: [...ctx.reps],
    team: [...ctx.team],
  };
}
