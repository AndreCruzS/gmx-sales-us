import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { undoableActions, type LoggedAction } from "../actions-log";
import type { AgentContext } from "../context";
import { fail, ok, type CallToolResult } from "../result";
import { tool, type GetCtx } from "../server";
import { dbProblem, dbRow, dbId } from "./shared";

export { undoableActions };

const CANT = "That can't be undone from here — tell me what to change instead. (To undo an older change, pass its action_id.)";
const CHANGED = "This changed since — tell me what to change instead.";

const LABEL: Record<string, string> = {
  next_actions: "follow-up",
  activities: "visit",
  next_action_notes: "PK note",
  next_action_subtasks: "subtask",
  accounts: "account",
  contacts: "contact",
  account_notes: "account note",
};

const label = (a: LoggedAction) =>
  `${a.op === "create" ? "created" : "changed"} ${LABEL[a.entity] ?? a.entity} (${a.tool}, ${a.created_at})`;

/** Whether undo has any way to reverse this action (before RLS, which can still refuse). */
function reversible(a: LoggedAction): boolean {
  if (a.op === "update") return !!a.before && Object.keys(a.before).length > 0;
  return a.entity === "next_actions" || a.entity === "next_action_subtasks" || a.entity === "account_notes";
}

type Outcome = { line: string } | { problem: CallToolResult };

async function reverse(ctx: AgentContext, a: LoggedAction): Promise<Outcome> {
  if (a.op === "update") {
    if (!a.before || Object.keys(a.before).length === 0) return { problem: fail(CANT) };
    const table = a.entity;
    const { data: cur, error: readErr } = await ctx.db.from(table).select("updated_at").eq("id", a.entity_id).maybeSingle();
    if (readErr) throw readErr;
    if (!cur) return { problem: fail("That record is gone or no longer yours to change.") };
    // This guard only protects the gap between this read and the write: the log keeps no
    // post-write version, so edits made after the agent's change are overwritten by `before`.
    const { data, error } = await ctx.db
      .from(table)
      .update(dbRow(a.before))
      .eq("id", a.entity_id)
      .eq("updated_at", (cur as { updated_at: string }).updated_at)
      .select("id");
    if (error) {
      const known = dbProblem(error);
      if (known) return { problem: known };
      throw error;
    }
    if ((data ?? []).length === 0) return { problem: fail(CHANGED) };
    return { line: `Put back the earlier values on the ${LABEL[a.entity]}.` };
  }

  if (a.entity === "next_actions") {
    const del = await ctx.db.from("next_actions").delete().eq("id", a.entity_id).select("id");
    if (!del.error && (del.data ?? []).length > 0) return { line: "Deleted the follow-up." };
    // Reps cannot delete items (RLS) or another row still refers to it (FK): close it, as the app allows.
    if (del.error && del.error.code !== "42501" && del.error.code !== "23503") throw del.error;
    const { data: cur, error: readErr } = await ctx.db
      .from("next_actions")
      .select("updated_at, completed_at")
      .eq("id", a.entity_id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!cur) return { line: "The follow-up was already gone." };
    if (cur.completed_at) return { line: "It was already closed." };
    const { data, error } = await ctx.db
      .from("next_actions")
      .update(dbRow({ completed_at: new Date().toISOString() }))
      .eq("id", a.entity_id)
      .eq("updated_at", cur.updated_at)
      .is("completed_at", null)
      .select("id");
    if (error) {
      const known = dbProblem(error);
      if (known) return { problem: known };
      throw error;
    }
    if ((data ?? []).length === 0) return { problem: fail(CHANGED) };
    return { line: "Closed it (you can't delete items)." };
  }

  if (a.entity === "next_action_subtasks" || a.entity === "account_notes") {
    const del = await ctx.db.from(a.entity).delete().eq("id", a.entity_id).select("id");
    if (del.error) {
      const known = dbProblem(del.error);
      if (known) return { problem: known };
      throw del.error;
    }
    if ((del.data ?? []).length === 0) return { problem: fail(CANT) };
    return { line: `Deleted the ${LABEL[a.entity]}.` };
  }

  return { problem: fail(CANT) };
}

export async function undoLast(ctx: AgentContext, args: { action_id?: string }): Promise<CallToolResult> {
  const list = await undoableActions(ctx, 50);
  if (list.length === 0) return fail("Nothing to undo: the agent has not changed anything in this conversation in the last 24 hours.");
  let target: LoggedAction | undefined;
  let skipped: LoggedAction[] = [];
  if (args.action_id) {
    target = list.find((x) => x.id === args.action_id);
    if (!target) return fail("That is not something you can undo: it is not in this conversation's list of changes (or it was already undone).");
    if (!reversible(target)) return fail(CANT);
  } else {
    const i = list.findIndex(reversible);
    if (i < 0) return fail(CANT);
    target = list[i];
    skipped = list.slice(0, i);
  }

  // Claim the action first so two concurrent calls cannot both reverse it.
  const claim = await ctx.db
    .from("agent_actions")
    .update({ undone_at: new Date().toISOString() })
    .eq("id", target.id)
    .is("undone_at", null)
    .select("id");
  if (claim.error) throw claim.error;
  if ((claim.data ?? []).length === 0) return fail("That was already undone.");
  const claimed = target;
  const release = async () => {
    await ctx.db.from("agent_actions").update({ undone_at: null }).eq("id", claimed.id);
  };

  let out: Outcome;
  try {
    out = await reverse(ctx, target);
  } catch (e) {
    await release();
    throw e;
  }
  if ("problem" in out) {
    await release();
    return out.problem;
  }

  const remaining = list.filter((x) => x.id !== target.id && !skipped.includes(x)).slice(0, 5);
  const lines = [`Undone: ${label(target)}.`, out.line];
  if (skipped.length) lines.push(`Newer changes that can't be undone from here: ${skipped.map(label).join("; ")}.`);
  if (remaining.length) {
    lines.push("Still undoable, newest first:", ...remaining.map((x, i) => `${i + 1}. ${label(x)} [action_id ${x.id}]`));
  }
  return ok(lines.join("\n"), {
    undone: { id: target.id, tool: target.tool, entity: target.entity, entity_id: target.entity_id },
    remaining: remaining.map((x) => ({ id: x.id, tool: x.tool, entity: x.entity, created_at: x.created_at })),
  });
}

export function registerUndoTools(server: McpServer, getCtx: GetCtx) {
  server.registerTool(
    "undo_last",
    {
      title: "Undo what the agent just did",
      description:
        "Reverses the newest thing this agent changed in this conversation's sign-in session (within 24 hours), or a specific action_id from the list this tool returns. It only does what the person could do in the app: created follow-ups are deleted (or closed when the person cannot delete), changes are put back as they were, subtasks and account notes are deleted; other creations cannot be undone, and you are told so. Always tell the person exactly what was reversed.",
      inputSchema: z.object({
        action_id: dbId().optional().describe("One of the ids listed by an earlier undo_last; default the newest"),
      }),
    },
    tool<{ action_id?: string }>(getCtx, (ctx, a) => undoLast(ctx, a)),
  );
}
