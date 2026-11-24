// QUOTES THROUGH THE AGENT (Andre, 2026-11-17). The Reps board's scoreboard
// ("Quotes on the platform", João's ask) reads only the quotes reps record,
// so the agent has to be able to record them: open a quote, walk it through
// its stages, and read the board back.
//
// A quote is an opportunity at a priced stage (src/lib/domain/quotes.ts); it
// is born through the app's own create_opportunity_with_action, because the
// stage gate wants the deal and an open next action in one transaction. The
// app's quote flow keeps its products as SKU-priced survey lines
// (quote_items); the agent has no catalogue, so it writes the product and its
// LF on the deal itself — quoteProduct() reads either.

import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { defaultDeadline, todayIn } from "@/lib/domain/deadline";
import { isQuoteStage } from "@/lib/domain/enums";
import { quoteStageLabel } from "@/lib/domain/quotes";
import {
  quoteProduct,
  quoteSummary,
  type QuoteLine,
  type SummaryEvent,
} from "@/lib/domain/quote-summary";
import {
  CATALOG_FAVORITES,
  catalogBySkus,
  catalogConfigured,
  favoriteCatalog,
  searchCatalog,
  type CatalogItem,
} from "@/lib/catalog/search";
import { displayAccountName, formatMoney } from "@/lib/format";
import { fetchAllPages } from "@/lib/supabase/page";
import { logActionQuiet } from "../actions-log";
import type { AgentContext } from "../context";
import { changes, receipt } from "../receipt";
import { fail, ok, type CallToolResult } from "../result";
import { tool, type GetCtx } from "../server";
import { givesWorkToOthers } from "@/lib/domain/roles";
import { dbId, dbRow, gate, STALE } from "./shared";

/** The stages a quote walks through, in the words the agent is given. */
export const QUOTE_WALK = ["QUOTE", "DECISION", "WON", "LOST", "ON_HOLD"] as const;
type QuoteStage = (typeof QUOTE_WALK)[number];

const STAGE_WORDS: Record<QuoteStage, string> = {
  QUOTE: "out for quote",
  DECISION: "they are deciding",
  WON: "won",
  LOST: "lost",
  ON_HOLD: "on hold",
};

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const CATALOG_OFF = "The product catalog is not connected on this server — the quote's products can be added in the app.";
const CATALOG_DOWN = "The product catalog did not answer — try again in a minute. Nothing was saved.";

const NEEDS_ACTION =
  "An open quote needs an open follow-up, and I could not plan one. Plan it with plan_follow_up, then try again.";

// Whose quote it is (Andre, 2026-11-24): Bianca recorded three quotes for
// Anthony Peca through the agent and they all landed in her name, because
// neither tool had an owner. Same rule as a follow-up: only an admin (or an
// assistant) gives one to a colleague, and only after the person's yes.
const ONLY_ADMINS_GIVE =
  "In GMX Sales only an admin gives a quote to someone else, so I can't either. I can record it in your name, or an admin can hand it over.";
const GIVES = "This records a quote in someone else's name.";

/** An active colleague's name, or null when the id is not one. */
async function colleagueName(ctx: AgentContext, id: string): Promise<string | null> {
  const { data, error } = await ctx.db
    .from("memberships")
    .select("id, users!inner(full_name, email)")
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const u = data.users as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
  const user = Array.isArray(u) ? u[0] : u;
  return user ? user.full_name || user.email : null;
}

const money = (v: number | null | undefined) => (v === null || v === undefined ? "no value" : formatMoney(Math.round(v)));
const qty = (n: number | null, unit: string | null) => (n && n > 0 ? `${QTY.format(n)} ${unit ?? "LF"}` : null);

export type CreateQuoteArgs = {
  account_id: string;
  lines?: LineInput[];
  product?: string;
  quantity_lf?: number;
  price_per_lf?: number;
  value?: number;
  status: string;
  stage?: "QUOTE" | "DECISION";
  contact_id?: string;
  follow_up?: string;
  follow_up_date?: string;
  owner_id?: string;
  confirmation?: string;
};

export type UpdateQuoteArgs = {
  id: string;
  updated_at: string;
  stage?: QuoteStage;
  status?: string;
  value?: number;
  product?: string;
  quantity_lf?: number;
  price_per_lf?: number;
  reason?: string;
  owner_id?: string;
  confirmation?: string;
};

export type QuoteSummaryArgs = { owner_id?: string };

/** value wins; else LF × price; else nothing. */
function valueOf(a: { value?: number; quantity_lf?: number; price_per_lf?: number }): number | null {
  if (a.value !== undefined) return Math.round(a.value);
  if (a.quantity_lf !== undefined && a.price_per_lf !== undefined) return Math.round(a.quantity_lf * a.price_per_lf);
  return null;
}

// ---- search_catalog -------------------------------------------------------

export type SearchCatalogArgs = { query?: string; favorite?: string };

/** The product catalog, through the same door as the app's picker. */
export async function searchCatalogTool(_ctx: AgentContext, args: SearchCatalogArgs): Promise<CallToolResult> {
  if (!catalogConfigured()) return fail(CATALOG_OFF);
  const q = args.query?.trim() ?? "";
  if (!args.favorite && q.length < 2)
    return fail("Give a search of at least two letters (species and size work best, e.g. 'ayous 1x6').");
  let result: Awaited<ReturnType<typeof searchCatalog>> | null;
  try {
    result = args.favorite ? await favoriteCatalog(args.favorite) : await searchCatalog(q);
  } catch {
    return fail(CATALOG_DOWN);
  }
  if (!result)
    return fail(`No favourite called "${args.favorite}". The favourites are: ${CATALOG_FAVORITES.map((f) => f.id).join(", ")}.`);
  const items = result.items;
  if (items.length === 0)
    return ok(`Nothing in the catalog matches "${q || args.favorite}". Try fewer words: the species and the size.`, { items: [] });
  const out = [
    `${items.length} product${items.length === 1 ? "" : "s"}${items.length === 25 ? " (the first 25 — narrow the search for others)" : ""}:`,
    ...items.map(
      (i) =>
        `- ${i.sku}: ${i.description}${i.randomLength ? " — random length, quoted in LF only" : i.lf_per_piece ? ` — ${i.lf_per_piece} LF per piece` : ""}; ${i.randomLength ? "no stock figure (random length)" : `${QTY.format(i.lfAvailable)} LF available in ${i.branches} branch${i.branches === 1 ? "" : "es"}`}`,
    ),
  ];
  return ok(out.join("\n"), {
    items: items.map((i) => ({
      sku: i.sku,
      description: i.description,
      species: i.species,
      profile: i.profile,
      nominal_size: i.nominal_size,
      random_length: i.randomLength,
      lf_per_piece: i.lf_per_piece,
      lf_available: i.lfAvailable,
      pieces_available: i.piecesAvailable,
    })),
    refreshed_at: result.refreshedAt,
  });
}

// ---- create_quote ---------------------------------------------------------

export type LineInput = { sku: string; quantity: number; unit: "LF" | "PC"; price_per_lf?: number };

export type BuiltLine = {
  sku: string;
  description: string;
  species: string | null;
  profile: string | null;
  nominal_size: string | null;
  lf_per_piece: number | null;
  qty_input: number;
  input_uom: "LF" | "PC";
  lf: number;
  price_per_lf: number | null;
};

/**
 * The catalog is the authority on every line (the voice-quote rule): identity
 * fields come from the catalog row, never from what the agent typed, and
 * pieces become LF by the catalog's own LF per piece. A sku the catalog does
 * not have, or pieces of a random-length product, refuse the whole list.
 */
export function buildQuoteLines(
  input: readonly LineInput[],
  catalog: readonly CatalogItem[],
): { lines: BuiltLine[]; unknown: string[]; problems: string[] } {
  const bySku = new Map(catalog.map((i) => [i.sku.toUpperCase(), i] as const));
  const lines: BuiltLine[] = [];
  const unknown: string[] = [];
  const problems: string[] = [];
  for (const l of input) {
    const item = bySku.get(l.sku.trim().toUpperCase());
    if (!item) {
      unknown.push(l.sku);
      continue;
    }
    const perPiece = item.randomLength ? null : item.lf_per_piece;
    if (l.unit === "PC" && !perPiece) {
      problems.push(`${item.sku} (${item.description}) is sold by the linear foot: give its quantity in LF.`);
      continue;
    }
    lines.push({
      sku: item.sku,
      description: item.description,
      species: item.species,
      profile: item.profile,
      nominal_size: item.nominal_size,
      lf_per_piece: perPiece,
      qty_input: l.quantity,
      input_uom: l.unit,
      lf: Math.round((l.unit === "LF" ? l.quantity : l.quantity * (perPiece as number)) * 100) / 100,
      price_per_lf: l.price_per_lf !== undefined && l.price_per_lf > 0 ? l.price_per_lf : null,
    });
  }
  return { lines, unknown, problems };
}

export async function createQuote(ctx: AgentContext, args: CreateQuoteArgs): Promise<CallToolResult> {
  const given = args.lines ?? [];
  const catalogOn = catalogConfigured();
  if (given.length === 0) {
    // With the catalog wired up, products are catalog lines, as in the app.
    if (catalogOn)
      return fail(
        "Give the products as catalog lines (lines: sku, quantity, unit, price per LF). Find each sku with search_catalog first — never guess one.",
      );
    if (!args.product?.trim()) return fail("Say what is quoted: the product.");
    if (args.price_per_lf !== undefined && args.quantity_lf === undefined && args.value === undefined)
      return fail("A price per LF needs the quantity in LF too, or give the quote's total value instead.");
  }

  // Every sku checked before anything is written.
  let built: BuiltLine[] = [];
  if (given.length > 0) {
    if (!catalogOn) return fail(CATALOG_OFF);
    let catalog: CatalogItem[];
    try {
      catalog = (await catalogBySkus(given.map((l) => l.sku))).items;
    } catch {
      return fail(CATALOG_DOWN);
    }
    const r = buildQuoteLines(given, catalog);
    if (r.unknown.length > 0 || r.problems.length > 0) {
      return fail(
        [
          "Nothing was saved.",
          r.unknown.length > 0
            ? `Not in the catalog: ${r.unknown.join(", ")}. Look each one up with search_catalog and use the sku it returns.`
            : "",
          ...r.problems,
        ]
          .filter(Boolean)
          .join(" "),
        { unknown_skus: r.unknown, problems: r.problems },
      );
    }
    built = r.lines;
  }

  const owner = args.owner_id ?? ctx.me.membershipId;
  let ownerName: string | null = null;
  if (owner !== ctx.me.membershipId) {
    if (!givesWorkToOthers(ctx.me.role)) return fail(ONLY_ADMINS_GIVE);
    ownerName = await colleagueName(ctx, owner);
    if (!ownerName) return fail("I can't find that person — look them up with find.");
  }

  const [acc, me] = await Promise.all([
    ctx.db.from("accounts").select("id, name, territory_id").eq("id", args.account_id).maybeSingle(),
    ctx.db.from("memberships").select("territory_id").eq("id", owner).maybeSingle(),
  ]);
  if (acc.error) throw acc.error;
  if (!acc.data) return fail("I can't find that account — look it up with find.");
  // As the app's deal form: the account's patch, else the owner's.
  const territory = acc.data.territory_id ?? me.data?.territory_id ?? null;
  if (!territory)
    return fail(
      "This account has no territory yet and neither does your login, so the quote has no patch to land in. Give the account its territory in the app first.",
    );

  if (args.contact_id) {
    const { data: c } = await ctx.db.from("contacts").select("id").eq("id", args.contact_id).eq("account_id", args.account_id).maybeSingle();
    if (!c) return fail("That contact is not on this account — look them up with find.");
  }

  const today = todayIn();
  const stage = args.stage ?? "QUOTE";
  // As the app: the estimate is arithmetic — Σ LF × price over the priced
  // lines — unless the person gave the total.
  const priced = built.reduce((n, l) => n + (l.price_per_lf ? l.lf * l.price_per_lf : 0), 0);
  const value =
    args.value !== undefined
      ? Math.round(args.value)
      : built.length > 0
        ? priced > 0
          ? Math.round(priced)
          : null
        : valueOf(args);
  const unpriced = built.filter((l) => !l.price_per_lf).length;
  const product =
    built.length > 0
      ? `${[built[0].species, built[0].nominal_size].filter(Boolean).join(" ") || built[0].description}${built.length > 1 ? ` +${built.length - 1}` : ""}`
      : (args.product ?? "").trim();
  const name = `Quote — ${displayAccountName(acc.data.name)} · ${product} · ${DAY.format(new Date(`${today}T00:00:00Z`))}`;
  const due = args.follow_up_date ?? defaultDeadline("QUOTE_FOLLOW_UP", false, today);
  const action = args.follow_up?.trim() || `Follow up on the ${product} quote`;
  const held = gate(
    ctx,
    "create_quote",
    args as unknown as Record<string, unknown>,
    () => `open the quote "${name}" (${money(value)}) in ${ownerName}'s name, with its follow-up.`,
    ownerName ? GIVES : null,
  );
  if (held) return held;

  const id = randomUUID();
  const actionId = randomUUID();

  const { error } = await ctx.db.rpc("create_opportunity_with_action", {
    p_opportunity: {
      id,
      org_id: ctx.me.orgId,
      name,
      primary_account_id: args.account_id,
      territory_id: territory,
      owner_id: owner,
      stage,
      current_status: args.status.trim(),
      estimated_revenue: value,
      contact_id: args.contact_id ?? null,
    },
    p_next_action: {
      id: actionId,
      org_id: ctx.me.orgId,
      action,
      owner_id: owner,
      due_date: due,
      account_id: args.account_id,
      opportunity_id: id,
      kind: "QUOTE_FOLLOW_UP",
    },
  });
  if (error) {
    if (error.code === "42501" || error.code === "23503") return fail("You can't open a quote on this account.");
    if (error.code === "23514") return fail(NEEDS_ACTION);
    throw error;
  }

  const lines = [`Opened the quote "${name}" (${STAGE_WORDS[stage]}), ${money(value)}${ownerName ? `, in ${ownerName}'s name` : ""}.`];
  if (built.length > 0) {
    // The lines reference the deal, so they follow it — as in the app.
    const { error: iErr } = await ctx.db.from("quote_items").insert(
      built.map((l) =>
        dbRow({ ...l, org_id: ctx.me.orgId, opportunity_id: id, account_id: args.account_id, created_by: ctx.me.membershipId }),
      ),
    );
    if (iErr) {
      console.error("[mcp] create_quote: lines not saved", iErr);
      lines.push("The quote is open but its product lines did NOT save — tell the person to add them in the app; do not create the quote again.");
    } else {
      lines.push(
        "Lines (checked against the catalog):",
        ...built.map(
          (l) =>
            `- ${l.sku} ${l.description}: ${QTY.format(l.qty_input)} ${l.input_uom}${l.input_uom === "PC" ? ` = ${QTY.format(l.lf)} LF` : ""}${l.price_per_lf ? ` × $${l.price_per_lf}/LF = ${money(l.lf * l.price_per_lf)}` : ", no price"}`,
        ),
      );
      if (unpriced > 0 && args.value === undefined)
        lines.push(
          `${unpriced} line${unpriced === 1 ? " has" : "s have"} no price, so the value counts only the priced ones. If the person has the total, set it with update_quote (value).`,
        );
    }
  } else {
    // No catalog on this server: the product in words, on the deal (the
    // create RPC names its columns and the product is not one of them).
    const { error: pErr } = await ctx.db
      .from("opportunities")
      .update(
        dbRow({
          product,
          estimated_quantity: args.quantity_lf ?? null,
          quantity_unit: args.quantity_lf !== undefined ? "LF" : null,
        }),
      )
      .eq("id", id);
    lines.push(`Product: ${[product, qty(args.quantity_lf ?? null, "LF")].filter(Boolean).join(", ")} (not checked: no catalog is connected).`);
    if (pErr) lines.push("The product and LF did not save on the quote — set them with update_quote.");
  }
  lines.push(
    `Where it stands: ${args.status.trim()}.`,
    `Follow-up planned: ${action}, due ${due}${args.follow_up_date ? "" : " (the default for a quote follow-up)"}${ownerName ? `, for ${ownerName}` : ""}.`,
    `Quote ${id}.`,
    "A new quote can't be undone from here: fix it with update_quote, or mark it lost.",
  );
  return ok(receipt(lines, [{ id, path: `/accounts/${args.account_id}` }]), {
    id,
    owner_id: owner,
    follow_up_id: actionId,
    name,
    stage,
    estimated_revenue: value,
    lines: built,
    follow_up_due: due,
  });
}

// ---- update_quote ---------------------------------------------------------

export async function updateQuote(ctx: AgentContext, args: UpdateQuoteArgs): Promise<CallToolResult> {
  const { data: q, error: readErr } = await ctx.db
    .from("opportunities")
    .select("id, name, stage, current_status, current_blocker, estimated_revenue, product, estimated_quantity, quantity_unit, owner_id, org_id, primary_account_id, updated_at")
    .eq("id", args.id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!q) return fail("I can't find that quote — read it with quote_summary or get_account.");
  if (q.updated_at !== args.updated_at) return fail(STALE);

  // A quote made of catalog lines keeps them: words on the deal would hide them.
  if (args.product !== undefined || args.quantity_lf !== undefined || args.price_per_lf !== undefined) {
    const { count, error } = await ctx.db
      .from("quote_items")
      .select("id", { count: "exact", head: true })
      .eq("opportunity_id", q.id);
    if (error) throw error;
    if ((count ?? 0) > 0)
      return fail(
        "This quote's products are catalog lines, so they are changed in the app. Here you can change its total (value), stage and where it stands.",
      );
  }

  const patch: Record<string, unknown> = {};
  if (args.stage !== undefined && args.stage !== q.stage) patch.stage = args.stage;
  if (args.status !== undefined && args.status.trim() !== q.current_status) patch.current_status = args.status.trim();
  if (args.reason !== undefined) patch.current_blocker = args.reason.trim() || null;
  if (args.product !== undefined) patch.product = args.product.trim();
  if (args.quantity_lf !== undefined) {
    patch.estimated_quantity = args.quantity_lf;
    patch.quantity_unit = "LF";
  }
  const lf = args.quantity_lf ?? (q.quantity_unit === "LF" ? Number(q.estimated_quantity ?? 0) : 0);
  if (args.price_per_lf !== undefined && args.value === undefined && !(lf > 0))
    return fail("A price per LF needs the quantity in LF — give it, or the quote's total value instead.");
  const value = valueOf({ value: args.value, quantity_lf: lf || undefined, price_per_lf: args.price_per_lf });
  if (value !== null) patch.estimated_revenue = value;
  let newOwner: string | null = null;
  if (args.owner_id !== undefined && args.owner_id !== q.owner_id) {
    if (!givesWorkToOthers(ctx.me.role)) return fail(ONLY_ADMINS_GIVE);
    newOwner = await colleagueName(ctx, args.owner_id);
    if (!newOwner) return fail("I can't find that person — look them up with find.");
    patch.owner_id = args.owner_id;
  }
  if (Object.keys(patch).length === 0) return fail("Nothing to change — say what should be different.");

  const mine = q.owner_id === ctx.me.membershipId;
  const rest = Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "owner_id"));
  const held = gate(
    ctx,
    "update_quote",
    args,
    () =>
      newOwner
        ? `hand "${q.name}" to ${newOwner}, with its open follow-ups${Object.keys(rest).length > 0 ? `, and change ${changes(q as Record<string, unknown>, rest)}` : ""}.`
        : `change "${q.name}" (${changes(q as Record<string, unknown>, patch)}), a quote that belongs to someone else.`,
    newOwner ? "This hands a quote to someone else." : mine ? null : "This changes a colleague's quote.",
  );
  if (held) return held;

  // The stage gate: an open stage needs an open next action. If none is on
  // the books, plan the quote follow-up first, as the app's stage sheet asks.
  const target = (patch.stage ?? q.stage) as string;
  let planned: { id: string; due: string } | null = null;
  if (patch.stage !== undefined && target !== "WON" && target !== "LOST") {
    const { data: open, error } = await ctx.db
      .from("next_actions")
      .select("id")
      .eq("opportunity_id", q.id)
      .is("completed_at", null)
      .limit(1);
    if (error) throw error;
    if ((open ?? []).length === 0) {
      const due = defaultDeadline("QUOTE_FOLLOW_UP", false, todayIn());
      const nid = randomUUID();
      const { error: naErr } = await ctx.db.from("next_actions").insert(
        dbRow({
          id: nid,
          org_id: q.org_id,
          action: `Follow up on ${q.product ? `the ${q.product} quote` : "the quote"}`,
          owner_id: (patch.owner_id as string | undefined) ?? q.owner_id,
          due_date: due,
          account_id: q.primary_account_id,
          opportunity_id: q.id,
          kind: "QUOTE_FOLLOW_UP",
          source: "MANUAL",
          created_via: ctx.via,
        }),
      );
      if (naErr) {
        if (naErr.code === "42501") return fail(NEEDS_ACTION);
        throw naErr;
      }
      planned = { id: nid, due };
      await logActionQuiet(ctx, { tool: "update_quote", entity: "next_actions", entityId: nid, op: "create" });
    }
  }

  const before: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) before[k] = (q as Record<string, unknown>)[k];
  const { data, error } = await ctx.db
    .from("opportunities")
    .update(dbRow(patch))
    .eq("id", q.id)
    .eq("updated_at", q.updated_at)
    .select("id, updated_at");
  if (error) {
    if (error.code === "42501") return fail("You can't change this quote.");
    if (error.code === "23514") return fail(NEEDS_ACTION);
    throw error;
  }
  if ((data ?? []).length === 0) return fail(STALE);

  const lines = [`Changed "${q.name}": ${changes(before, patch)}.`];
  if (newOwner) {
    // The quote's open follow-ups go with it: the new owner is the one chasing it.
    const { data: open, error: oErr } = await ctx.db
      .from("next_actions")
      .select("id, action")
      .eq("opportunity_id", q.id)
      .eq("owner_id", q.owner_id)
      .is("completed_at", null);
    if (oErr) throw oErr;
    const moved: string[] = [];
    for (const n of open ?? []) {
      const { data: m, error: mErr } = await ctx.db
        .from("next_actions")
        .update(dbRow({ owner_id: args.owner_id }))
        .eq("id", n.id)
        .eq("owner_id", q.owner_id)
        .select("id");
      if (mErr || (m ?? []).length === 0) continue;
      moved.push(n.action);
      await logActionQuiet(ctx, { tool: "update_quote", entity: "next_actions", entityId: n.id, op: "update", before: { owner_id: q.owner_id } });
    }
    lines.push(
      `It is now ${newOwner}'s quote.`,
      moved.length > 0
        ? `Its open follow-up${moved.length === 1 ? "" : "s"} moved to ${newOwner} too: ${moved.join("; ")}.`
        : "It had no open follow-up of the previous owner to move.",
    );
  }
  if (patch.stage === "WON") lines.push(`Won at ${money((patch.estimated_revenue as number | undefined) ?? q.estimated_revenue)} — it counts on the Reps scoreboard from today.`);
  if (planned) lines.push(`An open quote needs a follow-up, so I planned one: due ${planned.due} (the default for a quote follow-up). Record ${planned.id}.`);
  if (patch.stage === "WON" || patch.stage === "LOST") {
    const { data: open } = await ctx.db.from("next_actions").select("id, action, due_date").eq("opportunity_id", q.id).is("completed_at", null);
    if ((open ?? []).length > 0)
      lines.push(`Still open on this quote: ${(open ?? []).map((o) => `${o.action} (${o.due_date}, id ${o.id})`).join("; ")}. Ask the person whether to close it with update_follow_up.`);
  }
  const note = await logActionQuiet(ctx, { tool: "update_quote", entity: "opportunities", entityId: q.id, op: "update", before });
  if (note) lines.push(note);
  return ok(receipt(lines, [{ id: q.id, path: `/accounts/${q.primary_account_id}` }]), {
    id: q.id,
    updated_at: data![0].updated_at,
    changed: patch,
  });
}

// ---- quote_summary --------------------------------------------------------

type DealRow = {
  id: string;
  name: string;
  stage: string;
  estimated_revenue: number | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
  primary_account_id: string;
  product: string | null;
  estimated_quantity: number | null;
  quantity_unit: string | null;
  current_status: string | null;
  account: { name: string } | null;
};

export async function quoteSummaryTool(ctx: AgentContext, args: QuoteSummaryArgs): Promise<CallToolResult> {
  const db = ctx.db;
  const [deals, events, items, people] = await Promise.all([
    fetchAllPages<DealRow>((from, to) =>
      db
        .from("opportunities")
        .select(
          "id, name, stage, estimated_revenue, owner_id, created_at, updated_at, primary_account_id, product, estimated_quantity, quantity_unit, current_status, account:accounts!opportunities_primary_account_id_fkey(name)",
        )
        .order("id")
        .range(from, to),
    ),
    fetchAllPages<SummaryEvent>((from, to) =>
      db.from("opportunity_stage_events").select("opportunity_id, to_stage, occurred_at").order("occurred_at").range(from, to),
    ),
    fetchAllPages<QuoteLine & { opportunity_id: string }>((from, to) =>
      db.from("quote_items").select("opportunity_id, description, species, nominal_size, lf").order("created_at").range(from, to),
    ),
    db.from("memberships").select("id, users!inner(full_name, email)").eq("status", "active").limit(500),
  ]);
  if (people.error) throw people.error;
  const names = new Map<string, string>();
  for (const m of people.data ?? []) {
    const u = m.users as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
    const user = Array.isArray(u) ? u[0] : u;
    if (user) names.set(m.id, user.full_name || user.email);
  }

  const owner = args.owner_id ?? null;
  if (owner && !names.has(owner)) return fail("I can't read that person's quotes — look them up with find.");
  const today = todayIn();
  const s = quoteSummary(deals, events, owner, today);

  const lines = new Map<string, QuoteLine[]>();
  for (const l of items) lines.set(l.opportunity_id, [...(lines.get(l.opportunity_id) ?? []), l]);
  const byId = new Map(deals.map((d) => [d.id, d] as const));
  const describe = (d: DealRow) => {
    const p = quoteProduct(d, lines.get(d.id) ?? []);
    return [p.product, qty(p.quantity, p.unit)].filter(Boolean).join(", ");
  };
  const who = owner ? names.get(owner)! : "the team";

  const open = deals
    .filter((d) => (!owner || d.owner_id === owner) && isQuoteStage(d.stage))
    .sort((a, b) => (b.estimated_revenue ?? 0) - (a.estimated_revenue ?? 0));

  const out: string[] = [];
  if (s.quotesSent === 0) {
    out.push(`Quotes on the platform — ${who}: no quote has been priced yet, so every figure is empty. The board fills as quotes are recorded (create_quote).`);
  } else {
    out.push(`Quotes on the platform — ${who}, since the week of ${s.curve[0]?.week ?? today}.`);
    out.push(`- Closed revenue: ${s.wonCount > 0 ? `${money(s.closed)} (${s.wonCount} ${s.wonCount === 1 ? "sale" : "sales"} won)` : "none won yet"}`);
    out.push(`- Active pipeline: ${s.openCount > 0 ? `${money(s.pipeline)} (${s.openCount} waiting on an answer)` : "nothing waiting on an answer"}`);
    out.push(`- Win rate: ${s.winRate !== null ? `${Math.round(s.winRate * 100)}% (${s.wonCount} won of ${s.decided} decided)` : "nothing won or lost yet"}`);
    out.push(`- Quotes sent: ${s.quotesSent}`);
    out.push(`- Average ticket: ${s.avgTicket !== null ? money(s.avgTicket) : "needs a won quote"}`);
    if (s.topWins.length > 0) {
      out.push("Biggest wins:");
      s.topWins.forEach((w, i) => {
        const d = byId.get(w.id);
        out.push(
          `${i + 1}. ${money(w.value)} — ${d?.account ? displayAccountName(d.account.name) : (d?.name ?? "deal")}${d ? `, ${describe(d)}` : ""}${!owner && d ? ` (${names.get(d.owner_id) ?? "a colleague"})` : ""}, won ${w.wonAt.slice(0, 10)}`,
        );
      });
    }
    const recent = s.curve.slice(-8);
    out.push(`Closed revenue, cumulative, by week: ${recent.map((p) => `${p.week} ${money(p.total)}`).join("; ")}`);
  }
  out.push(`Open quotes (${open.length}):`);
  for (const d of open.slice(0, 50)) {
    out.push(
      `- ${d.account ? displayAccountName(d.account.name) : d.name}: ${describe(d) || "no product named"}, ${money(d.estimated_revenue)} — ${quoteStageLabel(d.stage)}${d.current_status ? `; ${d.current_status}` : ""}${!owner ? ` (${names.get(d.owner_id) ?? "a colleague"})` : ""}. id ${d.id}, updated_at ${d.updated_at}`,
    );
  }
  if (open.length > 50) out.push(`…and ${open.length - 50} more.`);

  return ok(out.join("\n"), {
    scope: owner ? { owner_id: owner, name: who } : "team",
    closed_revenue: s.closed,
    won: s.wonCount,
    active_pipeline: s.pipeline,
    open: s.openCount,
    win_rate: s.winRate,
    decided: s.decided,
    quotes_sent: s.quotesSent,
    average_ticket: s.avgTicket,
    curve: s.curve,
    top_wins: s.topWins,
    open_quotes: open.slice(0, 50).map((d) => ({
      id: d.id,
      updated_at: d.updated_at,
      name: d.name,
      account: d.account?.name ?? null,
      stage: d.stage,
      estimated_revenue: d.estimated_revenue,
      product: quoteProduct(d, lines.get(d.id) ?? []),
      current_status: d.current_status,
      owner: names.get(d.owner_id) ?? null,
    })),
  });
}

// ---- registration ---------------------------------------------------------

const writeNote =
  " This writes immediately. Do not guess: ask the person for anything missing. When you finish, tell them in a short list what you recorded.";

const stageNote =
  "QUOTE = priced and sent, no answer yet; DECISION = they are deciding; WON = they bought; LOST = they said no; ON_HOLD = parked.";

export function registerQuoteTools(server: McpServer, getCtx: GetCtx) {
  server.registerTool(
    "search_catalog",
    {
      title: "Search the product catalog",
      description:
        "Search GMX's live product catalog (the same search as the app's quote form): up to 25 products with sku, description, species, size, LF per piece, whether it is random length (quoted in LF only) and availability. Short searches work best: the species and the size, e.g. 'ayous 1x6' or 'thermo ash 5/4x6'. favorite opens one of the reps' usual families: " +
        CATALOG_FAVORITES.map((f) => `${f.id} (${f.label})`).join(", ") +
        ". Use it to find the sku of every product before create_quote; if several fit, ask the person which one. Read-only.",
      inputSchema: z.object({
        query: z.string().optional().describe("Species and size, e.g. 'ayous 1x6 v-joint'"),
        favorite: z.string().optional().describe("One of the favourite ids, instead of a query"),
      }),
    },
    tool<SearchCatalogArgs>(getCtx, (ctx, a) => searchCatalogTool(ctx, a)),
  );

  server.registerTool(
    "create_quote",
    {
      title: "Open a quote",
      description:
        "Record a quote the person priced for an account. Look the account up with find first; never guess an id. Products go in lines, one per product: the sku (from search_catalog — never invent or guess one), the quantity, its unit (LF or PC, as the person said it; random-length products are LF only) and the price per LF when the person gave it. When the person already has the list (an email, a spreadsheet, a message), send it all in one call: the server checks every sku against the catalog, converts pieces to LF by the catalog's own LF per piece, and saves nothing if any sku is unknown. The value is the sum of LF × price over the priced lines, unless value (the total) is given; never invent a price. status is where it stands, in the person's words. Every open quote gets a follow-up: by default 'Follow up on the <product> quote' at the quote follow-up deadline; pass follow_up / follow_up_date when the person said what or when. The quote is the person's own unless owner_id names the rep it belongs to: only an admin or an assistant records a quote in a colleague's name (look the rep up with find), and that needs the person's yes first — the quote and its follow-up then belong to that rep. It counts on the Reps board's 'Quotes on the platform' for its owner." +
        writeNote,
      inputSchema: z.object({
        account_id: dbId(),
        lines: z
          .array(
            z.object({
              sku: z.string().min(1).describe("A sku returned by search_catalog"),
              quantity: z.number().positive(),
              unit: z.enum(["LF", "PC"]).describe("Linear feet or pieces, as the person said it"),
              price_per_lf: z.number().nonnegative().optional().describe("USD per LF, when the person gave it"),
            }),
          )
          .max(40)
          .optional(),
        product: z.string().min(1).optional().describe("Only when the server says no catalog is connected: the product in words"),
        quantity_lf: z.number().positive().optional().describe("Only with product"),
        price_per_lf: z.number().nonnegative().optional().describe("Only with product"),
        value: z.number().nonnegative().optional().describe("The quote's total in USD; wins over the lines' arithmetic"),
        status: z.string().min(1).describe("Where it stands, in a short line"),
        stage: z.enum(["QUOTE", "DECISION"]).optional().describe("Default QUOTE. " + stageNote),
        contact_id: dbId().optional().describe("Who the quote is for: a contact of the account, from find"),
        follow_up: z.string().min(1).optional().describe("The next step, if the person said one"),
        follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only when the person said a date"),
        owner_id: dbId().optional().describe("The rep the quote belongs to (membership id from find); default the person. Admins and assistants only"),
        confirmation: z.string().optional().describe("Only the code this tool gave you, after the person said yes"),
      }),
    },
    tool<CreateQuoteArgs>(getCtx, (ctx, a) => createQuote(ctx, a)),
  );

  server.registerTool(
    "update_quote",
    {
      title: "Move or change a quote",
      description:
        "Move a quote to its next stage (" +
        stageNote +
        ") or change its value, product, LF or where it stands. Read it first with quote_summary or get_account and pass its id and updated_at; if it changed meanwhile you are told to read again. For a lost quote give reason (why they said no). Moving a quote back to an open stage plans a follow-up if it has none. After WON or LOST the tool lists follow-ups still open on it: ask the person whether to close them. owner_id hands the quote to another rep (admins and assistants only, as in the app); its open follow-ups move with it. Changing a colleague's quote or handing one over needs the person's yes first." +
        writeNote,
      inputSchema: z.object({
        id: dbId(),
        updated_at: z.string().describe("The updated_at you read"),
        stage: z.enum(QUOTE_WALK).optional(),
        status: z.string().min(1).optional().describe("Where it stands now, in a short line"),
        value: z.number().nonnegative().optional().describe("The new total in USD"),
        product: z.string().min(1).optional(),
        quantity_lf: z.number().positive().optional(),
        price_per_lf: z.number().nonnegative().optional().describe("Recomputes the value as LF × price"),
        reason: z.string().optional().describe("Why it was lost or is on hold"),
        owner_id: dbId().optional().describe("Hand the quote to this rep (membership id from find). Admins and assistants only"),
        confirmation: z.string().optional().describe("Only the code this tool gave you, after the person said yes"),
      }),
    },
    tool<UpdateQuoteArgs>(getCtx, (ctx, a) => updateQuote(ctx, a)),
  );

  server.registerTool(
    "quote_summary",
    {
      title: "Quotes on the platform",
      description:
        "The Reps board's quote scoreboard, for the whole team or one rep (owner_id, a person's membership id from find): closed revenue, active pipeline, win rate, quotes sent, average ticket, the biggest wins, the weekly cumulative curve, and the open quotes with their id and updated_at (for update_quote). A rep sees only their own quotes; an admin sees everyone's. Read-only.",
      inputSchema: z.object({
        owner_id: dbId().optional().describe("A rep's membership id from find; default the whole team you can see"),
      }),
    },
    tool<QuoteSummaryArgs>(getCtx, (ctx, a) => quoteSummaryTool(ctx, a)),
  );
}
