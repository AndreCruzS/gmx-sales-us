"use client";

// Account page (spec §12): the complete relationship view for one branch.
//
// Everything a rep needs at the door, in the order they need it: who this is,
// who the champion is (D50), whether the display wall is due a check (D52),
// what happened last, what's owed next, and how this account connects to the
// rest of the market (D4). Distributors and dealers additionally get the
// commercial network — the downstream demand attached to the channel.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DealStageSheet } from "@/components/deal-stage-sheet";
import { useOffline } from "@/components/offline-provider";
import { CalendarIcon, CheckIcon, ChevronRightIcon } from "@/components/icons";
import {
  CHAIN_HEADING,
  CHAIN_ORDER,
  chainPosition,
  resolvePosition,
  type ChainPosition,
} from "@/lib/domain/chain";
import { ACCOUNT_TYPES, humanize, type AccountType } from "@/lib/domain/enums";
import {
  displayAccountName,
  formatDay,
  formatPhone,
  telHref,
} from "@/lib/format";
import { getOfflineLayer, type CachedAccount } from "@/lib/offline";
import { type RelationshipType } from "@/lib/domain/enums";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Account {
  id: string;
  name: string;
  account_type: string;
  city: string | null;
  state: string | null;
  website: string | null;
  strategic_importance: string | null;
  relationship_status: string | null;
  has_display_wall: boolean;
  display_last_verified_at: string | null;
  parent_account_id: string | null;
  lead_source: string;
  // baseVersion for the edit sheet's LWW guard (D61). Optional because the
  // offline cache predates it — with no version there is no edit offline,
  // which is honest: a guard you cannot check is not a guard.
  updated_at?: string;
}
interface Contact {
  id: string;
  name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  influence_level: string | null;
  is_champion: boolean;
}
interface Activity {
  id: string;
  activity_type: string;
  occurred_at: string;
  what_happened: string | null;
  key_information: string | null;
}
interface NextAction {
  id: string;
  action: string;
  due_date: string;
  objective: string | null;
  // Needed to derive hasOpenAction (Rule 3, Task 6) for the stage sheet —
  // null for actions not tied to a deal.
  opportunity_id: string | null;
}
interface Opportunity {
  id: string;
  name: string;
  stage: string;
  estimated_revenue: number | null;
  current_status: string | null;
  updated_at: string;
  primary_account_id: string;
}
interface Relationship {
  id: string;
  relationship_type: string;
  account_a_id: string;
  account_b_id: string;
  a: { name: string; account_type: string } | null;
  b: { name: string; account_type: string } | null;
}
interface EmailThread {
  id: string;
  subject: string | null;
  last_message_at: string | null;
  last_direction: "INBOUND" | "OUTBOUND" | null;
}

function monthsSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24 * 30));
}

export default function AccountPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useOffline();
  const [account, setAccount] = useState<Account | null>(null);
  const [parentName, setParentName] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [actions, setActions] = useState<NextAction[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stageSheetOpp, setStageSheetOpp] = useState<Opportunity | null>(
    null,
  );
  // The hierarchy, linked by hand (Andre, 2026-09-02): "nem sempre sabemos
  // de quem a empresa compra" — when a rep learns it, one form records it.
  // The sell-through trigger records the same fact automatically when a
  // spreadsheet proves it; both land on account_relationships, one truth.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkType, setLinkType] = useState<RelationshipType>("PURCHASES_FROM");
  const [linkAccountId, setLinkAccountId] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [cachedAccounts, setCachedAccounts] = useState<CachedAccount[]>([]);
  useEffect(() => {
    if (!profile) return;
    void getOfflineLayer().local.getAccounts().then(setCachedAccounts);
  }, [profile]);

  // The account's own orders — GMX's sell-in to this door, from the synced
  // order book (orders_mirror), reached through the customer link table.
  const [orderSummary, setOrderSummary] = useState<{
    count: number;
    value: number;
    open: number;
  } | null>(null);
  useEffect(() => {
    if (!profile || !id) return;
    let stale = false;
    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: linkRows } = await supabase
          .from("order_customer_links")
          .select("customer_id")
          .eq("account_id", id);
        const customerIds = (linkRows ?? []).map(
          (l) => (l as { customer_id: string }).customer_id,
        );
        if (customerIds.length === 0) return;
        const { data: orderRows } = await supabase
          .from("orders_mirror")
          .select("total_value, status, archived_at")
          .in("customer_id", customerIds);
        if (stale || !orderRows) return;
        const live = (
          orderRows as {
            total_value: number | null;
            status: string;
            archived_at: string | null;
          }[]
        ).filter((o) => !o.archived_at);
        setOrderSummary({
          count: live.length,
          value: live.reduce((n, o) => n + (Number(o.total_value) || 0), 0),
          open: live.filter((o) => o.status !== "Completed").length,
        });
      } catch {
        // no signal — the section simply doesn't render
      }
    })();
    return () => {
      stale = true;
    };
  }, [profile, id]);

  // The identity edit (Andre, 2026-09-02): the fields a person corrects —
  // name, kind of door, city. Ownership and history stay what they are.
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<AccountType>("DEALER");
  const [editCity, setEditCity] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  // No signal: serve the account from the cached working set so the rep still
  // sees the account in front of them (D56).
  const loadFromCache = useCallback(async () => {
    const layer = getOfflineLayer();
    const [accounts, cachedContacts, acts, agenda] = await Promise.all([
      layer.local.getAccounts(),
      layer.local.getContacts(id),
      layer.local.getRecentActivities(),
      layer.local.getAgenda(),
    ]);
    const cached = accounts.find((a) => a.id === id);
    if (cached) {
      setAccount({
        ...cached,
        state: null,
        website: null,
        strategic_importance: null,
        relationship_status: null,
        lead_source: "",
      } as Account);
      // Champion first already (D50) — who you ask for at the counter.
      setContacts(
        cachedContacts.map((c) => ({ ...c, influence_level: null })),
      );
      setActivities(
        acts
          .filter((a) => a.primary_account_id === id)
          .map((a) => ({
            id: a.id,
            activity_type: a.activity_type,
            occurred_at: a.occurred_at,
            what_happened: a.what_happened,
            key_information: null,
          })),
      );
      setActions(
        agenda
          .filter((i) => i.account_id === id && !i.completed_at)
          .map((i) => ({
            id: i.id,
            action: i.action,
            due_date: i.due_date,
            objective: i.objective,
            opportunity_id: i.opportunity_id,
          })),
      );
    }
    setOffline(true);
  }, [id]);

  const load = useCallback(async () => {
    // Offline, fetch REJECTS rather than returning an error response — so the
    // whole load has to be guarded, or the page renders nothing at all.
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: acc, error } = await supabase
        .from("accounts")
        .select(
          "id, name, account_type, city, state, website, strategic_importance, relationship_status, has_display_wall, display_last_verified_at, parent_account_id, lead_source, updated_at",
        )
        .eq("id", id)
        .single();

      if (error || !acc) {
        await loadFromCache();
        return;
      }

      setAccount(acc as Account);
      setOffline(false);

      const [c, act, na, opp, rel, parent] = await Promise.all([
        supabase
          .from("contacts")
          .select(
            "id, name, job_title, email, phone, influence_level, is_champion",
          )
          .eq("account_id", id)
          .order("is_champion", { ascending: false }),
        supabase
          .from("activities")
          .select(
            "id, activity_type, occurred_at, what_happened, key_information",
          )
          .eq("primary_account_id", id)
          .order("occurred_at", { ascending: false })
          .limit(10),
        supabase
          .from("next_actions")
          .select("id, action, due_date, objective, opportunity_id")
          .eq("account_id", id)
          .is("completed_at", null)
          .order("due_date"),
        supabase
          .from("opportunities")
          .select(
            "id, name, stage, estimated_revenue, current_status, updated_at, primary_account_id",
          )
          .eq("primary_account_id", id)
          .order("updated_at", { ascending: false }),
        supabase
          .from("account_relationships")
          .select(
            "id, relationship_type, account_a_id, account_b_id, a:accounts!account_relationships_account_a_id_fkey(name, account_type), b:accounts!account_relationships_account_b_id_fkey(name, account_type)",
          )
          .or(`account_a_id.eq.${id},account_b_id.eq.${id}`),
        (acc as Account).parent_account_id
          ? supabase
              .from("accounts")
              .select("name")
              .eq("id", (acc as Account).parent_account_id!)
              .single()
          : Promise.resolve({ data: null }),
      ]);

      setContacts((c.data as Contact[]) ?? []);
      setActivities((act.data as Activity[]) ?? []);
      setActions((na.data as NextAction[]) ?? []);
      setOpportunities((opp.data as Opportunity[]) ?? []);
      setRelationships((rel.data as unknown as Relationship[]) ?? []);
      setParentName((parent.data as { name: string } | null)?.name ?? null);

      // Email threads matched to this account (D35). RLS scopes to visible
      // mailboxes; the section stays empty until the Gmail sync is connected.
      const th = await supabase
        .from("email_threads")
        .select("id, subject, last_message_at, last_direction")
        .eq("matched_account_id", id)
        .order("last_message_at", { ascending: false })
        .limit(10);
      setThreads((th.data as EmailThread[]) ?? []);
    } catch {
      await loadFromCache();
    } finally {
      // always resolve the loading state, or the screen stays blank forever
      setLoaded(true);
    }
  }, [id, loadFromCache]);

  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [profile, load]);

  // Collapse the relationship rows into one entry per counterpart, phrased in
  // the direction it is stored — inverting "purchases from" into "supplies to"
  // would be guessing at semantics the data doesn't carry.
  const network = useMemo(() => {
    const byAccount = new Map<
      string,
      {
        id: string;
        name: string;
        type: string;
        phrases: string[];
        positions: ChainPosition[];
      }
    >();
    for (const r of relationships) {
      if (!account) break;
      const isA = r.account_a_id === account.id;
      const other = isA ? r.b : r.a;
      const otherId = isA ? r.account_b_id : r.account_a_id;
      if (!other) continue;
      const entry = byAccount.get(otherId) ?? {
        id: otherId,
        name: other.name,
        type: other.account_type,
        phrases: [],
        positions: [],
      };
      // the row title is already the counterpart, so the phrase never repeats it
      entry.phrases.push(
        isA
          ? `This account ${humanize(r.relationship_type).toLowerCase()} them`
          : `${humanize(r.relationship_type)} this account`,
      );
      entry.positions.push(chainPosition(r.relationship_type, isA));
      byAccount.set(otherId, entry);
    }
    return [...byAccount.values()].map((e) => ({
      ...e,
      position: resolvePosition(e.positions),
    }));
  }, [relationships, account]);

  // Grouped so the section reads down the channel — who supplies this account,
  // who sits alongside it, and where the demand is. A flat list of names cannot
  // show that a branch and its banner run through different distributors.
  const networkByPosition = useMemo(
    () =>
      CHAIN_ORDER.map((position) => ({
        position,
        heading: CHAIN_HEADING[position],
        entries: network.filter((n) => n.position === position),
      })).filter((g) => g.entries.length > 0),
    [network],
  );

  if (loaded && !account) {
    return (
      <p className="t-sub px-1 pt-4">
        That account isn&apos;t in your scope, or it hasn&apos;t reached this
        device yet.
      </p>
    );
  }
  if (!account) return null;

  const displayMonths = monthsSince(account.display_last_verified_at);
  const champion = contacts.find((c) => c.is_champion);

  return (
    <div className="stack pt-1">
      {/* Identity */}
      <section>
        {editing ? (
          <form
            className="card card-pad flex flex-col gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!account.updated_at) return;
              if (!editName.trim()) {
                setEditError("The account needs a name.");
                return;
              }
              setEditBusy(true);
              setEditError(null);
              try {
                const layer = getOfflineLayer();
                // D61: lands only if the row hasn't moved since it was read.
                await layer.sync.enqueue({
                  clientId: account.id,
                  entityType: "account",
                  op: "update",
                  payload: {
                    id: account.id,
                    name: editName.trim(),
                    account_type: editType,
                    city: editCity.trim() || null,
                  },
                  baseVersion: account.updated_at,
                  blobRef: null,
                });
                setAccount({
                  ...account,
                  name: editName.trim(),
                  account_type: editType,
                  city: editCity.trim() || null,
                });
                setEditing(false);
                void layer.sync.drain();
              } catch (err) {
                setEditError(
                  err instanceof Error ? err.message : String(err),
                );
              } finally {
                setEditBusy(false);
              }
            }}
          >
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="field"
              placeholder="Account name"
              aria-label="Account name"
            />
            <select
              value={editType}
              onChange={(e) => setEditType(e.target.value as AccountType)}
              className="field"
              aria-label="Account type"
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
            <input
              value={editCity}
              onChange={(e) => setEditCity(e.target.value)}
              className="field"
              placeholder="City (optional)"
              aria-label="City"
            />
            {editError && (
              <p className="t-sub" style={{ color: "var(--danger)" }}>
                {editError}
              </p>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={editBusy} className="btn-primary">
                Save
              </button>
              <button
                type="button"
                className="btn-quiet"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">
                {displayAccountName(account.name)}
              </h1>
              {/* Editing needs the row's version for the LWW guard, and the
                  cache may not carry one — no version, no edit, honestly. */}
              {account.updated_at && (
                <button
                  type="button"
                  className="btn-quiet shrink-0"
                  onClick={() => {
                    setEditName(account.name);
                    setEditType(account.account_type as AccountType);
                    setEditCity(account.city ?? "");
                    setEditError(null);
                    setEditing(true);
                  }}
                >
                  Edit
                </button>
              )}
            </div>
            <p className="t-sub mt-1">
              {humanize(account.account_type)}
              {account.city ? ` · ${account.city}` : ""}
              {account.state ? `, ${account.state}` : ""}
            </p>
          </>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {account.strategic_importance === "STRATEGIC" && (
            <span className="tag tag-solid">Strategic</span>
          )}
          {account.relationship_status && (
            <span className="tag">{humanize(account.relationship_status)}</span>
          )}
          {parentName && (
            <Link
              href={`/accounts/${account.parent_account_id}`}
              className="tag tag-accent"
            >
              Part of {parentName}
            </Link>
          )}
          {account.has_display_wall && (
            <span
              className={
                displayMonths === null || displayMonths >= 6
                  ? "tag tag-danger"
                  : "tag tag-success"
              }
            >
              {displayMonths === null
                ? "Display never checked"
                : `Display checked ${displayMonths}mo ago`}
            </span>
          )}
        </div>

        {offline && (
          <p className="t-hint mt-3">
            Offline — showing what&apos;s cached on this device.
          </p>
        )}

        <Link href={`/record?account=${id}`} className="btn-primary mt-4">
          Log a visit here
        </Link>
      </section>

      {/* Champion first — the elected internal advocate (D50) */}
      {contacts.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Contacts</h2>
            <span className="t-meta">{contacts.length}</span>
          </div>
          <ul className="list">
            {contacts.map((c) => (
              <li key={c.id} className="row">
                <span className="row-lead">
                  {c.name
                    .split(" ")
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join("")}
                </span>
                <span className="row-body">
                  <span className="flex items-center gap-2">
                    <span className="t-title truncate">{c.name}</span>
                    {c.is_champion && (
                      <span className="tag tag-accent">Champion</span>
                    )}
                  </span>
                  <span className="t-sub block truncate">
                    {c.job_title ?? "Contact"}
                  </span>
                  {/* reaching this person is the point — actions, not text */}
                  {(c.phone || c.email) && (
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {c.phone && (
                        <a href={telHref(c.phone)} className="tag tag-accent">
                          Call {formatPhone(c.phone)}
                        </a>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="tag">
                          Email
                        </a>
                      )}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {account.strategic_importance === "STRATEGIC" &&
        !champion &&
        !offline && (
          <p className="card card-pad t-sub" style={{ color: "var(--danger)" }}>
            Strategic account with no elected champion — pick one on your next
            visit.
          </p>
        )}

      {/* What's owed */}
      {actions.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">What&apos;s owed here</h2>
            <Link href="/visits" className="t-action">
              Visits
            </Link>
          </div>
          <ul className="list">
            {actions.map((a) => (
              <li key={a.id} className="row">
                <span className="row-lead">
                  <CalendarIcon size={18} />
                </span>
                <span className="row-body">
                  <span className="t-title block truncate">{a.action}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="t-meta">Due {formatDay(a.due_date)}</span>
                    {a.objective && (
                      <span className="tag tag-accent">
                        {a.objective.replaceAll("_", " ")}
                      </span>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Pipeline on this account — the section stays visible even with no
          deals yet, or the only door to /new-deal would be unreachable. */}
      <section>
        <div className="section-head">
          <h2 className="t-section">Opportunities</h2>
          <Link href={`/accounts/${account.id}/new-deal`} className="t-action">
            New deal
          </Link>
        </div>
        {opportunities.length === 0 ? (
          <p className="t-sub px-1">No deals yet.</p>
        ) : (
          <ul className="list">
            {opportunities.map((o) => (
              <li key={o.id} className="row">
                <span className="row-body">
                  <span className="flex items-center gap-2">
                    <span className="t-title truncate">{o.name}</span>
                    {/* Opens the stage sheet (Task 6) — the pill is the door
                        to advancing the deal, not just a status readout. */}
                    <button
                      type="button"
                      className="tag"
                      onClick={() => setStageSheetOpp(o)}
                    >
                      {humanize(o.stage)}
                    </button>
                  </span>
                  <span className="t-sub block truncate">
                    {o.estimated_revenue
                      ? new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 0,
                        }).format(Number(o.estimated_revenue))
                      : "no value set"}
                    {o.current_status ? ` · ${o.current_status}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* GMX's sell-in to this door — the synced order book, one line and a
          door to the full list. Rendered only when the account is linked to
          an order customer and something has synced. */}
      {orderSummary && orderSummary.count > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Orders</h2>
            <Link href={`/orders?account=${id}`} className="t-action">
              All of them
            </Link>
          </div>
          <p className="t-sub px-1">
            {orderSummary.count} {orderSummary.count === 1 ? "order" : "orders"}{" "}
            ·{" "}
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 0,
            }).format(orderSummary.value)}
            {orderSummary.open > 0
              ? ` · ${orderSummary.open} still moving`
              : " · none open"}
          </p>
        </section>
      )}

      {/* The commercial network (D4) — how this account connects to the market.
          One row per counterpart: a contractor that both buys here AND was
          referred here is one relationship in the rep's head, not two.
          Always rendered, even empty — "nem sempre sabemos de cara" (Andre,
          2026-09-02), and the door to say so the day you learn it must exist
          before there is anything to list. A link a spreadsheet later proves
          lands here too, by the sell-through trigger. */}
      <section>
          <div className="section-head">
            <h2 className="t-section">Commercial network</h2>
            <button
              type="button"
              className="t-action"
              onClick={() => {
                setLinkError(null);
                setLinkOpen((v) => !v);
              }}
            >
              {linkOpen ? "Close" : "Add a connection"}
            </button>
          </div>

          {linkOpen && (
            <form
              className="card card-pad mb-2 flex flex-col gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!profile) return;
                if (!linkAccountId) {
                  setLinkError("Pick the other company.");
                  return;
                }
                setLinkBusy(true);
                setLinkError(null);
                try {
                  const layer = getOfflineLayer();
                  const relId = crypto.randomUUID();
                  await layer.sync.enqueue({
                    clientId: relId,
                    entityType: "account_relationship",
                    op: "create",
                    payload: {
                      id: relId,
                      org_id: profile.orgId,
                      account_a_id: account.id,
                      relationship_type: linkType,
                      account_b_id: linkAccountId,
                      created_by: profile.membershipId,
                    },
                    baseVersion: null,
                    blobRef: null,
                  });
                  const other = cachedAccounts.find(
                    (a) => a.id === linkAccountId,
                  );
                  setRelationships((prev) => [
                    ...prev,
                    {
                      id: relId,
                      relationship_type: linkType,
                      account_a_id: account.id,
                      account_b_id: linkAccountId,
                      a: { name: account.name, account_type: account.account_type },
                      b: other
                        ? { name: other.name, account_type: other.account_type }
                        : null,
                    },
                  ]);
                  setLinkOpen(false);
                  setLinkAccountId("");
                  setLinkQuery("");
                  void layer.sync.drain();
                } catch (err) {
                  setLinkError(
                    err instanceof Error ? err.message : String(err),
                  );
                } finally {
                  setLinkBusy(false);
                }
              }}
            >
              <select
                value={linkType}
                onChange={(e) =>
                  setLinkType(e.target.value as RelationshipType)
                }
                className="field"
                aria-label="How they connect"
              >
                {/* The trade's four everyday links; the rarer ones can join
                    when somebody needs them. */}
                <option value="PURCHASES_FROM">This account buys from…</option>
                <option value="SUPPLIES">This account supplies…</option>
                <option value="WORKS_WITH">Works with…</option>
                <option value="REFERRED_BY">Was referred by…</option>
              </select>
              {linkAccountId ? (
                <div className="row" style={{ padding: 0 }}>
                  <span className="row-body">
                    <span className="t-title block truncate">
                      {cachedAccounts.find((a) => a.id === linkAccountId)
                        ?.name ?? "—"}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn-quiet shrink-0"
                    onClick={() => setLinkAccountId("")}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <input
                    autoFocus
                    placeholder="Find the other company"
                    value={linkQuery}
                    onChange={(e) => setLinkQuery(e.target.value)}
                    className="field"
                    style={{ borderRadius: 0, border: 0 }}
                  />
                  <ul>
                    {cachedAccounts
                      .filter(
                        (a) =>
                          a.id !== account.id &&
                          (!linkQuery.trim() ||
                            a.name
                              .toLowerCase()
                              .includes(linkQuery.trim().toLowerCase())),
                      )
                      .slice(0, 6)
                      .map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setLinkAccountId(a.id);
                              setLinkQuery("");
                            }}
                            className="flex w-full items-baseline gap-2 px-4 py-3 text-left"
                            style={{ borderTop: "1px solid var(--rule)" }}
                          >
                            <span className="t-title">{a.name}</span>
                            <span className="t-hint">
                              {humanize(a.account_type)}
                              {a.city ? ` · ${a.city}` : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              {linkError && (
                <p className="t-sub" style={{ color: "var(--danger)" }}>
                  {linkError}
                </p>
              )}
              <button
                type="submit"
                disabled={linkBusy}
                className="btn-primary mt-1"
              >
                Link them
              </button>
            </form>
          )}

          {network.length === 0 && !linkOpen && (
            <p className="t-sub px-1">
              No connections on file yet. Who do they buy from? Link it the
              day you learn it — a sell-through file that proves a link adds
              it here on its own.
            </p>
          )}
          {networkByPosition.map((group) => (
            <div key={group.position}>
              {/* The heading only earns its place when there is more than one
                  side to tell apart. */}
              {networkByPosition.length > 1 && (
                <p className="t-hint px-1 pt-1">{group.heading}</p>
              )}
              <ul className="list">
                {group.entries.map((n) => (
                  <li key={n.id}>
                    <Link href={`/accounts/${n.id}`} className="row">
                      <span
                        className="row-lead"
                        style={{ fontSize: 10, fontWeight: 700 }}
                      >
                        {n.type.slice(0, 3)}
                      </span>
                      <span className="row-body">
                        <span className="t-title block truncate">{n.name}</span>
                        <span className="t-sub block">
                          {n.phrases.join(" · ")}
                        </span>
                      </span>
                      <ChevronRightIcon
                        size={14}
                        style={{ color: "var(--ink-muted)" }}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </section>

      {/* Account history — built from activities, never separately maintained */}
      <section>
        <div className="section-head">
          <h2 className="t-section">History</h2>
          <span className="t-meta">{activities.length}</span>
        </div>
        {activities.length === 0 ? (
          <p className="t-sub px-1">
            Nothing recorded here yet. The first visit you log starts this
            account&apos;s history.
          </p>
        ) : (
          <ul className="list">
            {activities.map((a) => (
              <li key={a.id} className="row">
                <span className="row-lead flex-col leading-none">
                  <span className="text-[15px] font-bold">
                    {new Date(a.occurred_at).getDate()}
                  </span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">
                    {new Date(a.occurred_at).toLocaleString("en-US", {
                      month: "short",
                    })}
                  </span>
                </span>
                <span className="row-body">
                  <span className="t-title block">
                    {humanize(a.activity_type)}
                  </span>
                  {a.what_happened && (
                    <span className="t-sub block">{a.what_happened}</span>
                  )}
                  {a.key_information && (
                    <span className="t-hint mt-1 flex items-start gap-1.5">
                      <CheckIcon size={12} style={{ marginTop: 2 }} />
                      {a.key_information}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Email — threads where a contact of this account participates (D35).
          Rendered only when the sync has produced something. */}
      {threads.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Email</h2>
            <span className="t-meta">{threads.length}</span>
          </div>
          <ul className="list">
            {threads.map((t) => (
              <li key={t.id} className="row">
                {/* the lead slot always renders — rows must share a left edge */}
                {t.last_message_at ? (
                  <span className="row-lead flex-col leading-none">
                    <span className="text-[15px] font-bold">
                      {new Date(t.last_message_at).getDate()}
                    </span>
                    <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">
                      {new Date(t.last_message_at).toLocaleString("en-US", {
                        month: "short",
                      })}
                    </span>
                  </span>
                ) : (
                  <span className="row-lead">@</span>
                )}
                <span className="row-body">
                  <span className="t-title line-clamp-1 block">
                    {t.subject ?? "No subject"}
                  </span>
                  <span className="t-sub block">
                    {t.last_direction === "INBOUND"
                      ? "Their message is the latest — reply may be owed"
                      : "You wrote last"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stageSheetOpp && (
        <DealStageSheet
          opportunity={stageSheetOpp}
          hasOpenAction={actions.some(
            (n) => n.opportunity_id === stageSheetOpp.id,
          )}
          onClose={() => {
            setStageSheetOpp(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
