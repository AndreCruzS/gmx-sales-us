import { beforeAll, describe, expect, it } from "vitest";
import type { AgentContext } from "../context";
import { contextFor, useLocalStack } from "./it-helpers";

const run = Date.now().toString(36);
const text = (r: { content: { text: string }[] }) => r.content[0].text;
const PK_AT = new Date(Date.now() - 3600_000).toISOString();

describe.skipIf(!process.env.MCP_IT)("undo (local stack)", () => {
  let tj: AgentContext;
  let tj2: AgentContext;
  let admin: AgentContext;
  let agenda: typeof import("../tools/agenda");
  let pk: typeof import("../tools/pk");
  let acc: typeof import("../tools/accounts");
  let u: typeof import("../tools/undo");
  let accountId: string;

  beforeAll(async () => {
    useLocalStack();
    agenda = await import("../tools/agenda");
    pk = await import("../tools/pk");
    acc = await import("../tools/accounts");
    u = await import("../tools/undo");
    tj = await contextFor("tj@gmxgroup.com");
    tj2 = await contextFor("tj@gmxgroup.com");
    admin = await contextFor("bianca@gmxgroup.com");
    const { data: a } = await tj.db.from("accounts").select("id").limit(1).single();
    accountId = a!.id;
  });

  const idOf = (r: { structuredContent?: Record<string, unknown> }) => (r.structuredContent as { id: string }).id;

  it("as admin, undo of a created follow-up deletes it", async () => {
    const id = idOf(await agenda.planFollowUp(admin, { action: `undo ${run} a`, due_date: "2026-12-01", account_id: accountId }));
    const r = await u.undoLast(admin, {});
    expect(r.isError).toBeFalsy();
    const { data } = await admin.db.from("next_actions").select("id").eq("id", id);
    expect(data).toHaveLength(0);
    const { data: log } = await admin.db.from("agent_actions").select("undone_at").eq("entity_id", id).single();
    expect(log!.undone_at).not.toBeNull();
  });

  it("as a rep, undo of a created follow-up closes it instead", async () => {
    const id = idOf(await agenda.planFollowUp(tj, { action: `undo ${run} b`, due_date: "2026-12-01", account_id: accountId }));
    const r = await u.undoLast(tj, {});
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Closed it (you can't delete items).");
    const { data } = await tj.db.from("next_actions").select("completed_at").eq("id", id).single();
    expect(data!.completed_at).not.toBeNull();
  });

  it("undo of a priority change restores priority and priority_days", async () => {
    const mk = await pk.createPk(admin, {
      dealer_account_id: accountId,
      occurred_at: PK_AT,
      what_happened: `PK ${run} u`,
      follow_ups: [{ action: `fu ${run}`, urgent: false, important: true, reason: "x", asked_by_dealer: false }],
    });
    const id = (mk.structuredContent as { follow_up_ids: string[] }).follow_up_ids[0];
    const { data: before } = await admin.db.from("next_actions").select("priority, priority_days, due_date, updated_at").eq("id", id).single();
    const up = await pk.updatePkItem(admin, { id, updated_at: before!.updated_at, priority: "DO_NOW" });
    expect(up.isError).toBeFalsy();
    const r = await u.undoLast(admin, {});
    expect(r.isError).toBeFalsy();
    const { data: after } = await admin.db.from("next_actions").select("priority, priority_days, due_date").eq("id", id).single();
    expect(after).toMatchObject({ priority: before!.priority, priority_days: before!.priority_days, due_date: before!.due_date });
  });

  it("a change made since is not overwritten blindly: restore only under the current version", async () => {
    const id = idOf(await agenda.planFollowUp(tj, { action: `undo ${run} c`, due_date: "2026-12-01", account_id: accountId }));
    const { data: row } = await tj.db.from("next_actions").select("updated_at").eq("id", id).single();
    await agenda.updateFollowUp(tj, { id, updated_at: row!.updated_at, action: `undo ${run} c2` });
    const r = await u.undoLast(tj, {});
    expect(r.isError).toBeFalsy();
    const { data } = await tj.db.from("next_actions").select("action").eq("id", id).single();
    expect(data!.action).toBe(`undo ${run} c`);
  });

  it("a created contact cannot be undone, and stays offered", async () => {
    const id = idOf(await acc.addContact(tj, { account_id: accountId, name: `Pat ${run}` }));
    const r = await u.undoLast(tj, {});
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("That can't be undone from here — tell me what to change instead.");
    const { data } = await tj.db.from("agent_actions").select("undone_at").eq("entity_id", id).single();
    expect(data!.undone_at).toBeNull();
  });

  it("an action id can be named; an unknown or another session's id is refused", async () => {
    const id = idOf(await agenda.planFollowUp(tj, { action: `undo ${run} d`, due_date: "2026-12-01", account_id: accountId }));
    const list = await u.undoableActions(tj);
    const mine = list.find((a) => a.entity_id === id)!;
    expect(mine).toBeTruthy();
    const other = await u.undoLast(tj2, { action_id: mine.id });
    expect(other.isError).toBe(true);
    expect(text(other)).toContain("Nothing to undo");
    const unknown = await u.undoLast(tj, { action_id: "00000000-0000-4000-8000-000000000000" });
    expect(text(unknown)).toContain("not something you can undo");
    const ok = await u.undoLast(tj, { action_id: mine.id });
    expect(ok.isError).toBeFalsy();
  });

  it("another session is not offered these actions", async () => {
    await agenda.planFollowUp(tj, { action: `undo ${run} e`, due_date: "2026-12-01", account_id: accountId });
    expect((await u.undoableActions(tj)).length).toBeGreaterThan(0);
    expect(await u.undoableActions(tj2)).toHaveLength(0);
    const r = await u.undoLast(tj2, {});
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Nothing to undo");
  });

  it("an undone action is no longer offered; the response lists what is left", async () => {
    const list = await u.undoableActions(tj);
    expect(list.every((a) => a.undone_at === null)).toBe(true);
    const r = await u.undoLast(tj, {});
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toHaveProperty("remaining");
  });
});
