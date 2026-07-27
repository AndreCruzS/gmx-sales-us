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
import { useOffline } from "@/components/offline-provider";
import { CalendarIcon, CheckIcon, ChevronRightIcon } from "@/components/icons";
import { humanize } from "@/lib/domain/enums";
import { getOfflineLayer } from "@/lib/offline";
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
}
interface Opportunity {
  id: string;
  name: string;
  stage: string;
  estimated_revenue: number | null;
  current_status: string | null;
}
interface Relationship {
  id: string;
  relationship_type: string;
  account_a_id: string;
  account_b_id: string;
  a: { name: string; account_type: string } | null;
  b: { name: string; account_type: string } | null;
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
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // No signal: serve the account from the cached working set so the rep still
  // sees the account in front of them (D56).
  const loadFromCache = useCallback(async () => {
    const layer = getOfflineLayer();
    const [accounts, acts, agenda] = await Promise.all([
      layer.local.getAccounts(),
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
          "id, name, account_type, city, state, website, strategic_importance, relationship_status, has_display_wall, display_last_verified_at, parent_account_id, lead_source",
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
          .select("id, action, due_date, objective")
          .eq("account_id", id)
          .is("completed_at", null)
          .order("due_date"),
        supabase
          .from("opportunities")
          .select("id, name, stage, estimated_revenue, current_status")
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
      { id: string; name: string; type: string; phrases: string[] }
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
      };
      // the row title is already the counterpart, so the phrase never repeats it
      entry.phrases.push(
        isA
          ? `This account ${humanize(r.relationship_type).toLowerCase()} them`
          : `${humanize(r.relationship_type)} this account`,
      );
      byAccount.set(otherId, entry);
    }
    return [...byAccount.values()];
  }, [relationships, account]);

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
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">
          {account.name}
        </h1>
        <p className="t-sub mt-1">
          {humanize(account.account_type)}
          {account.city ? ` · ${account.city}` : ""}
          {account.state ? `, ${account.state}` : ""}
        </p>

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
          <p className="t-meta mt-3">
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
                    {c.job_title ?? "—"}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </span>
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
            <Link href="/" className="t-action">
              Today
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
                    <span className="t-meta">{a.due_date}</span>
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

      {/* Pipeline on this account */}
      {opportunities.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Opportunities</h2>
            <span className="t-meta">{opportunities.length}</span>
          </div>
          <ul className="list">
            {opportunities.map((o) => (
              <li key={o.id} className="row">
                <span className="row-body">
                  <span className="flex items-center gap-2">
                    <span className="t-title truncate">{o.name}</span>
                    <span className="tag">{humanize(o.stage)}</span>
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
        </section>
      )}

      {/* The commercial network (D4) — how this account connects to the market.
          One row per counterpart: a contractor that both buys here AND was
          referred here is one relationship in the rep's head, not two. */}
      {network.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Commercial network</h2>
            <span className="t-meta">{network.length}</span>
          </div>
          <ul className="list">
            {network.map((n) => (
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
                    <span className="t-sub block">{n.phrases.join(" · ")}</span>
                  </span>
                  <ChevronRightIcon
                    size={14}
                    style={{ color: "var(--ink-muted)" }}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                    <span className="t-meta mt-1 flex items-start gap-1.5">
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
    </div>
  );
}
