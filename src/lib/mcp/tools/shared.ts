import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { givesWorkToOthers } from "@/lib/domain/roles";
import { checkConfirmation, confirmationReason, issueConfirmation } from "../confirm";
import type { AgentContext } from "../context";
import { fail, needsConfirmation, type CallToolResult } from "../result";

/** App schemas allow null where the generated insert types want undefined; the DB treats both alike. */
export function dbRow(r: object): never {
  return r as never;
}

/** The app's rule (roles.ts givesWorkToOthers), said to the person. */
export const ONLY_ADMINS_ASSIGN =
  "In GMX Sales only an admin gives work to someone else, so I can't either. I can plan it for you instead, or an admin can hand it over.";

export const STALE = "This changed since you read it — read it again.";

// ---- shared helpers -------------------------------------------------------

/** A UUID shaped from sha256(code:index), so replaying a confirmed call upserts the same rows. */
function idFromCode(code: string, index: number): string {
  const h = createHash("sha256").update(`${code}:${index}`).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

export function idMaker(code: string | undefined) {
  return (index: number) => (code ? idFromCode(code, index) : randomUUID());
}

/**
 * The confirmation gate. Returns a needs-confirmation result when the call
 * needs the person's yes and does not carry a valid code; null to proceed.
 */
export function gate(
  ctx: AgentContext,
  toolName: string,
  args: Record<string, unknown>,
  preview: () => string,
  reasonOverride?: string | null,
): CallToolResult | null {
  const reason =
    reasonOverride !== undefined ? reasonOverride : confirmationReason(toolName, args, { membershipId: ctx.me.membershipId });
  if (!reason) return null;
  const given = typeof args.confirmation === "string" ? args.confirmation : undefined;
  const subject = { userId: ctx.me.userId, tool: toolName, args };
  if (given && checkConfirmation(given, subject, new Date())) return null;
  let issued: { code: string; expiresAt: string };
  try {
    issued = issueConfirmation(subject, new Date());
  } catch {
    return fail("Confirmations aren't set up on the server yet — tell Andre.");
  }
  const { code, expiresAt } = issued;
  const lead = given ? "That confirmation code was not valid or has expired. " : "";
  return needsConfirmation(`${lead}${reason} Nothing has been saved yet. It would: ${preview()}`, code, expiresAt);
}

export const validCode = (ctx: AgentContext, toolName: string, args: Record<string, unknown>) =>
  typeof args.confirmation === "string" &&
  checkConfirmation(args.confirmation, { userId: ctx.me.userId, tool: toolName, args }, new Date())
    ? args.confirmation
    : undefined;

/** Turn a database error into something readable aloud, or rethrow. */
export function dbProblem(e: { code?: string; message?: string }, kind?: string): CallToolResult | null {
  if (e.code === "23514") {
    if (kind === "CALL" || kind === "MEETING") return fail(`A ${kind === "CALL" ? "call" : "meeting"} needs a time, zone and duration.`);
    return fail("That time is not valid: a time needs its time zone, and a duration is 5 to 600 minutes.");
  }
  if (e.code === "42501") return fail("You are not allowed to do that.");
  if (e.code === "23503") return fail("One of the ids does not exist — look the account up with find.");
  return null;
}

/**
 * A database id. Not z.string().uuid(): zod 4 enforces the RFC version and
 * variant digits, and the seeded rows prod still uses (Russin is
 * d0000000-0000-0000-0000-000000000007) fail it although Postgres accepts
 * them — the agent could not refer to those accounts (found 2026-11-05).
 */
export const dbId = () =>
  z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "not a GMX Sales id");

/**
 * Whether the OWNER of an item gives work to others (admin or assistant): the
 * owner's role decides the priority, not the caller's. A colleague the caller
 * cannot read counts as a rep (the plainer answer).
 */
export async function ownerGivesWork(ctx: AgentContext, ownerId: string): Promise<boolean> {
  if (ownerId === ctx.me.membershipId) return givesWorkToOthers(ctx.me.role);
  const { data } = await ctx.db.from("memberships").select("role").eq("id", ownerId).maybeSingle();
  return givesWorkToOthers(data?.role);
}
