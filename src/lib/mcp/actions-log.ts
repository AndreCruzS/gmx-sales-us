import type { Json } from "@/lib/database.types";
import type { AgentContext } from "./context";

export type LoggedEntity =
  | "next_actions"
  | "activities"
  | "next_action_notes"
  | "next_action_subtasks"
  | "accounts"
  | "contacts"
  | "account_notes"
  | "account_relationships";

/**
 * One row per agent write; it backs undo. `before` holds the prior values of
 * the fields an update changed. org_id and user_id come from the JWT defaults.
 */
export async function logAction(
  ctx: AgentContext,
  a: { tool: string; entity: LoggedEntity; entityId: string; op: "create" | "update"; before?: Record<string, unknown> },
): Promise<void> {
  const { error } = await ctx.db.from("agent_actions").insert({
    session_id: ctx.sessionId,
    via: ctx.via,
    tool: a.tool,
    entity: a.entity,
    entity_id: a.entityId,
    op: a.op,
    before: (a.before ?? null) as Json | null,
  });
  if (error) throw error;
}

export const NO_UNDO = "Undo won't be available for this one.";

/**
 * The write already happened. A log failure must not read as "try again" (that
 * would repeat the write): it only costs the undo. Returns a line to add to the
 * receipt, or null when the action was logged.
 */
export async function logActionQuiet(ctx: AgentContext, a: Parameters<typeof logAction>[1]): Promise<string | null> {
  try {
    await logAction(ctx, a);
    return null;
  } catch (e) {
    console.error("[mcp] could not log an action (undo unavailable):", e);
    return NO_UNDO;
  }
}

export type LoggedAction = {
  id: string;
  tool: string;
  entity: LoggedEntity;
  entity_id: string;
  op: "create" | "update";
  before: Record<string, unknown> | null;
  undone_at: string | null;
  created_at: string;
};

/** What this agent did in this sign-in session in the last 24 hours and has not undone, newest first. */
export async function undoableActions(ctx: AgentContext, limit = 10): Promise<LoggedAction[]> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data, error } = await ctx.db
    .from("agent_actions")
    .select("id, tool, entity, entity_id, op, before, undone_at, created_at")
    .eq("user_id", ctx.me.userId)
    .eq("session_id", ctx.sessionId)
    .gt("created_at", since)
    .is("undone_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as LoggedAction[];
}
