import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentContext } from "../context";
import { contextFor, useLocalStack } from "./it-helpers";

const run = Date.now().toString(36);
/** Independent truth: SQL straight into the local database container. */
const sql = (q: string) =>
  execFileSync("docker", ["exec", "supabase_db_gmx-sales-us", "psql", "-U", "postgres", "-tAc", q], { encoding: "utf8" }).trim();
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

  it("sales_summary equals independent SQL aggregates for month and ytd, buy-in included", async () => {
    const tag = `T9${run}`;
    try {
      // Fixtures: a year file for September (rows doubled, last year = the month) and invoiced orders.
      sql(`insert into sell_through_uploads (org_id, distributor_id, period, period_kind, detail, branch_id, row_count)
           select org_id, distributor_id, period, 'YTD', detail, branch_id, 1 from sell_through_uploads where period = '2026-09-01' and period_kind = 'MONTH'`);
      sql(`insert into sell_through (org_id, upload_id, branch_id, dealer_id, dealer_label, period, product, quantity, unit, value, ly_quantity)
           select st.org_id, y.id, st.branch_id, st.dealer_id, st.dealer_label, st.period, st.product, st.quantity * 2, st.unit, st.value, st.quantity
           from sell_through st
           join sell_through_uploads m on m.id = st.upload_id and m.period_kind = 'MONTH'
           join sell_through_uploads y on y.period = m.period and y.period_kind = 'YTD' and y.distributor_id = m.distributor_id
             and coalesce(y.branch_id, '00000000-0000-0000-0000-000000000000') = coalesce(m.branch_id, '00000000-0000-0000-0000-000000000000')
           where m.period = '2026-09-01'`);
      const item = (qty: number, amt: number, uom = "LF") => JSON.stringify([{ sku: "X", description: "Ipe 1x6", uom, quantity: qty, total_amount: amt }]);
      const order = (n: string, status: string, date: string, items: string) =>
        `insert into orders_mirror (id, order_number, customer_name, status, order_date_po, created_at, items) values (gen_random_uuid(), '${tag}-${n}', 'T9', '${status}', '${date}', now(), '${items}'::jsonb)`;
      sql(order("a", "Invoice_Sent", "2026-10-12", item(100, 500)));
      sql(order("b", "Completed", "2026-10-20", item(250.5, 1000)));
      sql(order("c", "Invoice_Sent", "2026-09-10", item(40, 200)));
      sql(order("d", "Draft", "2026-10-12", item(9999, 9999)));
      sql(order("e", "Completed", "2026-10-12", item(77, 77, "ton")));

      const m = (await v.salesSummary(admin, { period: "month" })).structuredContent as Record<string, number | string>;
      const expMonth = Number(sql(`select coalesce(sum(quantity),0) from sell_through_rows where period = '2026-10-01' and (period_kind = 'MONTH' or period_kind is null)`));
      expect(m.month).toBe("2026-10-01");
      expect(m.lf).toBe(expMonth);
      const buyOct = sql(`select coalesce(sum((i->>'quantity')::numeric),0)||'|'||coalesce(sum((i->>'total_amount')::numeric),0)
        from orders_mirror o, jsonb_array_elements(o.items) i
        where o.status in ('Invoice_Sent','Completed') and lower(i->>'uom') in ('lf','lft') and left(o.order_date_po::text,7) = '2026-10'`).split("|").map(Number);
      expect(m.buy_in_lf).toBe(buyOct[0]);
      expect(m.buy_in_value).toBe(buyOct[1]);

      const y = (await v.salesSummary(admin, { period: "ytd" })).structuredContent as Record<string, number | string>;
      const expYtd = Number(sql(`select coalesce(sum(quantity),0) from sell_through_rows where (period = '2026-09-01' and period_kind = 'YTD') or (period > '2026-09-01' and left(period::text,4) = '2026' and (period_kind = 'MONTH' or period_kind is null))`));
      const expLy = Number(sql(`select coalesce(sum(ly_quantity),0) from sell_through_rows where period = '2026-09-01' and period_kind = 'YTD' and ly_quantity > 0`));
      expect(y.lf).toBe(expYtd);
      expect(y.last_year_lf).toBe(expLy);
      const buyYear = sql(`select coalesce(sum((i->>'quantity')::numeric),0)||'|'||coalesce(sum((i->>'total_amount')::numeric),0)
        from orders_mirror o, jsonb_array_elements(o.items) i
        where o.status in ('Invoice_Sent','Completed') and lower(i->>'uom') in ('lf','lft')
          and left(o.order_date_po::text,4) = '2026' and left(o.order_date_po::text,7) between '2026-06' and '2026-10'`).split("|").map(Number);
      expect(y.buy_in_lf).toBe(buyYear[0]);
      expect(y.buy_in_value).toBe(buyYear[1]);
    } finally {
      sql(`delete from orders_mirror where order_number like '${tag}-%'`);
      sql(`delete from sell_through where upload_id in (select id from sell_through_uploads where period_kind = 'YTD')`);
      sql(`delete from sell_through_uploads where period_kind = 'YTD'`);
    }
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

  it("create_account places the account like the app: by state, California by city", async () => {
    const { data: st } = await admin.db.from("territory_states").select("state, territory_id").neq("state", "CA").limit(1).single();
    const r = await a.createAccount(admin, {
      name: `Placed ${run} Town`,
      account_type: "DEALER",
      city: "Town",
      state: st!.state,
      lead_source: "COLD_OUTREACH",
    });
    expect(r.isError).toBeFalsy();
    const id = (r.structuredContent as { id: string }).id;
    const { data: acc } = await admin.db.from("accounts").select("territory_id").eq("id", id).single();
    expect(acc!.territory_id).toBe(st!.territory_id);

    // California is placed city by city: seed one town (the local database has none) and clean up.
    const town = `Testville${run}`;
    const { data: terr } = await admin.db.from("territory_states").select("territory_id").eq("state", st!.state).single();
    sql(`insert into territory_cities (org_id, state, city, territory_id) select org_id, 'CA', '${town}', '${terr!.territory_id}' from territory_states limit 1`);
    try {
      const r2 = await a.createAccount(admin, {
        name: `Placed ${run} ${town}`,
        account_type: "DEALER",
        city: town,
        state: "ca",
        lead_source: "COLD_OUTREACH",
      });
      const { data: acc2 } = await admin.db.from("accounts").select("territory_id").eq("id", (r2.structuredContent as { id: string }).id).single();
      expect(acc2!.territory_id).toBe(terr!.territory_id);
    } finally {
      sql(`delete from territory_cities where city = '${town}'`);
    }
  });

  it("a referral lead source also writes the REFERRED_BY relationship, logged as a create", async () => {
    const ref = await create(admin, `Referrer ${run} Boise`);
    const refId = (ref.structuredContent as { id: string }).id;
    const r = await a.createAccount(admin, {
      name: `Referred ${run} Boise`,
      account_type: "DEALER",
      city: "Boise",
      state: "ID",
      lead_source: "REFERRAL_DEALER",
      referring_account_id: refId,
    });
    expect(r.isError).toBeFalsy();
    const id = (r.structuredContent as { id: string }).id;
    const { data: rel } = await admin.db.from("account_relationships").select("id, relationship_type, account_b_id").eq("account_a_id", id);
    expect(rel).toMatchObject([{ relationship_type: "REFERRED_BY", account_b_id: refId }]);
    const { data: log } = await admin.db.from("agent_actions").select("entity, op").eq("entity_id", rel![0].id);
    expect(log).toEqual([{ entity: "account_relationships", op: "create" }]);
  });

  it("dealers_overview is refused for a role that does not see the board", async () => {
    const r = await v.dealersOverview(tj, {});
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("The Dealers board isn't part of your view in the app.");
  });
});
