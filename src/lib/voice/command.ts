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
import { normalizeTime } from "@/lib/domain/commitments";
import { VISIT_OBJECTIVES } from "@/lib/domain/enums";

export const COMMAND_KINDS = ["VISIT", "FOLLOW_UP", "QUOTE"] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

/** What a follow-up is (2026-11-04): a call or a meeting with a time goes on the agenda. */
export const FOLLOW_UP_TYPES = ["CALL", "MEETING", "TASK"] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

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
        time: z
          .string()
          .nullable()
          .describe(
            "HH:MM on a 24-hour clock when a time of day was said (at 2 → 14:00, 9am → 09:00, às 10h → 10:00, de manhã with no hour → null); null if no time was said.",
          ),
        follow_up_type: z
          .enum(FOLLOW_UP_TYPES)
          .nullable()
          .describe(
            "FOLLOW_UP only: CALL for a phone call; MEETING for a meeting, lunch or video call; TASK for anything else (email, send, sample, reminder). VISIT and QUOTE: null.",
          ),
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
          .describe("Only when the speaker books FOR a named person in the owner list; else null."),
        teammate_membership_id: z
          .string()
          .nullable()
          .describe(
            "When the follow-up is WITH one of GMX's own people (the team list) — call Bia, " +
              "email João — that person's id. account_id and account_heard are then null. Else null.",
          ),
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

/** One of GMX's own people: never an account, and the one a follow-up may be WITH. */
export interface CommandTeammate {
  membershipId: string;
  name: string;
  role: string;
}

export interface Command {
  kind: CommandKind;
  accountId: string | null;
  accountHeard: string | null;
  dueDate: string | null;
  /** "HH:MM", or null when no time was said. */
  time: string | null;
  /** FOLLOW_UP only; null for a visit or a quote. */
  followUpType: FollowUpType | null;
  action: string;
  objective: (typeof VISIT_OBJECTIVES)[number] | null;
  /** null = the speaker themselves. */
  ownerId: string | null;
  /** The teammate the follow-up is with; set means no account is needed. */
  teammateId: string | null;
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
  team: readonly CommandTeammate[] = [],
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
    `- time: only when a time of day was said; read "at 2" in working hours as 14:00. A call or a meeting with a time goes on the agenda; without one it is a reminder.`,
    // GMX'S OWN PEOPLE, one list (Andre, 2026-11-03: "Bia and João should be
    // recognizable as our admins"). A teammate is never a business: "call Bia"
    // is a follow-up WITH Bianca and needs no account; "ask John to send…" is
    // work FOR João. One list, because two (owners and teammates) let the
    // model read "John" as Jason.
    team.length > 0
      ? [
          `- GMX's own people (id: name · role) — never an account, never account_heard. People are often called by a short or English form of their name: Bia is Bianca, John is João (Joao), Tony is Anthony. Match the name said to the person it is a form of, never to a different person whose name merely looks alike. In action, write their name as listed.`,
          ...team.map((t) => `  ${t.membershipId}: ${t.name} · ${t.role}`),
          `  · The speaker does it WITH one of them (call Bia, email João, meet Deonn): teammate_membership_id = them, owner_membership_id null.`,
          reps.length > 0
            ? `  · One of them is to DO it (ask John to send…, João will…, tell Deonn to…, book it for Jason): owner_membership_id = them, teammate_membership_id null; the account is the business named, if any.`
            : `  · The speaker cannot hand work to others: owner_membership_id is always null; someone else doing it is still WITH them.`,
        ].join("\n")
      : `- owner_membership_id and teammate_membership_id: always null.`,
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
  team: readonly CommandTeammate[] = [],
): Command[] {
  const accountIds = new Set(shownAccounts.map((a) => a.id));
  const repIds = new Set(reps.map((r) => r.membershipId));
  const teamIds = new Set(team.map((t) => t.membershipId));
  return raw.commands
    .slice(0, 3)
    .map((c) => ({
      kind: c.kind,
      accountId: c.account_id && accountIds.has(c.account_id) ? c.account_id : null,
      accountHeard: c.account_heard?.trim() || null,
      dueDate: realDate(c.due_date),
      time: c.kind === "QUOTE" ? null : normalizeTime(c.time),
      followUpType:
        c.kind === "FOLLOW_UP"
          ? c.follow_up_type && (FOLLOW_UP_TYPES as readonly string[]).includes(c.follow_up_type)
            ? c.follow_up_type
            : "TASK"
          : null,
      action: c.action.trim().slice(0, 200),
      // OTHER needs a word on what (D48); the card asks rather than guess it.
      objective: c.kind === "VISIT" && c.objective !== "OTHER" ? c.objective : null,
      ownerId: c.owner_membership_id && repIds.has(c.owner_membership_id) ? c.owner_membership_id : null,
      teammateId:
        c.kind === "FOLLOW_UP" && c.teammate_membership_id && teamIds.has(c.teammate_membership_id)
          ? c.teammate_membership_id
          : null,
    }))
    // A teammate heard as a business name is not a business to pick.
    .map((c) => (c.teammateId && !c.accountId ? { ...c, accountHeard: null } : c))
    .filter((c) => c.action.length > 0);
}
