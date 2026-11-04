import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ACTIVITY_OUTCOMES, ACTIVITY_TYPES, VISIT_OBJECTIVES } from "@/lib/domain/enums";
import { activityCreateSchema, nextActionCreateSchema, nextActionUpdateSchema } from "@/lib/domain/schemas";
import { logAction } from "../actions-log";
import type { AgentContext } from "../context";
import { dbProblem, dbRow, gate, idMaker, STALE, validCode } from "./shared";
import { receipt } from "../receipt";
import { fail, ok, type CallToolResult } from "../result";
import { tool, type GetCtx } from "../server";

const KINDS = ["SAMPLE_FOLLOW_UP", "QUOTE_FOLLOW_UP", "VISIT", "CALL", "MEETING", "OTHER"] as const;
type Kind = (typeof KINDS)[number];

export type TimedArgs = {
  kind?: Kind;
  due_time?: string;
  time_zone?: string;
  duration_minutes?: number;
};
export type PlanFollowUpArgs = TimedArgs & {
  action: string;
  due_date: string;
  account_id?: string;
  owner_id?: string;
  objective?: (typeof VISIT_OBJECTIVES)[number];
  confirmation?: string;
};
export type UpdateFollowUpArgs = {
  id: string;
  updated_at: string;
  due_date?: string;
  due_time?: string;
  time_zone?: string;
  duration_minutes?: number;
  action?: string;
  owner_id?: string;
  done?: boolean;
  confirmation?: string;
};
export type LogVisitArgs = {
  account_id: string;
  activity_type: (typeof ACTIVITY_TYPES)[number];
  occurred_at: string;
  what_happened: string;
  outcomes?: (typeof ACTIVITY_OUTCOMES)[number][];
  objective?: (typeof VISIT_OBJECTIVES)[number];
  planned_action_id?: string;
  follow_ups?: (TimedArgs & { action: string; due_date: string })[];
  confirmation?: string;
};
export type ListAgendaArgs = { from: string; to: string; owner_id?: string; limit?: number; offset?: number };

function timedProblem(t: TimedArgs): string | null {
  const timed = t.kind === "CALL" || t.kind === "MEETING";
  const word = t.kind === "CALL" ? "call" : "meeting";
  if (timed && (!t.due_time || !t.time_zone || !t.duration_minutes)) {
    return `A ${word} needs a time, zone and duration.`;
  }
  if ((t.due_time == null) !== (t.time_zone == null)) return "A time needs its time zone, and a zone needs its time.";
  return null;
}

const when = (d: string, t?: string | null) => (t ? `${d} at ${t.slice(0, 5)}` : d);

// ---- list_agenda ----------------------------------------------------------

export async function listAgenda(ctx: AgentContext, args: ListAgendaArgs): Promise<CallToolResult> {
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(args.offset ?? 0), 0);
  const owner = args.owner_id ?? ctx.me.membershipId;
  const since = new Date(Date.now() - 2 * 86400_000).toISOString();
  const { data, error } = await ctx.db
    .from("next_actions")
    .select(
      "id, action, due_date, due_time, time_zone, duration_minutes, kind, completed_at, account_id, owner_id, objective, created_via, updated_at",
    )
    .eq("owner_id", owner)
    .gte("due_date", args.from)
    .lte("due_date", args.to)
    .or(`completed_at.is.null,completed_at.gte.${since}`)
    .order("due_date")
    .order("due_time", { nullsFirst: true })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return ok(`Nothing on the agenda from ${args.from} to ${args.to}.`, { items: [], offset, limit });
  const lines = rows.map(
    (r) =>
      `- ${when(r.due_date, r.due_time)}: ${r.action}${r.kind ? ` [${r.kind}]` : ""}${r.completed_at ? " (done)" : ""} — id ${r.id}, updated_at ${r.updated_at}`,
  );
  const more = rows.length === limit ? `\nThere may be more: call again with offset ${offset + limit}.` : "";
  return ok(`${rows.length} item${rows.length === 1 ? "" : "s"}:\n${lines.join("\n")}${more}`, { items: rows, offset, limit });
}

// ---- plan_follow_up -------------------------------------------------------

export async function planFollowUp(ctx: AgentContext, args: PlanFollowUpArgs): Promise<CallToolResult> {
  const bad = timedProblem(args);
  if (bad) return fail(bad);
  const owner = args.owner_id ?? ctx.me.membershipId;
  const held = gate(ctx, "plan_follow_up", args, () => `plan "${args.action}" for ${when(args.due_date, args.due_time)}, owned by someone else.`);
  if (held) return held;

  const id = idMaker(validCode(ctx, "plan_follow_up", args))(0);
  const row = nextActionCreateSchema.parse({
    id,
    org_id: ctx.me.orgId,
    action: args.action,
    owner_id: owner,
    due_date: args.due_date,
    account_id: args.account_id,
    objective: args.objective,
    kind: args.kind,
    due_time: args.due_time,
    time_zone: args.time_zone,
    duration_minutes: args.duration_minutes,
    source: "MANUAL",
  });
  const { data, error } = await ctx.db
    .from("next_actions")
    .upsert(dbRow({ ...row, created_via: ctx.via }), { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) {
    const known = dbProblem(error, args.kind);
    if (known) return known;
    throw error;
  }
  if ((data ?? []).length > 0) await logAction(ctx, { tool: "plan_follow_up", entity: "next_actions", entityId: id, op: "create" });

  return ok(
    receipt([`Planned: ${args.action}, ${when(args.due_date, args.due_time)}. Record ${id}.`], [{ id, path: `/visits?item=${id}` }]),
    { id },
  );
}

// ---- update_follow_up -----------------------------------------------------

export async function updateFollowUp(ctx: AgentContext, args: UpdateFollowUpArgs): Promise<CallToolResult> {
  const held = gate(ctx, "update_follow_up", args, () => `change follow-up ${args.id} so it belongs to someone else.`);
  if (held) return held;

  const base = nextActionUpdateSchema.parse({
    id: args.id,
    due_date: args.due_date,
    action: args.action,
    owner_id: args.owner_id,
    completed_at: args.done === undefined ? undefined : args.done ? new Date().toISOString() : null,
  });
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) if (k !== "id" && v !== undefined) patch[k] = v;
  if (args.due_time !== undefined) patch.due_time = args.due_time;
  if (args.time_zone !== undefined) patch.time_zone = args.time_zone;
  if (args.duration_minutes !== undefined) patch.duration_minutes = args.duration_minutes;
  if (Object.keys(patch).length === 0) return fail("Nothing to change — say what should be different.");

  const keys = Object.keys(patch).join(", ");
  const { data: prior, error: readErr } = await ctx.db.from("next_actions").select(keys).eq("id", args.id).maybeSingle();
  if (readErr) throw readErr;
  if (!prior) return fail("I can't find that follow-up (or it isn't yours to change).");

  const { data, error } = await ctx.db
    .from("next_actions")
    .update(dbRow(patch))
    .eq("id", args.id)
    .eq("updated_at", args.updated_at)
    .select("id");
  if (error) {
    const known = dbProblem(error);
    if (known) return known;
    throw error;
  }
  if ((data ?? []).length === 0) return fail(STALE);
  await logAction(ctx, {
    tool: "update_follow_up",
    entity: "next_actions",
    entityId: args.id,
    op: "update",
    before: prior as unknown as Record<string, unknown>,
  });
  const verb = args.done ? "Marked done" : "Updated";
  return ok(receipt([`${verb}: follow-up ${args.id}.`], [{ id: args.id, path: `/visits?item=${args.id}` }]), { id: args.id });
}

// ---- log_visit ------------------------------------------------------------

export async function logVisit(ctx: AgentContext, args: LogVisitArgs): Promise<CallToolResult> {
  if (args.activity_type === "PK_TRAINING") return fail("Use create_pk for a PK.");
  const followUps = args.follow_ups ?? [];
  for (const f of followUps) {
    const bad = timedProblem(f);
    if (bad) return fail(`${bad} (follow-up "${f.action}")`);
  }
  const held = gate(ctx, "log_visit", args, () => `log the visit and ${followUps.length} follow-ups.`);
  if (held) return held;

  const nextId = idMaker(validCode(ctx, "log_visit", args));
  const activityId = nextId(0);
  const activity = activityCreateSchema.parse({
    id: activityId,
    org_id: ctx.me.orgId,
    activity_type: args.activity_type,
    primary_account_id: args.account_id,
    owner_id: ctx.me.membershipId,
    occurred_at: new Date(args.occurred_at).toISOString(),
    was_planned: !!args.planned_action_id,
    planned_action_id: args.planned_action_id,
    objective: args.objective,
    what_happened: args.what_happened,
    outcomes: args.outcomes ?? [],
    follow_up_required: followUps.length > 0,
  });
  const created = await ctx.db
    .from("activities")
    .upsert(dbRow({ ...activity, created_via: ctx.via }), { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (created.error) {
    const known = dbProblem(created.error);
    if (known) return known;
    throw created.error;
  }
  if ((created.data ?? []).length > 0) {
    await logAction(ctx, { tool: "log_visit", entity: "activities", entityId: activityId, op: "create" });
  }

  const followIds: string[] = [];
  for (const [i, f] of followUps.entries()) {
    const id = nextId(i + 1);
    followIds.push(id);
    const row = nextActionCreateSchema.parse({
      id,
      org_id: ctx.me.orgId,
      action: f.action,
      owner_id: ctx.me.membershipId,
      due_date: f.due_date,
      account_id: args.account_id,
      activity_id: activityId,
      kind: f.kind,
      due_time: f.due_time,
      time_zone: f.time_zone,
      duration_minutes: f.duration_minutes,
      source: "MANUAL",
    });
    const r = await ctx.db
      .from("next_actions")
      .upsert(dbRow({ ...row, created_via: ctx.via }), { onConflict: "id", ignoreDuplicates: true })
      .select("id");
    if (r.error) {
      const known = dbProblem(r.error, f.kind);
      if (known) return fail(`The visit is logged (${activityId}) but a follow-up failed: ${known.content[0].text}`);
      throw r.error;
    }
    if ((r.data ?? []).length > 0) await logAction(ctx, { tool: "log_visit", entity: "next_actions", entityId: id, op: "create" });
  }

  let completedPlanned = false;
  if (args.planned_action_id) {
    const { data: planned, error } = await ctx.db
      .from("next_actions")
      .select("completed_at, updated_at")
      .eq("id", args.planned_action_id)
      .maybeSingle();
    if (error) throw error;
    if (planned && planned.completed_at === null) {
      const done = await ctx.db
        .from("next_actions")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", args.planned_action_id)
        .eq("updated_at", planned.updated_at)
        .select("id");
      if (done.error) throw done.error;
      if ((done.data ?? []).length > 0) {
        completedPlanned = true;
        await logAction(ctx, {
          tool: "log_visit",
          entity: "next_actions",
          entityId: args.planned_action_id,
          op: "update",
          before: { completed_at: null },
        });
      }
    }
  }

  const lines = [`Logged: ${args.activity_type.toLowerCase().replace(/_/g, " ")} on ${args.occurred_at.slice(0, 10)}. Record ${activityId}.`];
  if (followIds.length) lines.push(`${followIds.length} follow-up${followIds.length === 1 ? "" : "s"} planned.`);
  if (completedPlanned) lines.push("The planned visit is marked done.");
  return ok(receipt(lines, [{ id: activityId, path: `/accounts/${args.account_id}` }]), {
    id: activityId,
    follow_up_ids: followIds,
  });
}

// ---- registration ---------------------------------------------------------

const timed = {
  kind: z.enum(KINDS).optional().describe("VISIT, CALL, MEETING, QUOTE_FOLLOW_UP, SAMPLE_FOLLOW_UP or OTHER"),
  due_time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Start time HH:MM in time_zone"),
  time_zone: z.string().optional().describe("IANA zone, e.g. America/Los_Angeles"),
  duration_minutes: z.number().int().min(5).max(600).optional(),
};
const writeNote =
  " This writes immediately. Do not guess: ask the person for anything missing. When you finish, tell them in a short list what you recorded.";

export function registerAgendaTools(server: McpServer, getCtx: GetCtx) {
  server.registerTool(
    "list_agenda",
    {
      title: "List the agenda",
      description:
        "The person's follow-ups, visits, calls and meetings between two dates (open ones, plus those closed in the last two days), ordered by date and time. Each item carries its id and updated_at, which you need to edit it. Ask the person for the date range if it is not clear; call about_me to resolve 'today'. Pages of 50 (max 200): use offset for more.",
      inputSchema: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("First day, YYYY-MM-DD"),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Last day, YYYY-MM-DD"),
        owner_id: z.string().uuid().optional().describe("A colleague's membership id from find; default is the person themselves"),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    tool<ListAgendaArgs>(getCtx, (ctx, a) => listAgenda(ctx, a)),
  );

  server.registerTool(
    "plan_follow_up",
    {
      title: "Plan a follow-up",
      description:
        "Add a follow-up, visit, call or meeting to the agenda. Ask the person for the date, and for the account (look it up with find; never guess an id). For a CALL or MEETING also ask for the time, the time zone and the duration; do not assume them. Giving it to a colleague (owner_id) needs the person's yes first." +
        writeNote,
      inputSchema: z.object({
        action: z.string().min(1).describe("What to do, in a short sentence"),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        account_id: z.string().uuid().optional(),
        owner_id: z.string().uuid().optional().describe("Membership id of the colleague; default is the person themselves"),
        objective: z.enum(VISIT_OBJECTIVES).optional(),
        confirmation: z.string().optional().describe("Only the code this tool gave you, after the person said yes"),
        ...timed,
      }),
    },
    tool<PlanFollowUpArgs>(getCtx, (ctx, a) => planFollowUp(ctx, a)),
  );

  server.registerTool(
    "update_follow_up",
    {
      title: "Change or complete a follow-up",
      description:
        "Move, rename, reassign or complete a follow-up. Read it first with list_agenda and pass its updated_at; if it changed meanwhile you are told to read again. done: true completes it. Reassigning needs the person's yes first." +
        writeNote,
      inputSchema: z.object({
        id: z.string().uuid(),
        updated_at: z.string().describe("The updated_at you read"),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        due_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        time_zone: z.string().optional().describe("Required together with due_time"),
        duration_minutes: z.number().int().min(5).max(600).optional(),
        action: z.string().min(1).optional(),
        owner_id: z.string().uuid().optional(),
        done: z.boolean().optional(),
        confirmation: z.string().optional(),
      }),
    },
    tool<UpdateFollowUpArgs>(getCtx, (ctx, a) => updateFollowUp(ctx, a)),
  );

  server.registerTool(
    "log_visit",
    {
      title: "Log a visit",
      description:
        "Record a visit or touch that already happened, with the follow-ups it produced. Ask the person which account (look it up with find), when it happened, and what happened. Not for PK training (use create_pk). If it was a planned visit, pass planned_action_id and it is marked done. For a CALL or MEETING follow-up ask for time, zone and duration. Five or more follow-ups need the person's yes first." +
        writeNote,
      inputSchema: z.object({
        account_id: z.string().uuid(),
        activity_type: z.enum(ACTIVITY_TYPES),
        occurred_at: z.string().describe("ISO date-time with offset, e.g. 2026-11-03T17:00:00Z"),
        what_happened: z.string().min(1),
        outcomes: z.array(z.enum(ACTIVITY_OUTCOMES)).optional(),
        objective: z.enum(VISIT_OBJECTIVES).optional(),
        planned_action_id: z.string().uuid().optional(),
        follow_ups: z
          .array(z.object({ action: z.string().min(1), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ...timed }))
          .optional(),
        confirmation: z.string().optional(),
      }),
    },
    tool<LogVisitArgs>(getCtx, (ctx, a) => logVisit(ctx, a)),
  );
}
