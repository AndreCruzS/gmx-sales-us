"use client";

// Standalone add-account form (spec §4): the card flow's create fields,
// promoted to a screen reachable from Home and the Accounts tab — because a
// rep who just walked a new dealer's counter shouldn't have to fake a card
// scan to get the account on the books.
//
// Reuses accountCreateSchema + the account:create outbox path exactly as the
// card confirm sheet does (src/app/review/page.tsx CardSheet.save), with one
// addition the card flow deliberately punts: referral lead sources are
// allowed here, and write the account_relationships row (D4/D7) — "that flow
// belongs on the account screen, not a card sheet" per that file's comment.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "@/components/offline-provider";
import {
  ACCOUNT_TYPES,
  LEAD_SOURCES_ALL,
  REFERRAL_LEAD_SOURCES,
  humanize,
  type AccountType,
  type LeadSource,
} from "@/lib/domain/enums";
import { getOfflineLayer, type CachedAccount } from "@/lib/offline";

export default function NewAccountPage() {
  const { profile } = useOffline();
  const router = useRouter();

  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("DEALER");
  const [city, setCity] = useState("");
  const [leadSource, setLeadSource] = useState<LeadSource | "">("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [referringAccountId, setReferringAccountId] = useState("");
  // Referral picker (fix round 1): type-to-filter over cached accounts, same
  // idiom as record/page.tsx's account picker — a bare <select> doesn't scale
  // to this org's account list and can't distinguish same-named branches.
  const [referringQuery, setReferringQuery] = useState("");
  const [pickingReferring, setPickingReferring] = useState(false);
  const [championNote, setChampionNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getOfflineLayer().local.getAccounts().then(setAccounts);
  }, []);

  const isReferral = leadSource
    ? (REFERRAL_LEAD_SOURCES as readonly string[]).includes(leadSource)
    : false;

  const referringAccount = accounts.find((a) => a.id === referringAccountId) ?? null;

  // Same filter shape as record/page.tsx's account picker: name match, capped
  // list — this is a quick-find over the cached working set, not a full search.
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
    // No territory on the login is NOT a refusal any more (Andre, 2026-09-04):
    // admins have no patch by design, and they create dealers and distributors.
    // The account lands unplaced — the owner still makes it visible — and the
    // map places it later, the same way an off-map branch waits for its state.
    if (!name.trim()) {
      setError("The account needs a name.");
      return;
    }
    if (!leadSource) {
      setError("Where did this account come from? Pick the source.");
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

    setBusy(true);
    setError(null);
    // Compensation: multiple outbox ops; if any enqueue fails, roll back the
    // ones already queued so a retry can't create duplicates (same pattern
    // as CardSheet.save / ReviewSheet.send in src/app/review/page.tsx).
    const enqueuedSeqs: number[] = [];
    try {
      const layer = getOfflineLayer();
      const accountId = crypto.randomUUID();
      const now = new Date().toISOString();

      enqueuedSeqs.push(
        await layer.sync.enqueue({
          clientId: accountId,
          entityType: "account",
          op: "create",
          payload: {
            id: accountId,
            org_id: profile.orgId,
            name: name.trim(),
            account_type: accountType,
            city: city.trim() || null,
            territory_id: profile.territoryId ?? null,
            owner_id: profile.membershipId,
            lead_source: leadSource,
            source_detail: sourceDetail.trim() || null,
            referring_account_id: isReferral ? referringAccountId : null,
          },
          baseVersion: null,
          blobRef: null,
        }),
      );

      // D4/D7: the referral fan-out — a row on account_relationships,
      // "app-layer responsibility at account creation" per the migration
      // comment. account_a is the new account, account_b the one that sent
      // them your way (matches accounts/[id]/page.tsx's a/b phrasing).
      if (isReferral) {
        const relationshipId = crypto.randomUUID();
        enqueuedSeqs.push(
          await layer.sync.enqueue({
            clientId: relationshipId,
            entityType: "account_relationship",
            op: "create",
            payload: {
              id: relationshipId,
              org_id: profile.orgId,
              account_a_id: accountId,
              relationship_type: "REFERRED_BY",
              account_b_id: referringAccountId,
              created_by: profile.membershipId,
            },
            baseVersion: null,
            blobRef: null,
          }),
        );
      }

      // A champion note, if given, becomes a real contact (D50) — the person
      // this account page will lead with, not a text blob nobody can call.
      if (championNote.trim()) {
        const contactId = crypto.randomUUID();
        enqueuedSeqs.push(
          await layer.sync.enqueue({
            clientId: contactId,
            entityType: "contact",
            op: "create",
            payload: {
              id: contactId,
              org_id: profile.orgId,
              account_id: accountId,
              name: championNote.trim(),
              job_title: null,
              email: null,
              phone: null,
              is_champion: true,
            },
            baseVersion: null,
            blobRef: null,
          }),
        );
      }

      // D56 optimistic mirror: the new account shows in the cached list
      // immediately — same idiom as record/page.tsx's putLocalActivity.
      await layer.local.putLocalAccount({
        id: accountId,
        name: name.trim(),
        account_type: accountType,
        city: city.trim() || null,
        territory_id: profile.territoryId ?? null,
        has_display_wall: false,
        display_last_verified_at: null,
        parent_account_id: null,
        updated_at: now,
        pendingSync: true,
      });

      void layer.sync.drain();
      router.push("/accounts");
    } catch (err) {
      const layer = getOfflineLayer();
      for (const seq of enqueuedSeqs) {
        await layer.local.deleteOutbox(seq);
      }
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={submit} className="stack pt-2">
      <section className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="t-hint">
            Name — brand + city, e.g. &quot;Ganahl Anaheim&quot;
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
            placeholder="Ganahl Anaheim"
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-hint">Type</span>
          <select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as AccountType)}
            className="field"
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-hint">City (optional)</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="field"
            placeholder="City"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-hint">How did you get to them?</span>
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

        {/* Referral picker (fix round 1): type-to-filter over cached accounts
            — same idiom as record/page.tsx's account picker — rather than a
            bare <select> that can't distinguish same-named branches at this
            org's account-list size. */}
        {isReferral && (
          <div className="flex flex-col gap-1">
            <span className="t-hint">Who sent them your way?</span>
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
                        <span className="t-hint">
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

        <label className="flex flex-col gap-1">
          <span className="t-hint">
            Champion — who&apos;s your fan there?
          </span>
          <input
            value={championNote}
            onChange={(e) => setChampionNote(e.target.value)}
            className="field"
            placeholder="Their name (optional)"
          />
          <span className="t-hint">
            Optional — the name you type becomes this account&apos;s
            champion contact.
          </span>
        </label>

        {error && (
          <p className="t-sub" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn-primary">
          Save account
        </button>
      </section>
    </form>
  );
}
