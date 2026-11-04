import { beforeAll, describe, expect, it } from "vitest";
import type { AgentContext } from "../context";
import { contextFor, useLocalStack } from "./it-helpers";

const run = Date.now().toString(36);
const text = (r: { content: { text: string }[] }) => r.content[0].text;

describe.skipIf(!process.env.MCP_IT)("accounts, contacts and views (local stack)", () => {
  let admin: AgentContext;
  let tj: AgentContext;
  let a: typeof import("../tools/accounts");
  let v: typeof import("../tools/views");

  beforeAll(async () => {
    useLocalStack();
    a = await import("../tools/accounts");
    v = await import("../tools/views");
    admin = await contextFor("bianca@gmxgroup.com");
    tj = await contextFor("tj@gmxgroup.com");
  });

  const create = (c: AgentContext, name: string) =>
    a.createAccount(c, {
      name,
      account_type: "DEALER",
      city: "Boise",
      state: "ID",
      lead_source: "COLD_OUTREACH",
    });

  it("create_account as tj writes created_via and links /accounts/<id>", async () => {
    const r = await create(tj, `Test Lumber ${run} Boise`);
    expect(r.isError).toBeFalsy();
    const id = (r.structuredContent as { id: string }).id;
    expect(text(r)).toContain(`/accounts/${id}`);
    const { data } = await tj.db.from("accounts").select("created_via, owner_id, name").eq("id", id).single();
    expect(data).toMatchObject({ created_via: "claude", owner_id: tj.me.membershipId });
    const { data: log } = await tj.db.from("agent_actions").select("tool, entity").eq("entity_id", id);
    expect(log).toEqual([{ tool: "create_account", entity: "accounts" }]);
  });

  it("add_contact, get_account, update_contact with the stale guard, notes", async () => {
    const acc = await create(tj, `Test Yard ${run} Boise`);
    const accountId = (acc.structuredContent as { id: string }).id;
    const c = await a.addContact(tj, { account_id: accountId, name: `Pat ${run}`, email: "pat@example.com" });
    expect(c.isError).toBeFalsy();
    const contactId = (c.structuredContent as { id: string }).id;
    const n = await a.addAccountNote(tj, { account_id: accountId, body: `note ${run}` });
    expect(n.isError).toBeFalsy();

    const got = await a.getAccount(tj, { id: accountId });
    const s = got.structuredContent as { contacts: { id: string; updated_at: string }[]; notes: { body: string }[]; account: { updated_at: string } };
    expect(s.contacts.map((x) => x.id)).toContain(contactId);
    expect(s.notes[0].body).toBe(`note ${run}`);

    const base = s.contacts.find((x) => x.id === contactId)!.updated_at;
    const up = await a.updateContact(tj, { id: contactId, updated_at: base, job_title: "Buyer" });
    expect(up.isError).toBeFalsy();
    const stale = await a.updateContact(tj, { id: contactId, updated_at: base, job_title: "Boss" });
    expect(stale.isError).toBe(true);
    expect(text(stale)).toContain("read it again");
    const { data: log } = await tj.db.from("agent_actions").select("before").eq("entity_id", contactId).eq("op", "update");
    expect(log![0].before).toMatchObject({ job_title: null });

    const ua = await a.updateAccount(tj, { id: accountId, updated_at: s.account.updated_at, city: "Meridian" });
    expect(ua.isError).toBeFalsy();
    const staleA = await a.updateAccount(tj, { id: accountId, updated_at: s.account.updated_at, city: "Nampa" });
    expect(text(staleA)).toContain("read it again");
  });

  it("add_contact on an account outside tj's scope fails plainly", async () => {
    const mine = await tj.db.from("accounts").select("id").limit(5000);
    const visible = new Set((mine.data ?? []).map((x) => x.id));
    const all = await admin.db.from("accounts").select("id, owner_id").limit(5000);
    const hidden = (all.data ?? []).find((x) => !visible.has(x.id));
    // Fall back to an account another member owns when tj can read everything.
    const other = hidden ?? (all.data ?? []).find((x) => x.owner_id !== tj.me.membershipId);
    expect(other, "needs an account tj does not own").toBeTruthy();
    const r = await a.addContact(tj, { account_id: other!.id, name: `Nope ${run}` });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("You can't change this account.");
  });

  it("sales_summary LF equals a direct query computed as the page does", async () => {
    const r = await v.salesSummary(admin, { period: "month" });
    const s = r.structuredContent as { lf: number | null; month: string };
    const { data: per } = await admin.db.from("sell_through_periods").select("period, period_kind").limit(2000);
    const latest = [...new Set((per ?? []).filter((x) => x.period_kind !== "YTD").map((x) => x.period))].sort().reverse()[0];
    if (!latest) {
      expect(s.lf).toBeNull();
      return;
    }
    expect(s.month).toBe(latest);
    let total = 0;
    for (let from = 0; ; from += 1000) {
      const { data } = await admin.db
        .from("sell_through_rows")
        .select("quantity, unit")
        .eq("period", latest)
        .or("period_kind.eq.MONTH,period_kind.is.null")
        .order("row_id")
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const x of data) if (x.unit === null || x.unit.toUpperCase() === "LF") total += Number(x.quantity) || 0;
    }
    expect(s.lf).toBe(total);
  });

  it("dealers_overview pages and routine_list answers", async () => {
    const d = await v.dealersOverview(admin, { limit: 3 });
    expect(d.isError).toBeFalsy();
    const s = d.structuredContent as { dealers: unknown[]; total: number };
    expect(s.dealers.length).toBeLessThanOrEqual(3);
    const r = await v.routineList(tj);
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent as { items: unknown[] }).items.length).toBeLessThanOrEqual(200);
    const y = await v.salesSummary(admin, { period: "ytd" });
    expect(y.isError).toBeFalsy();
  });
});
