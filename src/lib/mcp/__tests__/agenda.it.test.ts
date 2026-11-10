import { beforeAll, describe, expect, it } from "vitest";
import { ACTIVITY_OUTCOMES } from "@/lib/domain/enums";
import type { AgentContext } from "../context";
import { addBusinessDays, todayIn } from "@/lib/domain/deadline";
import { contextFor, useLocalStack } from "./it-helpers";

const run = Date.now().toString(36);
const text = (r: { content: { text: string }[] }) => r.content[0].text;
const ONLY_ADMINS =
  "In GMX Sales only an admin gives work to someone else, so I can't either. I can plan it for you instead, or an admin can hand it over.";

describe.skipIf(!process.env.MCP_IT)("agenda tools (local stack)", () => {
  let tj: AgentContext;
  let admin: AgentContext;
  let t: typeof import("../tools/agenda");
  let accountId: string;
  let otherMembership: string;

  const logged = async (entityId: string) => {
    const { data } = await tj.db.from("agent_actions").select("*").eq("entity_id", entityId);
    return data ?? [];
  };

  beforeAll(async () => {
    useLocalStack();
    t = await import("../tools/agenda");
    tj = await contextFor("tj@gmxgroup.com");
    admin = await contextFor("bianca@gmxgroup.com");
    const { data: a } = await tj.db.from("accounts").select("id").limit(1).single();
    accountId = a!.id;
    otherMembership = admin.me.membershipId;
  });

  it("plan_follow_up writes a row marked as made by the agent, with a link", async () => {
    const r = await t.planFollowUp(tj, { action: `Call back ${run} a`, due_date: "2026-12-01", account_id: accountId });
    expect(r.isError).toBeFalsy();
    const id = (r.structuredContent as { id: string }).id;
    expect(text(r)).toContain(`/accounts/${accountId}`);
    const { data: row } = await tj.db.from("next_actions").select("*").eq("id", id).single();
    expect(row!.created_via).toBe("claude");
    expect(row!.entered_by).toBe(tj.me.membershipId);
    expect(row!.owner_id).toBe(tj.me.membershipId);
    const log = await logged(id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ tool: "plan_follow_up", entity: "next_actions", op: "create" });
  });

  it("a CALL without a time is refused in plain words", async () => {
    const r = await t.planFollowUp(tj, { action: `Call ${run} b`, due_date: "2026-12-01", kind: "CALL" });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("A call needs a time, zone and duration.");
  });

  it("a timed CALL is written", async () => {
    const r = await t.planFollowUp(tj, {
      action: `Call ${run} c`,
      due_date: "2026-12-02",
      kind: "CALL",
      due_time: "10:30",
      time_zone: "America/Los_Angeles",
      duration_minutes: 30,
    });
    expect(r.isError).toBeFalsy();
  });

  it("another owner needs confirmation and writes nothing until confirmed", async () => {
    // An admin planning for tj (RLS lets admins write for others; reps cannot).
    const args = { action: `For tj ${run}`, due_date: "2026-12-03", owner_id: tj.me.membershipId };
    const r = await t.planFollowUp(admin, args);
    expect(r.structuredContent?.needs_confirmation).toBe(true);
    const { data: none } = await admin.db.from("next_actions").select("id").eq("action", args.action);
    expect(none ?? []).toHaveLength(0);
    const code = r.structuredContent!.confirmation as string;
    const r2 = await t.planFollowUp(admin, { ...args, confirmation: code });
    expect(r2.isError).toBeFalsy();
    const id = (r2.structuredContent as { id: string }).id;
    // replay with the same code writes nothing new
    const r3 = await t.planFollowUp(admin, { ...args, confirmation: code });
    expect((r3.structuredContent as { id: string }).id).toBe(id);
    const { data: rows } = await admin.db.from("next_actions").select("id").eq("action", args.action);
    expect(rows).toHaveLength(1);
    const { data: log } = await admin.db.from("agent_actions").select("id").eq("entity_id", id);
    expect(log).toHaveLength(1);
  });

  it("a rep cannot hand work to anyone, and is told so before any yes", async () => {
    const args = { action: `Nope ${run}`, due_date: "2026-12-03", owner_id: otherMembership };
    const r = await t.planFollowUp(tj, args);
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.needs_confirmation).toBeUndefined();
    expect(text(r)).toBe(ONLY_ADMINS);
  });

  it("a manager cannot either, as in the app (the database would let them, within their team)", async () => {
    const joao = await contextFor("joao@gmxgroup.com");
    expect(joao.me.role).toBe("manager");
    const args = { action: `Team ${run}`, due_date: "2026-12-03", owner_id: tj.me.membershipId };
    const r = await t.planFollowUp(joao, args);
    expect(text(r)).toBe(ONLY_ADMINS);
    const { data: none } = await admin.db.from("next_actions").select("id").eq("action", args.action);
    expect(none ?? []).toHaveLength(0);
  });

  it("a manager cannot reassign a follow-up", async () => {
    const joao = await contextFor("joao@gmxgroup.com");
    const r = await t.planFollowUp(joao, { action: `Mine ${run}`, due_date: "2026-12-04" });
    const id = (r.structuredContent as { id: string }).id;
    const { data: row } = await joao.db.from("next_actions").select("updated_at").eq("id", id).single();
    const u = await t.updateFollowUp(joao, { id, updated_at: row!.updated_at, owner_id: tj.me.membershipId });
    expect(text(u)).toBe(ONLY_ADMINS);
  });

  it("a wrong code gets a fresh needs-confirmation", async () => {
    const r = await t.planFollowUp(admin, {
      action: `x ${run}`,
      due_date: "2026-12-03",
      owner_id: tj.me.membershipId,
      confirmation: "bad.code",
    });
    expect(r.structuredContent?.needs_confirmation).toBe(true);
    expect(text(r)).toContain("not valid");
  });

  it("update_follow_up refuses a stale updated_at and accepts a fresh one", async () => {
    const c = await t.planFollowUp(tj, { action: `Edit me ${run}`, due_date: "2026-12-04" });
    const id = (c.structuredContent as { id: string }).id;
    const { data: row } = await tj.db.from("next_actions").select("updated_at").eq("id", id).single();
    const stale = await t.updateFollowUp(tj, { id, updated_at: "2020-01-01T00:00:00Z", due_date: "2026-12-05" });
    expect(stale.isError).toBe(true);
    expect(text(stale)).toContain("This changed since you read it");
    const good = await t.updateFollowUp(tj, { id, updated_at: row!.updated_at, due_date: "2026-12-05", done: true });
    expect(good.isError).toBeFalsy();
    const { data: after } = await tj.db.from("next_actions").select("due_date, completed_at").eq("id", id).single();
    expect(after!.due_date).toBe("2026-12-05");
    expect(after!.completed_at).toBeTruthy();
    const log = (await logged(id)).filter((l) => l.op === "update");
    expect(log).toHaveLength(1);
    expect((log[0].before as Record<string, unknown>).due_date).toBe("2026-12-04");
  });

  it("list_agenda returns rows in range with updated_at, paged", async () => {
    const r = await t.listAgenda(tj, { from: "2026-12-01", to: "2026-12-31", limit: 2 });
    const items = r.structuredContent!.items as { updated_at: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(2);
    expect(items[0].updated_at).toBeTruthy();
  });

  it("log_visit makes the activity and two linked follow-ups, one log row each", async () => {
    const r = await t.logVisit(tj, {
      account_id: accountId,
      activity_type: "DEALER_VISIT",
      occurred_at: "2026-11-03T17:00:00Z",
      what_happened: `Visit ${run}`,
      follow_ups: [
        { action: `Send quote ${run}`, due_date: "2026-12-10" },
        {
          action: `Ring ${run}`,
          due_date: "2026-12-11",
          kind: "CALL",
          due_time: "09:00",
          time_zone: "America/Los_Angeles",
          duration_minutes: 15,
        },
      ],
    });
    expect(r.isError).toBeFalsy();
    const d = r.structuredContent as { id: string; follow_up_ids: string[] };
    expect(text(r)).toContain(`/accounts/${accountId}`);
    const { data: act } = await tj.db.from("activities").select("created_via").eq("id", d.id).single();
    expect(act!.created_via).toBe("claude");
    const { data: fus } = await tj.db.from("next_actions").select("id, activity_id").in("id", d.follow_up_ids);
    expect(fus).toHaveLength(2);
    expect(fus!.every((f) => f.activity_id === d.id)).toBe(true);
    for (const id of [d.id, ...d.follow_up_ids]) expect(await logged(id)).toHaveLength(1);
  });

  it("log_visit rejects PK training", async () => {
    const r = await t.logVisit(tj, {
      account_id: accountId,
      activity_type: "PK_TRAINING",
      occurred_at: "2026-11-03T17:00:00Z",
      what_happened: "x",
    });
    expect(text(r)).toBe("Use create_pk for a PK.");
  });

  it("an admin changing tj's follow-up needs a yes; nothing changes until the code comes back", async () => {
    const c = await t.planFollowUp(tj, { action: `Theirs ${run}`, due_date: "2026-12-04" });
    const id = (c.structuredContent as { id: string }).id;
    const { data: row } = await tj.db.from("next_actions").select("updated_at").eq("id", id).single();
    const args = { id, updated_at: row!.updated_at, due_date: "2026-12-09" };
    const held = await t.updateFollowUp(admin, args);
    expect(held.structuredContent?.needs_confirmation).toBe(true);
    expect(text(held)).toContain("This changes someone else's agenda.");
    const { data: same } = await tj.db.from("next_actions").select("due_date").eq("id", id).single();
    expect(same!.due_date).toBe("2026-12-04");
    const done = await t.updateFollowUp(admin, { ...args, confirmation: held.structuredContent!.confirmation as string });
    expect(done.isError).toBeFalsy();
    expect(text(done)).toContain("due_date: 2026-12-04 → 2026-12-09");
    const { data: after } = await tj.db.from("next_actions").select("due_date").eq("id", id).single();
    expect(after!.due_date).toBe("2026-12-09");
  });

  it("log_visit completing someone else's planned visit needs a yes", async () => {
    const c = await t.planFollowUp(tj, { action: `Planned ${run}`, due_date: "2026-12-04", account_id: accountId });
    const planned = (c.structuredContent as { id: string }).id;
    const args = {
      account_id: accountId,
      activity_type: "DEALER_VISIT" as const,
      occurred_at: "2026-11-03T17:00:00Z",
      what_happened: `Admin visit ${run}`,
      planned_action_id: planned,
    };
    const held = await t.logVisit(admin, args);
    expect(held.structuredContent?.needs_confirmation).toBe(true);
    expect(text(held)).toContain("This changes someone else's agenda.");
    const { data: none } = await admin.db.from("activities").select("id").eq("what_happened", args.what_happened);
    expect(none ?? []).toHaveLength(0);
    const ok = await t.logVisit(admin, { ...args, confirmation: held.structuredContent!.confirmation as string });
    expect(ok.isError).toBeFalsy();
    const { data: p } = await tj.db.from("next_actions").select("completed_at").eq("id", planned).single();
    expect(p!.completed_at).toBeTruthy();
  });

  it("five outcomes alone do not trigger the bulk rule; five follow-ups do", async () => {
    const outcomes = ACTIVITY_OUTCOMES.slice(0, 5);
    expect(outcomes).toHaveLength(5);
    const base = { account_id: accountId, activity_type: "DEALER_VISIT" as const, occurred_at: "2026-11-03T17:00:00Z" };
    const a = await t.logVisit(tj, { ...base, what_happened: `Outcomes ${run}`, outcomes: [...outcomes] });
    expect(a.structuredContent?.needs_confirmation).toBeUndefined();
    const five = Array.from({ length: 5 }, (_, i) => ({ action: `bulk ${run} ${i}`, due_date: "2026-12-12" }));
    const b = await t.logVisit(tj, { ...base, what_happened: `Bulk ${run}`, follow_ups: five });
    expect(b.structuredContent?.needs_confirmation).toBe(true);
  });

  it("a failure after the visit is saved says so and names the ids, not 'try again'", async () => {
    const r = await t.logVisit(tj, {
      account_id: accountId,
      activity_type: "DEALER_VISIT",
      occurred_at: "2026-11-03T17:00:00Z",
      what_happened: `Partial ${run}`,
      follow_ups: [
        { action: `fine ${run}`, due_date: "2026-12-12" },
        { action: `bad kind ${run}`, due_date: "2026-12-12", kind: "NOT_A_KIND" as never },
      ],
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Saved the visit as ");
    expect(text(r)).toContain("Don't call log_visit again");
    expect(text(r)).not.toContain("try again");
    const d = r.structuredContent as { id: string; follow_up_ids: string[]; partial: boolean };
    expect(d.partial).toBe(true);
    expect(d.follow_up_ids).toHaveLength(1);
    const { data: act } = await tj.db.from("activities").select("id").eq("id", d.id);
    expect(act).toHaveLength(1);
  });

  it("a PK follow-up is refused here and sent to update_pk_item", async () => {
    const pk = await import("../tools/pk");
    const mk = await pk.createPk(admin, {
      dealer_account_id: accountId,
      occurred_at: `${todayIn()}T12:00:00-08:00`,
      what_happened: `PK ${run} refuse`,
      follow_ups: [{ action: `pk fu ${run}`, urgent: true, important: true, reason: "r" }],
    });
    const id = (mk.structuredContent as { follow_up_ids: string[] }).follow_up_ids[0];
    const { data: row } = await admin.db.from("next_actions").select("updated_at").eq("id", id).single();
    const r = await t.updateFollowUp(admin, { id, updated_at: row!.updated_at, action: "renamed" });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("This is a PK follow-up — use update_pk_item.");
  });

  it("importance: urgent caps the deadline, the OWNER's role picks Plan or Delegate, the receipt shows the deadline", async () => {
    const today = todayIn();
    const cap = addBusinessDays(today, 2);
    const mine = await t.planFollowUp(tj, { action: `Imp ${run} a`, due_date: "2026-12-30", important: false, urgent: true });
    expect(mine.isError).toBeFalsy();
    expect(text(mine)).toContain(`Deadline: ${cap}`);
    const id = (mine.structuredContent as { id: string }).id;
    const { data: row } = await tj.db.from("next_actions").select("priority, important, due_date").eq("id", id).single();
    expect(row).toMatchObject({ priority: "PLAN", important: false, due_date: cap });

    // Bianca (admin) plans the same for herself: Delegate.
    const hers = await t.planFollowUp(admin, { action: `Imp ${run} b`, due_date: "2026-12-30", important: false, urgent: true });
    const { data: b } = await admin.db.from("next_actions").select("priority").eq("id", (hers.structuredContent as { id: string }).id).single();
    expect(b!.priority).toBe("DELEGATE");

    // Bianca plans for tj: tj is a rep, so Plan, not Delegate.
    const args = { action: `Imp ${run} c`, due_date: "2026-12-30", important: false, urgent: true, owner_id: tj.me.membershipId };
    const held = await t.planFollowUp(admin, args);
    const done = await t.planFollowUp(admin, { ...args, confirmation: held.structuredContent!.confirmation as string });
    const { data: c } = await admin.db.from("next_actions").select("priority, owner_id").eq("id", (done.structuredContent as { id: string }).id).single();
    expect(c).toMatchObject({ priority: "PLAN", owner_id: tj.me.membershipId });
  });

  it("importance: a visit has none, and urgent alone is not enough", async () => {
    const v = await t.planFollowUp(tj, { action: `Imp ${run} v`, due_date: "2026-12-30", kind: "VISIT", important: true });
    expect(v.isError).toBe(true);
    expect(text(v)).toContain("have no priority");
    const u = await t.planFollowUp(tj, { action: `Imp ${run} u`, due_date: "2026-12-30", urgent: true });
    expect(u.isError).toBe(true);
    expect(text(u)).toContain("Give important");
  });

  it("update_follow_up applies the same rule, and is not refused as a PK item when a visit debrief follow-up has a priority", async () => {
    const today = todayIn();
    // A follow-up from a plain visit debrief (Say it): it has a priority and an activity_id, and is not a PK.
    const visit = await t.logVisit(tj, {
      account_id: accountId,
      activity_type: "DEALER_VISIT",
      occurred_at: `${today}T12:00:00-08:00`,
      what_happened: `Debrief ${run}`,
      follow_ups: [{ action: `Debrief fu ${run}`, due_date: "2026-12-30" }],
    });
    const id = (visit.structuredContent as { follow_up_ids: string[] }).follow_up_ids[0];
    const set = await tj.db.from("next_actions").update({ priority: "PLAN", important: true, source: "VISIT_CAPTURE" }).eq("id", id);
    expect(set.error).toBeNull();
    const { data: row } = await tj.db.from("next_actions").select("updated_at, activity_id, priority").eq("id", id).single();
    expect(row!.activity_id).toBeTruthy();
    expect(row!.priority).toBe("PLAN");

    const r = await t.updateFollowUp(tj, { id, updated_at: row!.updated_at, important: true, urgent: true });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(`Deadline: ${addBusinessDays(today, 2)}`);
    const { data: after } = await tj.db.from("next_actions").select("priority, due_date").eq("id", id).single();
    expect(after).toMatchObject({ priority: "DO_NOW", due_date: addBusinessDays(today, 2) });
  });
});
