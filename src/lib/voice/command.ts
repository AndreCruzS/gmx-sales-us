// SAY IT (Andre, 2026-10-20: "o sistema está munido do agente de voz ser
// capaz de criar uma visita pra mim? Ou o quote ... alguma autonomia?").
//
// One spoken sentence from anywhere in the app — "book me Ganahl Anaheim on
// Thursday to collect the quote", "remind me to call Truckee Monday", "quote
// Boise 2000 feet of ipe 1x6" — read into at most three commands, each shown
// as one card to confirm with a tap. The model proposes; the person is the
// gate, as with every AI output in this app.
//
// Pure: the schema the model fills, the prompt it reads, and the sanitiser
// that holds every id and date it returns against what it was actually shown.

import { z } from "zod";
import { VISIT_OBJECTIVES } from "@/lib/domain/enums";

export const COMMAND_KINDS = ["VISIT", "FOLLOW_UP", "QUOTE"] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

export const commandSchema = z.object({
  commands: z
    .array(
      z.object({
        kind: z.enum(COMMAND_KINDS),
        account_id: z
          .string()
          .nullable()
          .describe("An id from the account list, or null when none clearly matches."),
        account_heard: z
          .string()
          .nullable()
          .describe("The business name as spoken, for the rep to recognise."),
        due_date: z
          .string()
          .nullable()
          .describe("YYYY-MM-DD, resolved from what was said against today; null if no day was said."),
        action: z
          .string()
          .describe("A short imperative line for the agenda, in the language spoken."),
        objective: z
          .enum(VISIT_OBJECTIVES)
          .nullable()
          .describe("VISIT only: the purpose of the visit."),
        owner_membership_id: z
          .string()
          .nullable()
          .describe("Only when the speaker books FOR a named rep in the rep list; else null."),
      }),
    )
    .max(3),
});
export type RawCommands = z.infer<typeof commandSchema>;

export interface CommandAccount {
  id: string;
  name: string;
  city: string | null;
}

export interface CommandRep {
  membershipId: string;
  name: string;
}

export interface Command {
  kind: CommandKind;
  accountId: string | null;
  accountHeard: string | null;
  dueDate: string | null;
  action: string;
  objective: (typeof VISIT_OBJECTIVES)[number] | null;
  /** null = the speaker themselves. */
  ownerId: string | null;
}

const STOP = new Set([
  "the", "and", "for", "inc", "llc", "co", "company", "lumber", "supply",
  "building", "materials", "hardwood", "hardwoods", "wood", "group",
]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * The accounts worth showing the model: those sharing a word with what was
 * said, best first. A rep can see hundreds of doors; the sentence names one or
 * two, and a short list keeps the model's choice honest. Nothing shares a word
 * → nothing is shown, and the card asks the rep to pick.
 */
export function candidateAccounts(
  transcript: string,
  accounts: readonly CommandAccount[],
  limit = 40,
): CommandAccount[] {
  const heard = new Set(words(transcript));
  if (heard.size === 0) return [];
  return accounts
    .map((a) => {
      const own = words(`${a.name} ${a.city ?? ""}`);
      const score = own.filter((w) => heard.has(w)).length;
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name))
    .slice(0, limit)
    .map((x) => x.a);
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function commandPrompt(
  today: string,
  accounts: readonly CommandAccount[],
  reps: readonly CommandRep[],
): string {
  const weekday = DOW[new Date(`${today}T12:00:00Z`).getUTCDay()];
  return [
    `You turn a wood-products sales rep's spoken request into commands for their CRM.`,
    `Today is ${weekday} ${today}. Resolve "Thursday", "next week", "amanhã", "dia 30" to a YYYY-MM-DD on or after today; "next <weekday>" is the first one after today. No day said → null.`,
    ``,
    `Kinds:`,
    `- VISIT: going to see a business in person (visit, stop by, passar lá, ride-along). Set objective: COLLECT_QUOTE, MEET_CONTRACTOR, CONVERT_STOCKING_DEALER, FOLLOW_UP_LEAD, PK_DELIVERY, MERCHANDISING_CHECK, RELATIONSHIP_MAINTENANCE, or OTHER.`,
    `- FOLLOW_UP: a call, email, sample or reminder — anything to do that is not a visit and not drafting a quote.`,
    `- QUOTE: the rep wants a quote drafted now (products, sizes, quantities). The action is the products as said.`,
    ``,
    `Rules:`,
    `- Only what was asked. Small talk, or nothing actionable → an empty commands list.`,
    `- account_id ONLY from the list below, when the name clearly matches; otherwise null with account_heard set.`,
    `- action: short and concrete, in the language spoken (e.g. "Collect the decking quote", "Ligar ao comprador sobre a amostra").`,
    reps.length > 0
      ? `- owner_membership_id: only when the speaker books it FOR one of these reps by name; else null.\n${reps.map((r) => `  ${r.membershipId}: ${r.name}`).join("\n")}`
      : `- owner_membership_id: always null.`,
    ``,
    accounts.length > 0
      ? `Accounts (id: name · city):\n${accounts.map((a) => `${a.id}: ${a.name}${a.city ? ` · ${a.city}` : ""}`).join("\n")}`
      : `Accounts: none matched what was said — account_id is null.`,
  ].join("\n");
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function realDate(s: string | null): string | null {
  if (!s || !ISO.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/** Holds what the model said against what it was shown. */
export function sanitizeCommands(
  raw: RawCommands,
  shownAccounts: readonly CommandAccount[],
  reps: readonly CommandRep[],
): Command[] {
  const accountIds = new Set(shownAccounts.map((a) => a.id));
  const repIds = new Set(reps.map((r) => r.membershipId));
  return raw.commands
    .slice(0, 3)
    .map((c) => ({
      kind: c.kind,
      accountId: c.account_id && accountIds.has(c.account_id) ? c.account_id : null,
      accountHeard: c.account_heard?.trim() || null,
      dueDate: realDate(c.due_date),
      action: c.action.trim().slice(0, 200),
      // OTHER needs a word on what (D48); the card asks rather than guess it.
      objective: c.kind === "VISIT" && c.objective !== "OTHER" ? c.objective : null,
      ownerId: c.owner_membership_id && repIds.has(c.owner_membership_id) ? c.owner_membership_id : null,
    }))
    .filter((c) => c.action.length > 0);
}
