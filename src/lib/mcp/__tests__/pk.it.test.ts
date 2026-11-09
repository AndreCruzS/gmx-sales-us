import { beforeAll, describe, expect, it } from "vitest";
import type { AgentContext } from "../context";
import { contextFor, useLocalStack } from "./it-helpers";

const run = Date.now().toString(36);
const text = (r: { content: { text: string }[] }) => r.content[0].text;
const PK_AT = "2026-11-03T17:00:00Z";

describe.skipIf(!process.env.MCP_IT)("PK board tools (local stack)", () => {
  let admin: AgentContext;
  let tj: AgentContext;
  let t: typeof import("../tools/pk");
  let dealerId: string;

  const fu = (action: string, o: Record<string, unknown> = {}) => ({
    action: `${action} ${run}`,
    urgent: false,
    important: false,
    reason: "r",
    asked_by_dealer: false,
    ...o,
  });

  beforeAll(async () => {
    useLocalStack();
    t = await import("../tools/pk");
    admin = await contextFor("bianca@gmxgroup.com");
    tj = await contextFor("tj@gmxgroup.com");
    const { data } = await admin.db.from("accounts").select("id").limit(1).single();
    dealerId = data!.id;
  });

  it("create_pk without due dates uses the matrix days", async () => {
    const r = await t.createPk(admin, {
      dealer_account_id: dealerId,
      occurred_at: PK_AT,
      what_happened: `PK ${run} a`,
      follow_ups: [
        fu("both", { urgent: true, important: true, subtasks: ["one", "two"], note: "first note" }),
        fu("plan", { important: true }),
        fu("delegate", { urgent: true }),
      ],
    });
    expect(r.isError).toBeFalsy();
    const ids = (r.structuredContent as { follow_up_ids: string[] }).follow_up_ids;
    expect(ids).toHaveLength(3);
    const { data: rows } = await admin.db
      .from("next_actions")
      .select("id, priority, priority_days, due_date, source, activity_id, created_via")
      .in("id", ids);
    const by = new Map(rows!.map((x) => [x.id, x]));
    expect(by.get(ids[0])).toMatchObject({ priority: "DO_NOW", priority_days: 1, due_date: "2026-11-04", source: "VISIT_CAPTURE", created_via: "claude" });
    expect(by.get(ids[1])).toMatchObject({ priority: "PLAN", priority_days: 7, due_date: "2026-11-10" });
    expect(by.get(ids[2])).toMatchObject({ priority: "DELEGATE", priority_days: 2, due_date: "2026-11-05" });
    expect(text(r)).toContain(`/visits/pk?item=${ids[0]}`);
    expect(text(r)).toContain("Do now");
    const item = await t.pkItem(admin, { id: ids[0] });
    expect(text(item)).toContain("first note");
    expect(text(item)).toContain("one");
  });

  it("eliminate is not saved and is listed; keep_eliminated saves it without a priority", async () => {
    const a = await t.createPk(admin, {
      dealer_account_id: dealerId,
      occurred_at: PK_AT,
      what_happened: `PK ${run} b`,
      follow_ups: [fu("keepme"), fu("real", { important: true })],
    });
    expect(text(a)).toContain("Suggested to drop (neither urgent nor important)");
    expect(text(a)).toContain(`keepme ${run}`);
    expect((a.structuredContent as { follow_up_ids: string[] }).follow_up_ids).toHaveLength(1);
    const { data: none } = await admin.db.from("next_actions").select("id").eq("action", `keepme ${run}`);
    expect(none).toHaveLength(0);

    const b = await t.createPk(admin, {
      dealer_account_id: dealerId,
      occurred_at: PK_AT,
      what_happened: `PK ${run} c`,
      follow_ups: [fu("keepme2"), fu("real2", { important: true })],
      keep_eliminated: [0],
    });
    const ids = (b.structuredContent as { follow_up_ids: string[] }).follow_up_ids;
    expect(ids).toHaveLength(2);
    const { data: kept } = await admin.db.from("next_actions").select("priority, priority_days, due_date").eq("id", ids[0]).single();
    expect(kept).toMatchObject({ priority: null, priority_days: null });
    expect(kept!.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("another owner needs a confirmation and writes nothing", async () => {
    const r = await t.createPk(admin, {
      dealer_account_id: dealerId,
      occurred_at: PK_AT,
      what_happened: `PK ${run} d`,
      follow_ups: [fu("theirs", { important: true, owner_id: tj.me.membershipId })],
    });
    expect(r.structuredContent).toMatchObject({ needs_confirmation: true });
    const { data } = await admin.db.from("activities").select("id").eq("what_happened", `PK ${run} d`);
    expect(data).toHaveLength(0);
  });

  it("the created PK shows in pk_board for its owner", async () => {
    const r = await t.pkBoard(admin, { open_only: true, limit: 200 });
    expect(text(r)).toContain(`both ${run}`);
    expect(text(r)).toContain("Do now");
    expect(text(await t.pkBoard(admin, { limit: 1 }))).toContain("offset 1");
  });

  it("a rep cannot update an item outside their scope", async () => {
    const mk = await t.createPk(admin, {
      dealer_account_id: dealerId,
      occurred_at: PK_AT,
      what_happened: `PK ${run} e`,
      follow_ups: [fu("adminonly", { important: true })],
    });
    const id = (mk.structuredContent as { follow_up_ids: string[] }).follow_up_ids[0];
    const { data: row } = await admin.db.from("next_actions").select("updated_at").eq("id", id).single();
    const r = await t.updatePkItem(tj, { id, updated_at: row!.updated_at, progress: "WORKING_ON_IT" });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("You can't change this item.");
    const ok = await t.updatePkItem(admin, { id, updated_at: row!.updated_at, urgent: true, important: true, reason: "x" });
    expect(ok.isError).toBeFalsy();
    const stale = await t.updatePkItem(admin, { id, updated_at: row!.updated_at, progress: "WAITING" });
    expect(text(stale)).toBe("This changed since you read it — read it again.");
    const { data: after } = await admin.db.from("next_actions").select("priority, priority_days").eq("id", id).single();
    expect(after).toMatchObject({ priority: "DO_NOW", priority_days: 1 });
  });

  it("notes, subtasks and reads work", async () => {
    const mk = await t.createPk(admin, {
      dealer_account_id: dealerId,
      occurred_at: PK_AT,
      what_happened: `PK ${run} f`,
      follow_ups: [fu("notes", { important: true })],
    });
    const id = (mk.structuredContent as { follow_up_ids: string[] }).follow_up_ids[0];
    expect((await t.addPkNote(admin, { next_action_id: id, body: "hello" })).isError).toBeFalsy();
    const s = await t.addSubtask(admin, { next_action_id: id, title: "step" });
    const subId = (s.structuredContent as { id: string }).id;
    expect((await t.setSubtaskDone(admin, { id: subId, done: true })).isError).toBeFalsy();
    expect((await t.markPkRead(admin, { next_action_id: id })).isError).toBeFalsy();
    const item = await t.pkItem(admin, { id });
    expect(text(item)).toContain("[x] step");
    expect(text(item)).toContain("hello");
  });

  it("a first priority on an old PK's item counts from today; the board shows subtasks", async () => {
    const mk = await t.createPk(admin, {
      dealer_account_id: dealerId,
      occurred_at: "2026-10-20T17:00:00Z",
      what_happened: `PK ${run} old`,
      follow_ups: [fu("oldone", { subtasks: ["a", "b"] })],
      keep_eliminated: [0],
    });
    const id = (mk.structuredContent as { follow_up_ids: string[] }).follow_up_ids[0];
    const { data: row } = await admin.db.from("next_actions").select("updated_at").eq("id", id).single();
    const r = await t.updatePkItem(admin, { id, updated_at: row!.updated_at, urgent: false, important: true, reason: "r" });
    expect(r.isError).toBeFalsy();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: admin.me.timeZone }).format(new Date());
    const [y, m, d] = today.split("-").map(Number);
    const plus7 = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
    const { data: after } = await admin.db.from("next_actions").select("priority, priority_days, due_date").eq("id", id).single();
    expect(after).toMatchObject({ priority: "PLAN", priority_days: 7, due_date: plus7 });

    const board = text(await t.pkBoard(admin, { open_only: true, limit: 200 }));
    expect(board).toContain(`oldone ${run} [Plan, To do, alert ${plus7}, subtasks 0/2`);
  });

  it("a PK given with the person's offset keeps the date they said", async () => {
    const r = await t.createPk(admin, {
      dealer_account_id: dealerId,
      occurred_at: "2026-11-04T18:30:00-08:00",
      what_happened: `PK ${run} g`,
      follow_ups: [fu("late", { urgent: true, important: true })],
    });
    const id = (r.structuredContent as { follow_up_ids: string[] }).follow_up_ids[0];
    const { data: row } = await admin.db.from("next_actions").select("due_date, priority_days").eq("id", id).single();
    expect(row).toMatchObject({ due_date: "2026-11-05", priority_days: 1 });
    expect(text(r)).toContain("PK logged on 2026-11-04");
  });

  it("a rep reads a colleague's follow-up on their own PK, as the board does", async () => {
    // A rep cannot create an item for a colleague, so the desk hands it over after.
    const done = await t.createPk(tj, {
      dealer_account_id: dealerId,
      occurred_at: PK_AT,
      what_happened: `PK ${run} h`,
      follow_ups: [fu("theirs2", { important: true })],
    });
    expect(done.isError).toBeFalsy();
    const id = (done.structuredContent as { follow_up_ids: string[] }).follow_up_ids[0];
    const { error } = await admin.db.from("next_actions").update({ owner_id: admin.me.membershipId }).eq("id", id);
    expect(error).toBeNull();
    const item = await t.pkItem(tj, { id });
    expect(item.isError).toBeFalsy();
    expect(text(item)).toContain(`theirs2 ${run}`);
    expect(text(await t.pkBoard(tj, { limit: 200 }))).toContain(`theirs2 ${run}`);
  });

  it("update_pk_item takes the matrix answers; both no is a suggestion that changes nothing", async () => {
    const mk = await t.createPk(admin, {
      dealer_account_id: dealerId,
      occurred_at: PK_AT,
      what_happened: `PK ${run} matrix`,
      follow_ups: [fu("mx", { important: true })],
    });
    const id = (mk.structuredContent as { follow_up_ids: string[] }).follow_up_ids[0];
    const { data: row } = await admin.db.from("next_actions").select("updated_at, priority").eq("id", id).single();
    expect(row!.priority).toBe("PLAN");
    const half = await t.updatePkItem(admin, { id, updated_at: row!.updated_at, urgent: true });
    expect(half.isError).toBe(true);
    const drop = await t.updatePkItem(admin, { id, updated_at: row!.updated_at, urgent: false, important: false, reason: "nope" });
    expect(drop.isError).toBeFalsy();
    expect(text(drop)).toContain("Suggested to drop");
    const { data: same } = await admin.db.from("next_actions").select("priority").eq("id", id).single();
    expect(same!.priority).toBe("PLAN");
    const up = await t.updatePkItem(admin, { id, updated_at: row!.updated_at, urgent: true, important: true, reason: "now" });
    expect(text(up)).toContain("priority: PLAN → DO_NOW");
  });

  it("a failure after the PK is saved names what exists and says not to call create_pk again", async () => {
    const r = await t.createPk(admin, {
      dealer_account_id: dealerId,
      occurred_at: PK_AT,
      what_happened: `PK ${run} partial`,
      follow_ups: [
        fu("first", { important: true }),
        fu("second", { important: true, progress: "NOT_A_PROGRESS" }),
      ],
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Saved the PK as ");
    expect(text(r)).toContain("Don't call create_pk again");
    const d = r.structuredContent as { id: string; follow_up_ids: string[]; partial: boolean };
    expect(d.partial).toBe(true);
    expect(d.follow_up_ids).toHaveLength(1);
  });

  it("each saved follow-up gets its own link", async () => {
    const r = await t.createPk(admin, {
      dealer_account_id: dealerId,
      occurred_at: PK_AT,
      what_happened: `PK ${run} links`,
      follow_ups: [fu("l1", { important: true }), fu("l2", { urgent: true })],
    });
    const ids = (r.structuredContent as { follow_up_ids: string[] }).follow_up_ids;
    for (const id of ids) expect(text(r)).toContain(`/visits/pk?item=${id}`);
  });
});
