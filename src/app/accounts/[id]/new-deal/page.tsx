"use client";

// New-deal form (Task 5, hubspot-sync-bridge): the account page's "New deal"
// link lands here. One outbox op — entityType "opportunity", op "create" —
// carries the deal AND its required first next action in the same payload
// (opportunityCreateSchema, Task 4), because the stage gate demands an open
// next_action for every non-terminal deal and the backend replays both
// through create_opportunity_with_action in one transaction. That's also why
// this form, unlike accounts/new's multi-op fan-out, needs no compensation
// loop on failure: one enqueue either validates and queues, or throws before
// anything is written.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useOffline } from "@/components/offline-provider";
import {
  LEAD_SOURCES_ALL,
  OPPORTUNITY_STAGES,
  REFERRAL_LEAD_SOURCES,
  humanize,
  type LeadSource,
  type OpportunityStage,
} from "@/lib/domain/enums";
import { getOfflineLayer, type CachedAccount } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// A deal is never born closed — WON/LOST are outcomes a rep records later,
// not a starting stage.
const DEAL_STAGES = OPPORTUNITY_STAGES.filter(
  (s) => s !== "WON" && s !== "LOST",
);

// Mirrors opportunityCreateSchema.first_action.kind (src/lib/domain/schemas.ts)
// — DISPLAY_CHECK is deliberately excluded there too, since it's only ever
// derived from an account, never created directly.
const ACTION_KINDS = ["SAMPLE_FOLLOW_UP", "QUOTE_FOLLOW_UP", "VISIT", "OTHER"] as const;
type ActionKind = (typeof ACTION_KINDS)[number];

interface AccountLite {
  id: string;
  name: string;
  territory_id: string;
}

export default function NewDealPage() {
  const { id: accountId } = useParams<{ id: string }>();
  const { profile } = useOffline();
  const router = useRouter();

  const [account, setAccount] = useState<AccountLite | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [name, setName] = useState("");
  const [stage, setStage] = useState<OpportunityStage>("IDENTIFIED");
  const [revenue, setRevenue] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const [currentStatus, setCurrentStatus] = useState("");
  const [leadSource, setLeadSource] = useState<LeadSource | "">("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [referringAccountId, setReferringAccountId] = useState("");
  const [referringQuery, setReferringQuery] = useState("");
  const [pickingReferring, setPickingReferring] = useState(false);
  const [actionText, setActionText] = useState("");
  const [actionDue, setActionDue] = useState("");
  const [actionKind, setActionKind] = useState<ActionKind>("VISIT");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Same shape as the account page's own load(): try the live row, and if the
  // fetch rejects (offline) fall back to what's already cached on this
  // device — a rep opening this from a just-viewed account has it either way.
  const loadAccount = useCallback(async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: fetchError } = await supabase
        .from("accounts")
        .select("id, name, territory_id")
        .eq("id", accountId)
        .single();
      if (!fetchError && data) {
        setAccount(data as AccountLite);
        return;
      }
    } catch {
      // offline: fetch rejects rather than erroring — fall through to cache
    }
    const cached = (await getOfflineLayer().local.getAccounts()).find(
      (a) => a.id === accountId,
    );
    if (cached) {
      setAccount({
        id: cached.id,
        name: cached.name,
        territory_id: cached.territory_id,
      });
    }
    setLoaded(true);
  }, [accountId]);

  useEffect(() => {
    // Deferred, same idiom as the account page's own load() effect — calling
    // setState synchronously from the effect body trips
    // react-hooks/set-state-in-effect.
    const timer = setTimeout(() => void loadAccount(), 0);
    return () => clearTimeout(timer);
  }, [loadAccount]);

  useEffect(() => {
    void getOfflineLayer().local.getAccounts().then(setAccounts);
  }, []);

  const isReferral = leadSource
    ? (REFERRAL_LEAD_SOURCES as readonly string[]).includes(leadSource)
    : false;

  const referringAccount = accounts.find((a) => a.id === referringAccountId) ?? null;

  // Same quick-find idiom as accounts/new's referral picker.
  const filteredReferring = useMemo(() => {
    const q = referringQuery.trim().toLowerCase();
    const base = q
      ? accounts.filter((a) => a.name.toLowerCase().includes(q))
      : accounts;
    return base.slice(0, 6);
  }, [accounts, referringQuery]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) {
      setError("You're signed out.");
      return;
    }
    if (!account) {
      setError("This account hasn't reached this device yet.");
      return;
    }
    if (!name.trim()) {
      setError("The deal needs a name.");
      return;
    }
    if (!currentStatus.trim()) {
      setError("Where does this stand? A quick line is needed.");
      return;
    }
    if (!leadSource) {
      setError("Where did this deal come from? Pick the source.");
      return;
    }
    if (leadSource === "OTHER" && !sourceDetail.trim()) {
      setError("A word on where it came from.");
      return;
    }
    if (isReferral && !referringAccountId) {
      setError(
        "Who sent them your way? Referrals need the referring account.",
      );
      return;
    }
    if (!actionText.trim()) {
      setError("Every deal needs a first next action.");
      return;
    }
    if (!actionDue) {
      setError("When is that action due?");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const layer = getOfflineLayer();
      const dealId = crypto.randomUUID();
      const actionId = crypto.randomUUID();

      await layer.sync.enqueue({
        clientId: dealId,
        entityType: "opportunity",
        op: "create",
        payload: {
          id: dealId,
          org_id: profile.orgId,
          name: name.trim(),
          primary_account_id: accountId,
          territory_id: account.territory_id,
          owner_id: profile.membershipId,
          stage,
          current_status: currentStatus.trim(),
          estimated_revenue: revenue === "" ? null : Number(revenue),
          expected_close_date: closeDate || null,
          lead_source: leadSource,
          source_detail: sourceDetail.trim() || null,
          referring_account_id: isReferral ? referringAccountId : null,
          first_action: {
            id: actionId,
            action: actionText.trim(),
            due_date: actionDue,
            kind: actionKind,
          },
        },
        baseVersion: null,
        blobRef: null,
      });

      void layer.sync.drain();
      router.push(`/accounts/${accountId}`);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loaded && !account) {
    return (
      <p className="t-sub px-1 pt-4">
        That account isn&apos;t in your scope, or it hasn&apos;t reached this
        device yet.
      </p>
    );
  }
  if (!account) return null;

  return (
    <form onSubmit={submit} className="stack pt-2">
      <section className="flex flex-col gap-3">
        <p className="t-sub">{account.name}</p>

        <label className="flex flex-col gap-1">
          <span className="t-meta">Deal name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
            placeholder="What's this deal called?"
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-meta">Stage</span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as OpportunityStage)}
            className="field"
          >
            {DEAL_STAGES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-meta">Where does this stand?</span>
          <input
            value={currentStatus}
            onChange={(e) => setCurrentStatus(e.target.value)}
            className="field"
            placeholder="A quick line on where things are"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-meta">Estimated value (optional)</span>
          <input
            type="number"
            inputMode="decimal"
            value={revenue}
            onChange={(e) => setRevenue(e.target.value)}
            className="field"
            placeholder="$"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-meta">Expected close (optional)</span>
          <input
            type="date"
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-meta">How did this deal come about?</span>
          <select
            value={leadSource}
            onChange={(e) => {
              setLeadSource(e.target.value as LeadSource | "");
              setReferringAccountId("");
              setReferringQuery("");
              setPickingReferring(false);
            }}
            className="field"
          >
            <option value="">Pick the source</option>
            {LEAD_SOURCES_ALL.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </label>

        {leadSource === "OTHER" && (
          <input
            placeholder="Where did this come from?"
            value={sourceDetail}
            onChange={(e) => setSourceDetail(e.target.value)}
            className="field"
          />
        )}

        {/* Referral picker — same type-to-filter idiom as accounts/new. */}
        {isReferral && (
          <div className="flex flex-col gap-1">
            <span className="t-meta">Who sent them your way?</span>
            {referringAccount ? (
              <div className="row">
                <span className="row-body">
                  <span className="t-title block truncate">
                    {referringAccount.name}
                  </span>
                  <span className="t-sub block truncate">
                    {humanize(referringAccount.account_type)}
                    {referringAccount.city ? ` · ${referringAccount.city}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-quiet shrink-0"
                  onClick={() => {
                    setReferringAccountId("");
                    setPickingReferring(true);
                  }}
                >
                  Change
                </button>
              </div>
            ) : pickingReferring ? (
              <div className="card overflow-hidden">
                <input
                  autoFocus
                  placeholder="Find the referring account"
                  value={referringQuery}
                  onChange={(e) => setReferringQuery(e.target.value)}
                  className="field"
                  style={{ borderRadius: 0, border: 0 }}
                />
                <ul>
                  {filteredReferring.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setReferringAccountId(a.id);
                          setPickingReferring(false);
                          setReferringQuery("");
                        }}
                        className="flex w-full items-baseline gap-2 px-4 py-3 text-left"
                        style={{ borderTop: "1px solid var(--rule)" }}
                      >
                        <span className="t-title">{a.name}</span>
                        <span className="t-meta">
                          {humanize(a.account_type)}
                          {a.city ? ` · ${a.city}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                  {filteredReferring.length === 0 && (
                    <p className="t-sub px-4 py-3">
                      No cached accounts match.
                    </p>
                  )}
                </ul>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPickingReferring(true)}
                className="btn-secondary"
              >
                Find the referring account
              </button>
            )}
          </div>
        )}

        <p className="t-section mt-2">First next step</p>

        <label className="flex flex-col gap-1">
          <span className="t-meta">What are you doing next?</span>
          <input
            value={actionText}
            onChange={(e) => setActionText(e.target.value)}
            className="field"
            placeholder="e.g. Send a quote"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-meta">By when?</span>
          <input
            type="date"
            value={actionDue}
            onChange={(e) => setActionDue(e.target.value)}
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-meta">What kind of follow-up is this?</span>
          <select
            value={actionKind}
            onChange={(e) => setActionKind(e.target.value as ActionKind)}
            className="field"
          >
            {ACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {humanize(k)}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p className="t-sub" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn-primary">
          Save deal
        </button>
      </section>
    </form>
  );
}
