import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AgentContext } from "../context";
import { PLATFORM_GUIDE } from "../guide";
import { fail, ok, type CallToolResult } from "../result";
import { tool, type GetCtx } from "../server";

export type FindArgs = { query: string; kind?: "account" | "contact" | "person"; limit?: number };

function todayIn(timeZone: string, now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now);
  return { date, weekday };
}

/** Escape what PostgREST ilike/or filters treat as syntax. */
export function likeTerm(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()"]/g, " ").trim();
}

export async function aboutMe(ctx: AgentContext): Promise<CallToolResult> {
  const { data: org } = await ctx.db.from("organizations").select("name").eq("id", ctx.me.orgId).maybeSingle();
  const { date, weekday } = todayIn(ctx.me.timeZone);
  const data = {
    name: ctx.me.name,
    email: ctx.me.email,
    role: ctx.me.role,
    organisation: org?.name ?? null,
    territory: ctx.me.territory ?? null,
    today: date,
    weekday,
    time_zone: ctx.me.timeZone,
    agent: ctx.via,
  };
  return ok(
    `${data.name} (${data.role}, ${data.email}) at ${data.organisation ?? "GMX"}` +
      `${data.territory ? `, territory ${data.territory}` : ""}. ` +
      `Today is ${weekday} ${date} (${ctx.me.timeZone}). You are connected as ${ctx.via}.`,
    data,
  );
}

export async function platformGuide(): Promise<CallToolResult> {
  return ok(PLATFORM_GUIDE);
}

type Candidate = {
  id: string;
  kind: "account" | "contact" | "person";
  name: string;
  city?: string | null;
  state?: string | null;
  account_type?: string | null;
  account?: string | null;
  email?: string | null;
  role?: string | null;
};

export async function find(ctx: AgentContext, args: FindArgs): Promise<CallToolResult> {
  const term = likeTerm(args.query ?? "");
  if (!term) return fail("Give me a name to look for.");
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 50);
  const pat = `%${term}%`;
  const out: Candidate[] = [];

  if (!args.kind || args.kind === "account") {
    const { data, error } = await ctx.db
      .from("accounts")
      .select("id, name, city, state, account_type")
      .ilike("name", pat)
      .order("name")
      .limit(limit);
    if (error) throw error;
    for (const a of data ?? []) out.push({ kind: "account", ...a });
  }
  if (!args.kind || args.kind === "contact") {
    const { data, error } = await ctx.db
      .from("contacts")
      .select("id, name, email, accounts!contacts_account_id_fkey(name, city, state)")
      .ilike("name", pat)
      .order("name")
      .limit(limit);
    if (error) throw error;
    for (const c of data ?? []) {
      const acc = c.accounts as { name: string; city: string | null; state: string | null } | null;
      out.push({
        id: c.id,
        kind: "contact",
        name: c.name,
        email: c.email,
        account: acc?.name ?? null,
        city: acc?.city ?? null,
        state: acc?.state ?? null,
      });
    }
  }
  if (!args.kind || args.kind === "person") {
    const { data, error } = await ctx.db
      .from("memberships")
      .select("id, role, users!inner(full_name, email)")
      .eq("status", "active")
      .or(`full_name.ilike.${pat},email.ilike.${pat}`, { referencedTable: "users" })
      .limit(limit);
    if (error) throw error;
    for (const m of data ?? []) {
      const u = m.users as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
      const user = Array.isArray(u) ? u[0] : u;
      if (!user) continue;
      out.push({ id: m.id, kind: "person", name: user.full_name || user.email, email: user.email, role: m.role });
    }
  }

  const rows = out.slice(0, limit);
  if (rows.length === 0) return ok(`Nothing matches "${args.query}".`, { items: [] });
  const lines = rows.map(
    (r) =>
      `- ${r.kind}: ${r.name}` +
      `${r.account ? ` (at ${r.account})` : ""}` +
      `${r.city ? `, ${r.city}` : ""}${r.state ? ` ${r.state}` : ""}` +
      `${r.account_type ? ` [${r.account_type}]` : ""}${r.role ? ` [${r.role}]` : ""} — id ${r.id}`,
  );
  const more = rows.length > 1 ? "\nMore than one match: ask the person which one they mean." : "";
  return ok(`${rows.length} match${rows.length === 1 ? "" : "es"}:\n${lines.join("\n")}${more}`, rows);
}

export function registerDiscoveryTools(server: McpServer, getCtx: GetCtx) {
  server.registerTool(
    "about_me",
    {
      title: "About me",
      description:
        "Who the person is on GMX Sales: name, role, organisation, territory, email, today's date and weekday in their time zone, and which agent you are. Call it first when you need to resolve 'today', 'tomorrow' or 'this week', or to know whose records you are acting on.",
      inputSchema: z.object({}),
    },
    tool<Record<string, never>>(getCtx, (ctx) => aboutMe(ctx)),
  );

  server.registerTool(
    "platform_guide",
    {
      title: "Platform guide",
      description:
        "The rules of GMX Sales for agents: what can be recorded, the fields each record needs, how PK follow-ups are prioritised, what needs the person's confirmation, and what is not available yet. Read it once before your first write.",
      inputSchema: z.object({}),
    },
    tool<Record<string, never>>(getCtx, () => platformGuide()),
  );

  server.registerTool(
    "find",
    {
      title: "Find an account, contact or person",
      description:
        "Look up accounts (dealers, distributors, branches, contractors), contacts or colleagues by part of a name. Returns every match with its id and city. Use it before any write that names an account or contact; never guess an id. If more than one result comes back, ask the person which one they mean — never pick one yourself. Banners return every branch (e.g. 'Ganahl' lists each Ganahl yard). Ask the person for the name if they have not given one.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Part of the name, e.g. 'Ganahl' or 'Maria'"),
        kind: z.enum(["account", "contact", "person"]).optional().describe("Limit to one kind; omit to search all three"),
        limit: z.number().int().min(1).max(50).optional().describe("Default 20, max 50"),
      }),
    },
    tool<FindArgs>(getCtx, (ctx, args) => find(ctx, args)),
  );
}
