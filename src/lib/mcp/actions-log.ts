import type { Json } from "@/lib/database.types";
import type { AgentContext } from "./context";

export type LoggedEntity =
  | "next_actions"
  | "activities"
  | "next_action_notes"
  | "next_action_subtasks"
  | "accounts"
  | "contacts"
  | "account_notes";

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
