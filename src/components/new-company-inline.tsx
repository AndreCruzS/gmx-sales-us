"use client";

// A NEW COMPANY WITHOUT LEAVING THE QUOTE OR THE VISIT (João, 2026-09-16: "se
// a gente criar o dealer a partir do quote e da visita… a gente está reduzindo
// para um passo, ao invés de ter dois"). A rep rarely adds a dealer for its own
// sake — there is a quote to send or a visit to put down — so the account is
// born inside that flow: name, type, where it came from, ZIP, and the flow
// carries on with it.
//
// The same account the full form creates, through the same outbox op and the
// same ZIP placement. What it leaves out on purpose is what the full form
// still owns: referrals (they need the referring account) and a champion (the
// quote asks for its recipient anyway).

import { useState } from "react";
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
import { useZipLookup, zipLookupNote } from "@/lib/ui/use-zip-lookup";

// Dealer first: it is the company a rep adds from the field, nine times in ten.
const TYPES_DEALER_FIRST: AccountType[] = [
  "DEALER",
  ...ACCOUNT_TYPES.filter((t) => t !== "DEALER"),
];

const QUICK_SOURCES = LEAD_SOURCES_ALL.filter(
  (s) => !(REFERRAL_LEAD_SOURCES as readonly string[]).includes(s),
);

export function NewCompanyInline({
  initialName,
  onCreated,
  onCancel,
  submitLabel,
}: {
  initialName: string;
  /** The account as cached on this device — the flow continues with it. */
  onCreated: (account: CachedAccount) => void;
  onCancel: () => void;
  /** Says where the flow goes next: "Continue to the quote". */
  submitLabel: string;
}) {
  const { profile } = useOffline();
  const [name, setName] = useState(initialName);
  const [accountType, setAccountType] = useState<AccountType>("DEALER");
  const [leadSource, setLeadSource] = useState<LeadSource | "">("");
  const [sourceDetail, setSourceDetail] = useState("");
  const { zip, changeZip, city, setCity, state, setState, lookup, territoryId } =
    useZipLookup(profile?.territoryId ?? null);
  const note = zipLookupNote(lookup);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!profile) return setError("You're signed out.");
    if (!name.trim()) return setError("The company needs a name.");
    if (!leadSource) return setError("How did you get to them? Pick the source.");
    if (leadSource === "OTHER" && !sourceDetail.trim())
      return setError("A word on where it came from.");

    setBusy(true);
    setError(null);
    const layer = getOfflineLayer();
    const id = crypto.randomUUID();
    let seq: number | null = null;
    try {
      seq = await layer.sync.enqueue({
        clientId: id,
        entityType: "account",
        op: "create",
        payload: {
          id,
          org_id: profile.orgId,
          name: name.trim(),
          account_type: accountType,
          city: city.trim() || null,
          state: state.trim().toUpperCase() || null,
          postal_code: /^\d{5}$/.test(zip) ? zip : null,
          territory_id: territoryId,
          owner_id: profile.membershipId,
          lead_source: leadSource,
          source_detail: sourceDetail.trim() || null,
          referring_account_id: null,
        },
        baseVersion: null,
        blobRef: null,
      });
      // Mirrored at once, so the quote or visit that follows finds it on this
      // device before the server has answered.
      const cached: CachedAccount = {
        id,
        name: name.trim(),
        account_type: accountType,
        city: city.trim() || null,
        territory_id: territoryId,
        has_display_wall: false,
        display_last_verified_at: null,
        parent_account_id: null,
        updated_at: new Date().toISOString(),
        pendingSync: true,
      };
      await layer.local.putLocalAccount(cached);
      void layer.sync.drain();
      onCreated(cached);
    } catch (err) {
      if (seq !== null) await layer.local.deleteOutbox(seq);
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Not a <form>: it sits inside other forms (the visit plan), and a nested
  // form is invalid HTML.
  return (
    <div
      className="newco card card-pad flex flex-col gap-3"
      // Enter in any field creates the company — and never reaches a form
      // this sits inside, which would submit the plan half-filled.
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          void create();
        }
      }}
    >
      <p className="sales-eyebrow">New company</p>

      <label className="flex flex-col gap-1">
        <span className="t-hint">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field"
          placeholder="Wellborn & Wright"
          autoFocus
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="t-hint">Type</span>
        <div className="newco-types" role="group" aria-label="Type">
          {TYPES_DEALER_FIRST.map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              aria-pressed={accountType === t}
              onClick={() => setAccountType(t)}
            >
              {humanize(t)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <label className="flex w-20 shrink-0 flex-col gap-1">
          <span className="t-hint">ZIP</span>
          <input
            value={zip}
            onChange={(e) => changeZip(e.target.value)}
            className="field"
            placeholder="91406"
            inputMode="numeric"
            autoComplete="postal-code"
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="t-hint">City</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="field"
            placeholder="City"
            autoComplete="address-level2"
          />
        </label>
        <label className="flex w-14 shrink-0 flex-col gap-1">
          <span className="t-hint">State</span>
          <input
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="field"
            placeholder="CA"
            autoComplete="address-level1"
          />
        </label>
      </div>
      {note && (
        <span className="t-hint" style={note.bad ? { color: "var(--danger)" } : undefined}>
          {note.text}
        </span>
      )}

      <label className="flex flex-col gap-1">
        <span className="t-hint">How did you get to them?</span>
        <select
          value={leadSource}
          onChange={(e) => setLeadSource(e.target.value as LeadSource | "")}
          className="field"
        >
          <option value="">Pick the source</option>
          {QUICK_SOURCES.map((s) => (
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

      {error && (
        <p className="t-sub" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <div className="newco-actions">
        <button type="button" className="btn-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={() => void create()} disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
