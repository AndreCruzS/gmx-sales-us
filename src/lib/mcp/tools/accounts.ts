import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ACCOUNT_TYPES, LEAD_SOURCES_ALL, REFERRAL_LEAD_SOURCES } from "@/lib/domain/enums";
import { placeAddress, type TerritoryCityRow, type TerritoryStateRow } from "@/lib/domain/placement";
import {
  accountCreateSchema,
  accountNoteCreateSchema,
  accountUpdateSchema,
  contactCreateSchema,
  contactUpdateSchema,
} from "@/lib/domain/schemas";
import { logActionQuiet } from "../actions-log";
import type { AgentContext } from "../context";
import { changes, receipt } from "../receipt";
import { fail, ok, type CallToolResult } from "../result";
import { tool, type GetCtx } from "../server";
import { fetchAllPages } from "@/lib/supabase/page";
import { dbRow, idMaker, STALE, dbId } from "./shared";

export type GetAccountArgs = { id: string };
export type CreateAccountArgs = {
  name: string;
  account_type: (typeof ACCOUNT_TYPES)[number];
  city: string;
  state: string;
  postal_code?: string;
  lead_source: (typeof LEAD_SOURCES_ALL)[number];
  source_detail?: string;
  referring_account_id?: string;
};
export type UpdateAccountArgs = {
  id: string;
  updated_at: string;
  name?: string;
  account_type?: (typeof ACCOUNT_TYPES)[number];
  city?: string;
};
export type AddContactArgs = {
  account_id: string;
  name: string;
  job_title?: string;
  email?: string;
  phone?: string;
  is_champion?: boolean;
};
export type UpdateContactArgs = {
  id: string;
  updated_at: string;
  name?: string;
  job_title?: string;
  email?: string;
  phone?: string;
  is_champion?: boolean;
};
export type AddAccountNoteArgs = { account_id: string; body: string };

const CANT = "You can't change this account.";

/** Writes the database refuses on row-level security read as one plain sentence. */
function scopeProblem(e: { code?: string; message?: string }): CallToolResult | null {
  if (e.code === "42501" || e.code === "23503") return fail(CANT);
  return null;
}

// ---- get_account ----------------------------------------------------------

export async function getAccount(ctx: AgentContext, args: GetAccountArgs): Promise<CallToolResult> {
  const { data: acc, error } = await ctx.db
    .from("accounts")
    .select("id, name, account_type, city, state, postal_code, owner_id, territory_id, parent_account_id, lead_source, created_via, updated_at")
    .eq("id", args.id)
    .maybeSingle();
  if (error) throw error;
  if (!acc) return fail("I can't find that account — look it up with find.");

  const [c, na, nt, th] = await Promise.all([
    ctx.db
      .from("contacts")
      .select("id, name, job_title, email, phone, is_champion, updated_at")
      .eq("account_id", args.id)
      .order("is_champion", { ascending: false })
      .order("name"),
    ctx.db
      .from("next_actions")
      .select("id, action, due_date, due_time, kind, owner_id, objective, updated_at")
      .eq("account_id", args.id)
      .is("completed_at", null)
      .order("due_date"),
    ctx.db
      .from("account_notes")
      .select("id, body, created_at, author_id")
      .eq("account_id", args.id)
      .order("created_at", { ascending: false })
      .limit(10),
    ctx.db
      .from("email_threads")
      .select("id, subject, last_message_at, last_direction")
      .eq("matched_account_id", args.id)
      .order("last_message_at", { ascending: false })
      .limit(5),
  ]);
  for (const r of [c, na, nt, th]) if (r.error) throw r.error;
  const contacts = c.data ?? [];
  const items = na.data ?? [];
  const notes = nt.data ?? [];
  const threads = th.data ?? [];

  const lines = [
    `${acc.name} — ${acc.account_type.toLowerCase()}${acc.city ? `, ${acc.city}${acc.state ? `, ${acc.state}` : ""}` : ""}. id ${acc.id}, updated_at ${acc.updated_at}`,
    `Contacts (${contacts.length}):`,
    ...contacts.map(
      (x) =>
        `- ${x.name}${x.is_champion ? " (champion)" : ""}${x.job_title ? `, ${x.job_title}` : ""}${x.email ? `, ${x.email}` : ""}${x.phone ? `, ${x.phone}` : ""} — id ${x.id}, updated_at ${x.updated_at}`,
    ),
    `Open follow-ups (${items.length}):`,
    ...items.map((x) => `- ${x.due_date}${x.due_time ? ` ${x.due_time.slice(0, 5)}` : ""}: ${x.action} — id ${x.id}`),
    `Recent notes (${notes.length}):`,
    ...notes.map((x) => `- ${x.created_at.slice(0, 10)}: ${x.body}`),
    `Last email threads (${threads.length}):`,
    ...threads.map((x) => `- ${x.last_message_at?.slice(0, 10) ?? "?"}: ${x.subject ?? "(no subject)"}`),
  ];
  return ok(lines.join("\n"), { account: acc, contacts, open_items: items, notes, email_threads: threads });
}

// ---- create_account -------------------------------------------------------

export async function createAccount(ctx: AgentContext, args: CreateAccountArgs): Promise<CallToolResult> {
  const state = args.state.trim().toUpperCase();
  const city = args.city.trim();

  // Where the account lands, as the app's new-account form does: the address's own
  // region (by state; California by city), else the creator's patch (admins have none).
  const [st, ct, me] = await Promise.all([
    ctx.db.from("territory_states").select("state, territory_id").limit(200),
    state === "CA"
      ? fetchAllPages<TerritoryCityRow>((from, to) =>
          ctx.db.from("territory_cities").select("state, city, territory_id").order("state").order("city").range(from, to),
        )
      : Promise.resolve([] as TerritoryCityRow[]),
    ctx.db.from("memberships").select("territory_id").eq("id", ctx.me.membershipId).maybeSingle(),
  ]);
  if (st.error) throw st.error;
  if (me.error) throw me.error;
  const placement = placeAddress({ state, city }, (st.data as TerritoryStateRow[] | null) ?? [], ct);
  const territoryId = placement.territoryId ?? me.data?.territory_id ?? null;

  const id = idMaker(undefined)(0);
  const row = accountCreateSchema.parse({
    id,
    org_id: ctx.me.orgId,
    name: args.name.trim(),
    account_type: args.account_type,
    city,
    state,
    postal_code: args.postal_code ?? null,
    territory_id: territoryId,
    owner_id: ctx.me.membershipId,
    lead_source: args.lead_source,
    source_detail: args.source_detail ?? null,
    referring_account_id: args.referring_account_id ?? null,
  });
  const { data, error } = await ctx.db
    .from("accounts")
    .upsert(dbRow({ ...row, created_via: ctx.via }), { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) {
    if (error.code === "42501") return fail("You can't create accounts here.");
    throw error;
  }
  const lines = [`Created account: ${row.name}. Record ${id}.`];
  if (!territoryId) lines.push("It is not placed in a region yet (that state or city is not on the map).");
  if ((data ?? []).length > 0) {
    const n = await logActionQuiet(ctx, { tool: "create_account", entity: "accounts", entityId: id, op: "create" });
    if (n) lines.push(n);
  }

  // The app also writes the referral as a row on account_relationships (the new account is "a").
  if (args.referring_account_id && (REFERRAL_LEAD_SOURCES as readonly string[]).includes(args.lead_source) && (data ?? []).length > 0) {
    const relId = idMaker(undefined)(1);
    try {
      const rel = await ctx.db.from("account_relationships").insert(
        dbRow({
          id: relId,
          org_id: ctx.me.orgId,
          account_a_id: id,
          relationship_type: "REFERRED_BY",
          account_b_id: args.referring_account_id,
          created_by: ctx.me.membershipId,
        }),
      );
      if (rel.error) throw rel.error;
    } catch (e) {
      console.error("[mcp] create_account saved the account but not its referral row:", e);
      return fail(
        `Saved the account as ${id}, but recording who referred it failed. Don't call create_account again - the account exists.`,
        { id, partial: true },
      );
    }
    const n = await logActionQuiet(ctx, { tool: "create_account", entity: "account_relationships", entityId: relId, op: "create" });
    if (n) lines.push(n);
  }
  return ok(receipt(lines, [{ id, path: `/accounts/${id}` }]), { id, territory_id: territoryId });
}

// ---- update_account -------------------------------------------------------

export async function updateAccount(ctx: AgentContext, args: UpdateAccountArgs): Promise<CallToolResult> {
  const base = accountUpdateSchema.parse({ id: args.id, name: args.name, account_type: args.account_type, city: args.city });
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) if (k !== "id" && v !== undefined) patch[k] = v;
  if (Object.keys(patch).length === 0) return fail("Nothing to change — say what should be different.");

  const { data: prior, error: readErr } = await ctx.db.from("accounts").select(Object.keys(patch).join(", ")).eq("id", args.id).maybeSingle();
  if (readErr) throw readErr;
  if (!prior) return fail("I can't find that account — look it up with find.");

  const { data, error } = await ctx.db.from("accounts").update(dbRow(patch)).eq("id", args.id).eq("updated_at", args.updated_at).select("id");
  if (error) {
    const known = scopeProblem(error);
    if (known) return known;
    throw error;
  }
  if ((data ?? []).length === 0) return fail(STALE);
  const before = prior as unknown as Record<string, unknown>;
  const note = await logActionQuiet(ctx, { tool: "update_account", entity: "accounts", entityId: args.id, op: "update", before });
  return ok(receipt([`Updated account ${args.id}. ${changes(before, patch)}.`, ...(note ? [note] : [])], [{ id: args.id, path: `/accounts/${args.id}` }]), { id: args.id });
}

// ---- add_contact / update_contact ----------------------------------------

export async function addContact(ctx: AgentContext, args: AddContactArgs): Promise<CallToolResult> {
  const id = idMaker(undefined)(0);
  const row = contactCreateSchema.parse({
    id,
    org_id: ctx.me.orgId,
    account_id: args.account_id,
    name: args.name.trim(),
    job_title: args.job_title ?? null,
    email: args.email ?? null,
    phone: args.phone ?? null,
    is_champion: args.is_champion,
  });
  const { data, error } = await ctx.db
    .from("contacts")
    .upsert(dbRow({ ...row, is_champion: row.is_champion ?? false, created_via: ctx.via }), { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) {
    const known = scopeProblem(error);
    if (known) return known;
    throw error;
  }
  const note =
    (data ?? []).length > 0 ? await logActionQuiet(ctx, { tool: "add_contact", entity: "contacts", entityId: id, op: "create" }) : null;
  return ok(receipt([`Added contact: ${row.name}. Record ${id}.`, ...(note ? [note] : [])], [{ id, path: `/accounts/${args.account_id}` }]), { id });
}

export async function updateContact(ctx: AgentContext, args: UpdateContactArgs): Promise<CallToolResult> {
  const base = contactUpdateSchema.parse({
    id: args.id,
    name: args.name,
    job_title: args.job_title,
    email: args.email,
    phone: args.phone,
    is_champion: args.is_champion,
  });
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) if (k !== "id" && v !== undefined) patch[k] = v;
  if (Object.keys(patch).length === 0) return fail("Nothing to change — say what should be different.");

  const { data: prior, error: readErr } = await ctx.db
    .from("contacts")
    .select(`account_id, ${Object.keys(patch).join(", ")}`)
    .eq("id", args.id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!prior) return fail("I can't find that contact (or it isn't yours to change).");
  const { account_id, ...before } = prior as unknown as { account_id: string } & Record<string, unknown>;

  const { data, error } = await ctx.db.from("contacts").update(dbRow(patch)).eq("id", args.id).eq("updated_at", args.updated_at).select("id");
  if (error) {
    const known = scopeProblem(error);
    if (known) return known;
    throw error;
  }
  if ((data ?? []).length === 0) return fail(STALE);
  const note = await logActionQuiet(ctx, { tool: "update_contact", entity: "contacts", entityId: args.id, op: "update", before });
  return ok(receipt([`Updated contact ${args.id}. ${changes(before, patch)}.`, ...(note ? [note] : [])], [{ id: args.id, path: `/accounts/${account_id}` }]), { id: args.id });
}

// ---- add_account_note -----------------------------------------------------

export async function addAccountNote(ctx: AgentContext, args: AddAccountNoteArgs): Promise<CallToolResult> {
  const id = idMaker(undefined)(0);
  const row = accountNoteCreateSchema.parse({
    id,
    org_id: ctx.me.orgId,
    account_id: args.account_id,
    author_id: ctx.me.membershipId,
    body: args.body,
  });
  const { data, error } = await ctx.db
    .from("account_notes")
    .upsert(dbRow({ ...row, created_via: ctx.via }), { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) {
    const known = scopeProblem(error);
    if (known) return known;
    throw error;
  }
  const note =
    (data ?? []).length > 0 ? await logActionQuiet(ctx, { tool: "add_account_note", entity: "account_notes", entityId: id, op: "create" }) : null;
  return ok(receipt(["Note added.", ...(note ? [note] : [])], [{ id, path: `/accounts/${args.account_id}` }]), { id });
}

// ---- registration ---------------------------------------------------------

const writeNote =
  " This writes immediately. Do not guess: ask the person for anything missing. When you finish, tell them in a short list what you recorded.";

export function registerAccountTools(server: McpServer, getCtx: GetCtx) {
  server.registerTool(
    "get_account",
    {
      title: "Open an account",
      description:
        "Everything about one account: its details, contacts, open follow-ups, the 10 latest notes and the subjects of the last 5 email threads. Look the account up with find first. The updated_at values are what update_account and update_contact need.",
      inputSchema: z.object({ id: dbId() }),
    },
    tool<GetAccountArgs>(getCtx, (ctx, a) => getAccount(ctx, a)),
  );

  server.registerTool(
    "create_account",
    {
      title: "Create an account",
      description:
        'Create a new account (dealer, distributor, contractor...). Its name follows the rule "<Company> <City>", for example "Big Creek Lumber Boise". Use find first to make sure it does not exist already. Ask the person for the city, the state (two letters), the type and where the lead came from; do not guess. The person owns the new account.' +
        writeNote,
      inputSchema: z.object({
        name: z.string().min(1).describe('"<Company> <City>", e.g. "Big Creek Lumber Boise"'),
        account_type: z.enum(ACCOUNT_TYPES),
        city: z.string().min(1),
        state: z.string().length(2).describe("Two-letter state, e.g. ID"),
        postal_code: z.string().regex(/^\d{5}$/).optional(),
        lead_source: z.enum(LEAD_SOURCES_ALL).describe("Where the lead came from; ask the person"),
        source_detail: z.string().optional().describe("Required when lead_source is OTHER"),
        referring_account_id: dbId().optional().describe("Required for referral lead sources"),
      }),
    },
    tool<CreateAccountArgs>(getCtx, (ctx, a) => createAccount(ctx, a)),
  );

  server.registerTool(
    "update_account",
    {
      title: "Correct an account",
      description:
        'Correct an account\'s name, type or city. Read it first with get_account and pass its updated_at; if it changed meanwhile you are told to read again. Keep the name in the form "<Company> <City>".' +
        writeNote,
      inputSchema: z.object({
        id: dbId(),
        updated_at: z.string().describe("The updated_at you read"),
        name: z.string().min(1).optional(),
        account_type: z.enum(ACCOUNT_TYPES).optional(),
        city: z.string().min(1).optional(),
      }),
    },
    tool<UpdateAccountArgs>(getCtx, (ctx, a) => updateAccount(ctx, a)),
  );

  server.registerTool(
    "add_contact",
    {
      title: "Add a contact",
      description: "Add a person to an account (look the account up with find). Ask for the name; the rest is optional." + writeNote,
      inputSchema: z.object({
        account_id: dbId(),
        name: z.string().min(1),
        job_title: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        is_champion: z.boolean().optional().describe("The account's elected champion"),
      }),
    },
    tool<AddContactArgs>(getCtx, (ctx, a) => addContact(ctx, a)),
  );

  server.registerTool(
    "update_contact",
    {
      title: "Correct a contact",
      description:
        "Correct a contact's name, title, email, phone or champion flag. Read it first with get_account and pass its updated_at; if it changed meanwhile you are told to read again." +
        writeNote,
      inputSchema: z.object({
        id: dbId(),
        updated_at: z.string().describe("The updated_at you read"),
        name: z.string().min(1).optional(),
        job_title: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        is_champion: z.boolean().optional(),
      }),
    },
    tool<UpdateContactArgs>(getCtx, (ctx, a) => updateContact(ctx, a)),
  );

  server.registerTool(
    "add_account_note",
    {
      title: "Add a note to an account",
      description: "Add a note to an account's history: what someone learned or decided." + writeNote,
      inputSchema: z.object({ account_id: dbId(), body: z.string().min(1) }),
    },
    tool<AddAccountNoteArgs>(getCtx, (ctx, a) => addAccountNote(ctx, a)),
  );
}
