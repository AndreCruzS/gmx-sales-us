import { beforeAll, describe, expect, it } from "vitest";
import type { AgentContext } from "../context";
import { contextFor, useLocalStack } from "./it-helpers";

const run = Date.now().toString(36);
const text = (r: { content: { text: string }[] }) => r.content[0].text;

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
    expect(text(r)).toContain(`/visits?item=${id}`);
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

  it("a rep cannot hand work to an admin", async () => {
    const args = { action: `Nope ${run}`, due_date: "2026-12-03", owner_id: otherMembership };
    const r = await t.planFollowUp(tj, args);
    const r2 = await t.planFollowUp(tj, { ...args, confirmation: r.structuredContent!.confirmation as string });
    expect(r2.isError).toBe(true);
    expect(text(r2)).toBe("You are not allowed to do that.");
  });

  it("a wrong code gets a fresh needs-confirmation", async () => {
    const r = await t.planFollowUp(tj, {
      action: `x ${run}`,
      due_date: "2026-12-03",
      owner_id: otherMembership,
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
});
