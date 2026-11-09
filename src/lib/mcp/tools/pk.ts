import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  alertBase,
  alertDate,
  daysFrom,
  isUnread,
  PRIORITY_LABEL,
  PROGRESS_LABEL,
  calendarDateIn,
  priorityPatch,
  type PkItem,
  type PkNote,
  type PkRead,
  type Progress,
} from "@/lib/domain/pk-follow-up";
import { draftedQuadrant } from "@/lib/domain/eisenhower";
import { activityCreateSchema, nextActionCreateSchema } from "@/lib/domain/schemas";
import { fetchAllPages } from "@/lib/supabase/page";
import { logActionQuiet } from "../actions-log";
import type { AgentContext } from "../context";
import { pkMoment, planPkFollowUp, type PkFollowUpInput } from "../pk-rows";
import { changes, receipt } from "../receipt";
import { fail, ok, type CallToolResult } from "../result";
import { tool, type GetCtx } from "../server";
import { dbProblem, dbRow, gate, idMaker, STALE, validCode, dbId } from "./shared";

const PROGRESSES = ["NOT_STARTED", "WORKING_ON_IT", "WAITING", "STUCK", "DONE"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CANT = "You can't change this item.";
class StepFailed extends Error {}
const link = (id: string) => `/visits/pk?item=${id}`;

export type PkBoardArgs = {
  mine_only?: boolean;
  dealer_account_id?: string;
  open_only?: boolean;
  limit?: number;
  offset?: number;
};
export type CreatePkArgs = {
  dealer_account_id: string;
  occurred_at: string;
  what_happened: string;
  attendees?: string[];
  time_zone?: string;
  follow_ups: PkFollowUpInput[];
  keep_eliminated?: number[];
  confirmation?: string;
};
export type UpdatePkItemArgs = {
  id: string;
  updated_at: string;
  urgent?: boolean;
  important?: boolean;
  asked_by_dealer?: boolean;
  reason?: string;
  progress?: Progress;
  done?: boolean;
  due_date?: string;
  action?: string;
};

type BoardVisit = {
  id: string;
  owner_id: string;
  occurred_at: string;
  primary_account_id: string;
  account: { name: string } | null;
};
type BoardItem = PkItem & { activity_id: string };

const chunks = <T>(xs: T[], n = 100): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// ---- pk_board -------------------------------------------------------------

export async function pkBoard(ctx: AgentContext, args: PkBoardArgs): Promise<CallToolResult> {
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(args.offset ?? 0), 0);
  let q = ctx.db
    .rpc("pk_board_visits")
    .select("id, owner_id, occurred_at, primary_account_id, account:accounts!activities_primary_account_id_fkey(name)")
    .eq("activity_type", "PK_TRAINING");
  if (args.dealer_account_id) q = q.eq("primary_account_id", args.dealer_account_id);
  const { data: vdata, error: verr } = await q
    .order("occurred_at", { ascending: false })
    .order("id")
    .range(offset, offset + limit - 1);
  if (verr) throw verr;
  const visits = (vdata ?? []) as unknown as BoardVisit[];
  if (visits.length === 0) return ok("No PKs on the board.", { bands: [], offset, limit });

  const nameless = visits.filter((v) => v.account === null).map((v) => v.id);
  if (nameless.length > 0) {
    const { data: dn } = await ctx.db.rpc("pk_dealer_names", { p_activity_ids: nameless });
    const byId = new Map((dn ?? []).map((d) => [d.activity_id, d.dealer_name] as const));
    for (const v of visits) if (v.account === null && byId.has(v.id)) v.account = { name: byId.get(v.id)! };
  }

  const items: BoardItem[] = [];
  for (const c of chunks(visits.map((v) => v.id))) {
    const rows = await fetchAllPages<BoardItem>((from, to) => {
      let iq = ctx.db
        .rpc("pk_board_items")
        .select(
          "id, activity_id, action, owner_id, due_date, completed_at, priority, priority_days, progress, last_changed_by, last_changed_at, updated_at",
        )
        .in("activity_id", c);
      if (args.open_only) iq = iq.is("completed_at", null);
      if (args.mine_only) iq = iq.eq("owner_id", ctx.me.membershipId);
      return iq
        .order("due_date")
        .order("id")
        .range(from, to)
        .then((r) => ({ data: r.data as unknown as BoardItem[] | null, error: r.error }));
    });
    items.push(...rows);
  }

  const notes: PkNote[] = [];
  const reads: PkRead[] = [];
  const subs: { next_action_id: string; done_at: string | null }[] = [];
  for (const c of chunks(items.map((i) => i.id))) {
    // Subtasks give each item its done / total (2026-11-06: the agent sees the
    // progress the board's In progress cell shows, without opening each item).
    subs.push(
      ...(await fetchAllPages<{ next_action_id: string; done_at: string | null }>((from, to) =>
        ctx.db
          .from("next_action_subtasks")
          .select("id, next_action_id, done_at")
          .in("next_action_id", c)
          .order("id")
          .range(from, to),
      )),
    );
    notes.push(
      ...(await fetchAllPages<PkNote>((from, to) =>
        ctx.db
          .from("next_action_notes")
          .select("id, next_action_id, author_id, body, created_at, edited_at")
          .in("next_action_id", c)
          .order("created_at")
          .order("id")
          .range(from, to),
      )),
    );
    const { data: rd, error } = await ctx.db
      .from("next_action_reads")
      .select("membership_id, next_action_id, last_read_at")
      .eq("membership_id", ctx.me.membershipId)
      .in("next_action_id", c);
    if (error) throw error;
    reads.push(...(rd ?? []));
  }
  const myRead = new Map(reads.map((r) => [r.next_action_id, r] as const));
  const subCount = new Map<string, { done: number; total: number }>();
  for (const s of subs) {
    const c = subCount.get(s.next_action_id) ?? { done: 0, total: 0 };
    c.total += 1;
    if (s.done_at !== null) c.done += 1;
    subCount.set(s.next_action_id, c);
  }

  const filtered = !!(args.mine_only || args.open_only);
  const bands = visits
    .map((v) => {
      const its = items
        .filter((i) => i.activity_id === v.id)
        .map((i) => ({
          id: i.id,
          action: i.action,
          owner_id: i.owner_id,
          priority: i.priority,
          priority_label: i.priority ? PRIORITY_LABEL[i.priority] : null,
          progress: i.progress,
          alert_date: i.completed_at === null && i.priority && i.priority !== "ELIMINATE" ? i.due_date : null,
          due_date: i.due_date,
          done: i.completed_at !== null,
          subtasks_done: subCount.get(i.id)?.done ?? 0,
          subtasks_total: subCount.get(i.id)?.total ?? 0,
          unread: isUnread(i, notes, myRead.get(i.id), ctx.me.membershipId),
          updated_at: i.updated_at,
        }));
      return {
        activity_id: v.id,
        dealer: v.account?.name ?? "Unknown dealer",
        dealer_account_id: v.primary_account_id,
        pk_date: calendarDateIn(v.occurred_at, ctx.me.timeZone),
        items: its,
      };
    })
    .filter((b) => !filtered || b.items.length > 0);

  const text = bands.map((b) => {
    const rows = b.items.map(
      (i) =>
        `  - ${i.action} [${i.priority_label ?? "no priority"}, ${PROGRESS_LABEL[i.progress]}${i.alert_date ? `, alert ${i.alert_date}` : ""}${i.subtasks_total ? `, subtasks ${i.subtasks_done}/${i.subtasks_total}` : ""}${i.unread ? ", UNREAD" : ""}] — id ${i.id}, updated_at ${i.updated_at}`,
    );
    return `${b.dealer}, PK of ${b.pk_date}:\n${rows.length ? rows.join("\n") : "  (no follow-ups)"}`;
  });
  const more = visits.length === limit ? `\nThere may be more PKs: call again with offset ${offset + limit}.` : "";
  return ok(`${bands.length} PK${bands.length === 1 ? "" : "s"}:\n${text.join("\n")}${more}`, { bands, offset, limit });
}

// ---- pk_item --------------------------------------------------------------

export async function pkItem(ctx: AgentContext, args: { id: string }): Promise<CallToolResult> {
  // As the app's board does: the item through pk_board_items (a rep's table policy does not reach a colleague's follow-up on their PK).
  const { data: item, error } = await ctx.db
    .rpc("pk_board_items")
    .select("id, action, owner_id, due_date, completed_at, priority, priority_days, progress, activity_id, account_id, updated_at")
    .eq("id", args.id)
    .maybeSingle();
  if (error) throw error;
  if (!item) return fail("I can't find that PK item (or it isn't visible to you).");
  const [notes, subs] = await Promise.all([
    ctx.db.from("next_action_notes").select("id, author_id, body, created_at").eq("next_action_id", args.id).order("created_at").order("id"),
    ctx.db.from("next_action_subtasks").select("id, title, done_at, position").eq("next_action_id", args.id).order("position").order("id"),
  ]);
  if (notes.error) throw notes.error;
  if (subs.error) throw subs.error;
  const lines = [
    `${item.action} [${item.priority ? PRIORITY_LABEL[item.priority] : "no priority"}, ${PROGRESS_LABEL[item.progress]}${item.priority_days !== null ? `, ${item.priority_days} days` : ""}] — alert ${item.due_date}${item.completed_at ? " (closed)" : ""}. updated_at ${item.updated_at}`,
    ...(subs.data ?? []).map((s) => `  [${s.done_at ? "x" : " "}] ${s.title} — id ${s.id}`),
    ...(notes.data ?? []).map((n) => `  Note ${n.created_at.slice(0, 10)}: ${n.body}`),
  ];
  return ok(receipt(lines, [{ id: item.id, path: link(item.id) }]), {
    item,
    notes: notes.data ?? [],
    subtasks: subs.data ?? [],
  });
}

// ---- create_pk ------------------------------------------------------------

export async function createPk(ctx: AgentContext, args: CreatePkArgs): Promise<CallToolResult> {
  const fus = args.follow_ups ?? [];
  const asRecord = args as unknown as Record<string, unknown>;
  const { instant, pkDate } = pkMoment(args.occurred_at, args.time_zone ?? ctx.me.timeZone);
  const plans = fus.map((f) => planPkFollowUp(pkDate, f));
  const keep = new Set(args.keep_eliminated ?? []);
  for (const k of keep) {
    if (!Number.isInteger(k) || k < 0 || k >= fus.length || plans[k].save) {
      return fail(`keep_eliminated ${k} does not point at a suggested-to-drop follow-up.`);
    }
  }

  const other = fus.some((f) => f.owner_id !== undefined && f.owner_id !== ctx.me.membershipId);
  const reason = other ? "This acts in someone else's name." : fus.length >= 5 ? "This changes 5 or more records at once." : null;
  const held = gate(
    ctx,
    "create_pk",
    asRecord,
    () => `log the PK and ${fus.length} follow-ups${other ? ", some owned by someone else" : ""}.`,
    reason,
  );
  if (held) return held;

  const nextId = idMaker(validCode(ctx, "create_pk", asRecord));
  const activityId = nextId(0);
  const what = args.attendees?.length ? `${args.what_happened}\nAttendees: ${args.attendees.join(", ")}` : args.what_happened;
  const activity = activityCreateSchema.parse({
    id: activityId,
    org_id: ctx.me.orgId,
    activity_type: "PK_TRAINING",
    primary_account_id: args.dealer_account_id,
    owner_id: ctx.me.membershipId,
    occurred_at: instant,
    was_planned: false,
    what_happened: what,
    outcomes: [],
    follow_up_required: fus.length > 0,
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

  // From here the PK exists: nothing may read as "try again" (that would log it twice).
  const saved: { id: string; text: string }[] = [];
  const dropped: string[] = [];
  const notes: string[] = [];
  let step = "logging the PK";
  const quiet = async (a: Parameters<typeof logActionQuiet>[1]) => {
    const n = await logActionQuiet(ctx, a);
    if (n) notes.push(n);
  };
  try {
    if ((created.data ?? []).length > 0) {
      await quiet({ tool: "create_pk", entity: "activities", entityId: activityId, op: "create" });
    }

    for (const [i, f] of fus.entries()) {
      const plan = plans[i];
      if (!plan.save && !keep.has(i)) {
        dropped.push(`${i}: "${f.action}" (${f.reason})`);
        continue;
      }
      step = `saving the follow-up "${f.action}"`;
      const base = 1 + i * 100;
      const itemId = nextId(base);
      const fields = plan.save
        ? { priority: plan.priority, priority_days: plan.priority_days, due_date: plan.due_date }
        : { priority: null, priority_days: null, due_date: f.due_date ?? alertDate(pkDate, 7) };
      const row = nextActionCreateSchema.parse({
        id: itemId,
        org_id: ctx.me.orgId,
        action: f.action.trim(),
        owner_id: f.owner_id ?? ctx.me.membershipId,
        account_id: args.dealer_account_id,
        activity_id: activityId,
        progress: f.progress ?? "NOT_STARTED",
        source: "VISIT_CAPTURE",
        ...fields,
      });
      const r = await ctx.db
        .from("next_actions")
        .upsert(dbRow({ ...row, created_via: ctx.via }), { onConflict: "id", ignoreDuplicates: true })
        .select("id");
      if (r.error) {
        const known = dbProblem(r.error);
        if (known) throw new StepFailed(known.content[0].text);
        throw r.error;
      }
      // The item exists now; list it before its subtasks and note so a failure there still names it.
      const label = plan.save ? PRIORITY_LABEL[plan.priority] : "kept, no priority";
      saved.push({ id: itemId, text: `- ${f.action} — ${label}, alert ${fields.due_date}.` });
      if ((r.data ?? []).length > 0) {
        await quiet({ tool: "create_pk", entity: "next_actions", entityId: itemId, op: "create" });
      }

      step = `adding the subtasks of "${f.action}" (follow-up ${itemId} is saved)`;
      const titles = (f.subtasks ?? []).map((t) => t.trim()).filter(Boolean);
      for (const [k, title] of titles.entries()) {
        const subId = nextId(base + 2 + k);
        const sres = await ctx.db
          .from("next_action_subtasks")
          .upsert(
            dbRow({ id: subId, org_id: ctx.me.orgId, next_action_id: itemId, title, position: k, created_via: ctx.via }),
            { onConflict: "id", ignoreDuplicates: true },
          )
          .select("id");
        if (sres.error) throw sres.error;
        if ((sres.data ?? []).length > 0) {
          await quiet({ tool: "create_pk", entity: "next_action_subtasks", entityId: subId, op: "create" });
        }
      }
      if (f.note?.trim()) {
        step = `adding the note of "${f.action}" (follow-up ${itemId} is saved)`;
        const noteId = nextId(base + 1);
        const nres = await ctx.db
          .from("next_action_notes")
          .upsert(
            dbRow({
              id: noteId,
              org_id: ctx.me.orgId,
              next_action_id: itemId,
              author_id: ctx.me.membershipId,
              body: f.note.trim(),
              created_via: ctx.via,
            }),
            { onConflict: "id", ignoreDuplicates: true },
          )
          .select("id");
        if (nres.error) throw nres.error;
        if ((nres.data ?? []).length > 0) {
          await quiet({ tool: "create_pk", entity: "next_action_notes", entityId: noteId, op: "create" });
        }
      }
    }
  } catch (e) {
    if (!(e instanceof StepFailed)) console.error("[mcp] create_pk failed after the PK was saved:", e);
    const why = e instanceof StepFailed ? ` (${e.message})` : "";
    const have = saved.length ? ` and ${saved.length} follow-up${saved.length === 1 ? "" : "s"} (${saved.map((s) => s.id).join(", ")})` : "";
    return fail(
      `Saved the PK as ${activityId}${have}, but ${step} failed${why}. Don't call create_pk again — add the rest with plan_follow_up (follow-ups), add_subtask and add_pk_note (on a saved follow-up).`,
      { id: activityId, follow_up_ids: saved.map((s) => s.id), partial: true },
    );
  }

  const lines = [
    `PK logged on ${pkDate}. Record ${activityId}.`,
    `${saved.length} follow-up${saved.length === 1 ? "" : "s"} saved:`,
    ...saved.map((s) => s.text),
  ];
  if (dropped.length) {
    lines.push(
      `Suggested to drop (neither urgent nor important): ${dropped.join("; ")}. They were not saved. Do not call create_pk again for them (that would log the PK twice); tell the person.`,
    );
  }
  lines.push(...new Set(notes));
  // Each saved follow-up opens its own drawer; with none, the board.
  const refs = saved.length ? saved.map((s) => ({ id: s.id, path: link(s.id) })) : [{ id: activityId, path: "/visits/pk" }];
  return ok(receipt(lines, refs), {
    id: activityId,
    follow_up_ids: saved.map((s) => s.id),
    dropped: dropped.length,
  });
}

// ---- update_pk_item -------------------------------------------------------

export async function updatePkItem(ctx: AgentContext, args: UpdatePkItemArgs): Promise<CallToolResult> {
  const { data: prior, error: readErr } = await ctx.db
    .rpc("pk_board_items")
    .select("action, due_date, priority, priority_days, progress, completed_at, activity_id, updated_at")
    .eq("id", args.id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!prior) return fail(CANT);

  // A new priority comes only from the two matrix answers, as in create_pk.
  const answering = args.urgent !== undefined || args.important !== undefined;
  let quadrant: ReturnType<typeof draftedQuadrant> = null;
  if (answering) {
    if (args.urgent === undefined || args.important === undefined) return fail("Give both answers: urgent and important.");
    if (!args.reason?.trim()) return fail("Give a short reason for the urgent / important answers.");
    quadrant = draftedQuadrant(args.urgent, args.important, args.asked_by_dealer ?? false);
  }
  const eliminate = quadrant === "ELIMINATE";

  const patch: Record<string, unknown> = {};
  const today = calendarDateIn(new Date().toISOString(), ctx.me.timeZone);
  let pkDate: string | null = null;
  if ((quadrant !== null || args.due_date !== undefined) && prior.activity_id) {
    const { data: v } = await ctx.db.rpc("pk_board_visits").select("occurred_at").eq("id", prior.activity_id).maybeSingle();
    if (v) pkDate = calendarDateIn((v as { occurred_at: string }).occurred_at, ctx.me.timeZone);
  }
  if (quadrant !== null && !eliminate) {
    if (!pkDate) return fail("This item is not part of a PK, so it has no priority to set.");
    const base = alertBase(pkDate, prior, today);
    const days = args.due_date ? Math.max(0, daysFrom(base, args.due_date)) : undefined;
    Object.assign(patch, priorityPatch(base, quadrant, days));
  } else if (args.due_date !== undefined) {
    if (pkDate && prior.priority && prior.priority !== "ELIMINATE") {
      const base = alertBase(pkDate, prior, today);
      const days = Math.max(0, daysFrom(base, args.due_date));
      Object.assign(patch, { priority_days: days, due_date: alertDate(base, days) });
    } else patch.due_date = args.due_date;
  }
  if (args.progress !== undefined) patch.progress = args.progress;
  if (args.done !== undefined) patch.completed_at = args.done ? new Date().toISOString() : null;
  if (args.action !== undefined) patch.action = args.action;

  const suggestion = `Suggested to drop (neither urgent nor important): "${prior.action}" (${args.reason?.trim()}). Its priority was not changed. Ask the person; do not set it yourself.`;
  if (Object.keys(patch).length === 0) {
    return eliminate ? ok(suggestion, { id: args.id, changed: false }) : fail("Nothing to change — say what should be different.");
  }

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
  if ((data ?? []).length === 0) return fail(prior.updated_at !== args.updated_at ? STALE : CANT);
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (prior as Record<string, unknown>)[k] ?? null]));
  const lines = [`Updated PK item ${args.id}. ${changes(before, patch)}.`];
  if (eliminate) lines.push(suggestion);
  const note = await logActionQuiet(ctx, { tool: "update_pk_item", entity: "next_actions", entityId: args.id, op: "update", before });
  if (note) lines.push(note);
  return ok(receipt(lines, [{ id: args.id, path: link(args.id) }]), { id: args.id });
}

// ---- notes, subtasks, reads -----------------------------------------------

export async function addPkNote(ctx: AgentContext, args: { next_action_id: string; body: string }): Promise<CallToolResult> {
  const id = idMaker(undefined)(0);
  const { error } = await ctx.db.from("next_action_notes").insert(
    dbRow({
      id,
      org_id: ctx.me.orgId,
      next_action_id: args.next_action_id,
      author_id: ctx.me.membershipId,
      body: args.body.trim(),
      created_via: ctx.via,
    }),
  );
  if (error) {
    const known = dbProblem(error);
    if (known) return known;
    throw error;
  }
  const note = await logActionQuiet(ctx, { tool: "add_pk_note", entity: "next_action_notes", entityId: id, op: "create" });
  return ok(receipt(["Note added.", ...(note ? [note] : [])], [{ id: args.next_action_id, path: link(args.next_action_id) }]), { id });
}

export async function addSubtask(ctx: AgentContext, args: { next_action_id: string; title: string }): Promise<CallToolResult> {
  const { data: last, error: e1 } = await ctx.db
    .from("next_action_subtasks")
    .select("position")
    .eq("next_action_id", args.next_action_id)
    .order("position", { ascending: false })
    .limit(1);
  if (e1) throw e1;
  const id = idMaker(undefined)(0);
  const { error } = await ctx.db.from("next_action_subtasks").insert(
    dbRow({
      id,
      org_id: ctx.me.orgId,
      next_action_id: args.next_action_id,
      title: args.title.trim(),
      position: (last?.[0]?.position ?? -1) + 1,
      created_via: ctx.via,
    }),
  );
  if (error) {
    const known = dbProblem(error);
    if (known) return known;
    throw error;
  }
  const note = await logActionQuiet(ctx, { tool: "add_subtask", entity: "next_action_subtasks", entityId: id, op: "create" });
  return ok(receipt(["Subtask added.", ...(note ? [note] : [])], [{ id: args.next_action_id, path: link(args.next_action_id) }]), { id });
}

export async function setSubtaskDone(ctx: AgentContext, args: { id: string; done: boolean }): Promise<CallToolResult> {
  const { data: prior, error: e1 } = await ctx.db
    .from("next_action_subtasks")
    .select("done_at, next_action_id")
    .eq("id", args.id)
    .maybeSingle();
  if (e1) throw e1;
  if (!prior) return fail("I can't find that subtask.");
  const { data, error } = await ctx.db
    .from("next_action_subtasks")
    .update({ done_at: args.done ? new Date().toISOString() : null })
    .eq("id", args.id)
    .select("id");
  if (error) {
    const known = dbProblem(error);
    if (known) return known;
    throw error;
  }
  if ((data ?? []).length === 0) return fail(CANT);
  const note = await logActionQuiet(ctx, {
    tool: "set_subtask_done",
    entity: "next_action_subtasks",
    entityId: args.id,
    op: "update",
    before: { done_at: prior.done_at },
  });
  return ok(receipt([args.done ? "Subtask ticked." : "Subtask unticked.", ...(note ? [note] : [])], [{ id: prior.next_action_id, path: link(prior.next_action_id) }]), {
    id: args.id,
  });
}

export async function markPkRead(ctx: AgentContext, args: { next_action_id: string }): Promise<CallToolResult> {
  // Deliberately not in agent_actions: per-person read state, nothing to undo.
  const { error } = await ctx.db.from("next_action_reads").upsert(
    {
      org_id: ctx.me.orgId,
      membership_id: ctx.me.membershipId,
      next_action_id: args.next_action_id,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "membership_id,next_action_id" },
  );
  if (error) {
    const known = dbProblem(error);
    if (known) return known;
    throw error;
  }
  return ok("Marked as read.", { next_action_id: args.next_action_id });
}

// ---- registration ---------------------------------------------------------

const matrixNote =
  " Never pick a priority yourself: ask the person two separate questions per follow-up, 'does it have to happen within about two days?' (urgent) and 'does it move this dealer toward selling GMX and need their own knowledge or relationship?' (important), judged by the MATRIX_RULES in platform_guide, and give a short reason. The system turns the answers into the priority and the alert date.";
const writeNote =
  " This writes immediately. Do not guess: ask the person for anything missing. When you finish, tell them in a short list what you recorded.";

export function registerPkTools(server: McpServer, getCtx: GetCtx) {
  server.registerTool(
    "pk_board",
    {
      title: "The PK follow-up board (Open action items)",
      description:
        "PK trainings (newest first) with their follow-ups: priority, status, alert date, subtasks done/total and an unread flag. Reps see their own PKs; the desk sees all. Pages of 50 PKs (max 200): use offset for more. mine_only and open_only filter within each page, so a page can show fewer PKs than the limit: keep paging until a page comes back empty.",
      inputSchema: z.object({
        mine_only: z.boolean().optional().describe("Only follow-ups owned by the person"),
        dealer_account_id: dbId().optional(),
        open_only: z.boolean().optional().describe("Hide closed follow-ups"),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    tool<PkBoardArgs>(getCtx, (ctx, a) => pkBoard(ctx, a)),
  );

  server.registerTool(
    "pk_item",
    {
      title: "One PK follow-up",
      description: "A PK follow-up with its notes (oldest first), subtasks and updated_at (needed to edit it).",
      inputSchema: z.object({ id: dbId() }),
    },
    tool<{ id: string }>(getCtx, (ctx, a) => pkItem(ctx, a)),
  );

  server.registerTool(
    "create_pk",
    {
      title: "Log a PK training with its follow-ups",
      description:
        "Record a product-knowledge training at a dealer and the follow-ups it produced, exactly as Say it would. For EVERY follow-up give urgent, important, a reason and whether the dealer asked for it." +
        matrixNote +
        " If both answers for a follow-up are no, it is suggested to drop and is NOT saved: ASK the person about those BEFORE calling, and if they want one kept pass its index (0-based, in follow_ups) in keep_eliminated in this same single call. Never call create_pk twice for one PK (it would be logged twice). A said due_date sets the alert; without one the matrix days apply. Giving a follow-up to a colleague (owner_id) or five or more follow-ups needs the person's yes first." +
        writeNote,
      inputSchema: z.object({
        dealer_account_id: dbId().describe("Look the dealer up with find; never guess an id"),
        occurred_at: z.string().describe("Give it with the person's UTC offset, e.g. 2026-11-04T18:30:00-08:00 (the PK date is the date in that offset)"),
        time_zone: z.string().optional().describe("IANA zone, only used when occurred_at has no offset; default is the person's zone"),
        what_happened: z.string().min(1),
        attendees: z.array(z.string()).optional(),
        follow_ups: z.array(
          z.object({
            action: z.string().min(1),
            urgent: z.boolean(),
            important: z.boolean(),
            reason: z.string().min(1).describe('At most 15 words, "Urgent: … · Not important: …"'),
            asked_by_dealer: z.boolean().describe("The dealer asked for it, or GMX promised it"),
            due_date: z.string().regex(DATE).optional().describe("Only a date the person said"),
            progress: z.enum(PROGRESSES).optional(),
            owner_id: dbId().optional().describe("Membership id of a colleague; default the person"),
            subtasks: z.array(z.string().min(1)).max(20).optional(),
            note: z.string().optional(),
          }),
        ),
        keep_eliminated: z.array(z.number().int().min(0)).optional(),
        confirmation: z.string().optional().describe("Only the code this tool gave you, after the person said yes"),
      }),
    },
    tool<CreatePkArgs>(getCtx, (ctx, a) => createPk(ctx, a)),
  );

  server.registerTool(
    "update_pk_item",
    {
      title: "Change a PK follow-up",
      description:
        "Change a PK follow-up's priority, status, alert date, text, or close it. Read it first (pk_board or pk_item) and pass its updated_at; if it changed meanwhile you are told to read again. To change the priority give urgent and important (and asked_by_dealer) with a reason: the system picks the priority and sets the alert date by the matrix days. If both answers are no it is suggested to drop and the priority is NOT changed." +
        matrixNote +
        writeNote,
      inputSchema: z.object({
        id: dbId(),
        updated_at: z.string().describe("The updated_at you read"),
        urgent: z.boolean().optional().describe("To change the priority: does it have to happen within about two days? (give with important and reason)"),
        important: z.boolean().optional().describe("To change the priority: does it move this dealer toward selling GMX?"),
        asked_by_dealer: z.boolean().optional().describe("The dealer asked for it, or GMX promised it"),
        reason: z.string().optional().describe('Required with urgent/important; at most 15 words, "Urgent: ... / Not important: ..."'),
        progress: z.enum(PROGRESSES).optional(),
        done: z.boolean().optional(),
        due_date: z.string().regex(DATE).optional(),
        action: z.string().min(1).optional(),
      }),
    },
    tool<UpdatePkItemArgs>(getCtx, (ctx, a) => updatePkItem(ctx, a)),
  );

  server.registerTool(
    "add_pk_note",
    {
      title: "Add a note to a PK follow-up",
      description: "Add a note on the follow-up's thread." + writeNote,
      inputSchema: z.object({ next_action_id: dbId(), body: z.string().min(1) }),
    },
    tool<{ next_action_id: string; body: string }>(getCtx, (ctx, a) => addPkNote(ctx, a)),
  );
  server.registerTool(
    "add_subtask",
    {
      title: "Add a subtask to a PK follow-up",
      description: "Add a checklist step." + writeNote,
      inputSchema: z.object({ next_action_id: dbId(), title: z.string().min(1) }),
    },
    tool<{ next_action_id: string; title: string }>(getCtx, (ctx, a) => addSubtask(ctx, a)),
  );
  server.registerTool(
    "set_subtask_done",
    {
      title: "Tick or untick a subtask",
      description: "Mark a checklist step done or not done." + writeNote,
      inputSchema: z.object({ id: dbId(), done: z.boolean() }),
    },
    tool<{ id: string; done: boolean }>(getCtx, (ctx, a) => setSubtaskDone(ctx, a)),
  );
  server.registerTool(
    "mark_pk_read",
    {
      title: "Mark a PK follow-up read",
      description: "Clear the unread dot on a follow-up for the person.",
      inputSchema: z.object({ next_action_id: dbId() }),
    },
    tool<{ next_action_id: string }>(getCtx, (ctx, a) => markPkRead(ctx, a)),
  );
}
