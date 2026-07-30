"use client";

// Review — the one inbox of things waiting on the rep's decision:
//   · notes the system wrote up, waiting for their OK (D9 — nothing becomes a
//     record without review; Send fans out through the outbox, D10)
//   · saves that didn't land (LWW conflicts / rejected writes, D61/D62) —
//     surfaced, never silently dropped

import { useCallback, useEffect, useState } from "react";
import { useOffline, type Profile } from "@/components/offline-provider";
import { AlertIcon, ChevronDownIcon, FileIcon, XIcon } from "@/components/icons";
import {
  ACCOUNT_TYPES,
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  LEAD_SOURCES_ALL,
  REFERRAL_LEAD_SOURCES,
  humanize,
  type AccountType,
  type ActivityOutcome,
  type ActivityType,
  type LeadSource,
} from "@/lib/domain/enums";
import { CONFIDENCE_OK, type ExtractedCard } from "@/lib/cards/draft";
import { displayAccountName } from "@/lib/format";
import type { DebriefDraft } from "@/lib/voice/draft";
import {
  getOfflineLayer,
  type CachedAccount,
  type OutboxRecord,
} from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface CaptureRow {
  id: string;
  status: string;
  transcript: string | null;
  ai_draft: (DebriefDraft & { error?: string }) | null;
  audio_path: string | null;
  created_at: string;
  updated_at: string;
}

interface CandidateRow {
  id: string;
  source: string;
  raw_ref: string | null;
  extracted: ExtractedCard;
  matched_account_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Status labels in the rep's language, not the pipeline's.
const STATUS_LABEL: Record<string, string> = {
  UPLOADED: "Waiting to be written up",
  PROCESSING: "Being written up…",
  DRAFTED: "Ready for your OK",
  SENT: "Saved",
  FAILED: "Couldn't be written up",
  "queued…": "Waiting for signal",
};

export default function ReviewPage() {
  const { profile, status } = useOffline();
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [rejected, setRejected] = useState<OutboxRecord[]>([]);
  const [reviewing, setReviewing] = useState<CaptureRow | null>(null);
  const [reviewingCard, setReviewingCard] = useState<CandidateRow | null>(null);
  const [processing, setProcessing] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const layer = getOfflineLayer();
    void layer.local.getAccounts().then(setAccounts);
    void layer.local.listRejected().then(setRejected);
    try {
      const supabase = getSupabaseBrowserClient();
      const [caps, cands] = await Promise.all([
        supabase
          .from("voice_captures")
          .select(
            "id, status, transcript, ai_draft, audio_path, created_at, updated_at",
          )
          .neq("status", "DISCARDED")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("contact_candidates")
          .select(
            "id, source, raw_ref, extracted, matched_account_id, created_by, created_at, updated_at",
          )
          .eq("status", "PENDING")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (caps.data) setCaptures(caps.data as CaptureRow[]);
      if (cands.data) setCandidates(cands.data as CandidateRow[]);
      // Cached so the badge (Task 7) and Home's "Waiting your OK" tile can
      // read a count offline, between loads — only written when the fetch
      // actually landed, so a failed/offline load leaves the last-known
      // count in place rather than zeroing it out.
      if (caps.data && cands.data) {
        const drafted = (caps.data as CaptureRow[]).filter(
          (c) => c.status === "DRAFTED",
        ).length;
        void layer.local.setMeta(
          "review_counts",
          JSON.stringify({
            captures: drafted,
            candidates: (cands.data as CandidateRow[]).length,
          }),
        );
      }
    } catch {
      // offline — rejected saves still show; drafts need signal
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, status.lastPulledAt, status.rejected]);

  async function draftPending() {
    setProcessing(true);
    setError(null);
    try {
      const res = await fetch("/api/voice/process", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
    }
  }

  async function discardRejected(seq: number) {
    await getOfflineLayer().local.deleteOutbox(seq);
    setRejected((prev) => prev.filter((r) => r.seq !== seq));
  }

  async function discardCandidate(c: CandidateRow) {
    const layer = getOfflineLayer();
    await layer.sync.enqueue({
      clientId: c.id,
      entityType: "contact_candidate",
      op: "update",
      payload: {
        id: c.id,
        status: "DISCARDED",
        resolved_at: new Date().toISOString(),
      },
      baseVersion: c.updated_at,
      blobRef: null,
    });
    setCandidates((prev) => prev.filter((x) => x.id !== c.id));
    void layer.sync.drain();
  }

  async function readCards() {
    setReading(true);
    setError(null);
    try {
      const res = await fetch("/api/cards/process", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
    }
  }

  const toConfirm = captures.filter((c) => c.status === "DRAFTED");
  const inFlight = captures.filter(
    (c) => c.status === "UPLOADED" || c.status === "PROCESSING" || c.status === "queued…",
  );
  const failed = captures.filter((c) => c.status === "FAILED");
  const done = captures.filter((c) => c.status === "SENT").slice(0, 5);
  const cardsReady = candidates.filter((c) => c.extracted?.fields);
  const cardsUnread = candidates.filter(
    (c) => !c.extracted?.fields && !c.extracted?.error,
  );
  const cardsFailed = candidates.filter((c) => c.extracted?.error);
  const quiet =
    toConfirm.length === 0 &&
    inFlight.length === 0 &&
    failed.length === 0 &&
    rejected.length === 0 &&
    candidates.length === 0;

  return (
    <div className="stack pt-2">
      {quiet && (
        <p className="t-sub px-1">
          Nothing needs you. Notes waiting for your OK and saves that hit a
          conflict land here.
        </p>
      )}

      {toConfirm.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Give your OK</h2>
            <span className="tag tag-accent">{toConfirm.length}</span>
          </div>
          <ul className="list">
            {toConfirm.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setReviewing(c)}
                  className="row w-full text-left"
                >
                  <span className="row-body">
                    <span className="t-title line-clamp-2 block">
                      {c.ai_draft?.summary ?? c.transcript ?? "Note"}
                    </span>
                    <span className="t-sub block">
                      {new Date(c.created_at).toLocaleDateString()} ·{" "}
                      {c.audio_path ? "spoken" : "typed"}
                    </span>
                  </span>
                  <span className="tag tag-solid shrink-0">Check &amp; save</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {candidates.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">New contacts</h2>
            <span className="tag tag-accent">{candidates.length}</span>
          </div>
          <ul className="list">
            {cardsReady.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setReviewingCard(c)}
                  className="row w-full text-left"
                >
                  <span className="row-lead">
                    <FileIcon size={18} />
                  </span>
                  <span className="row-body">
                    <span className="t-title block truncate">
                      {c.extracted.fields?.name.value ?? "Card without a name"}
                    </span>
                    <span className="t-sub block truncate">
                      {[
                        c.extracted.fields?.job_title.value,
                        c.extracted.fields?.company.value,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "From a business card"}
                      {c.extracted.contact_match &&
                        " · looks like someone you already have"}
                    </span>
                  </span>
                  <span className="tag tag-solid shrink-0">
                    Check &amp; save
                  </span>
                </button>
              </li>
            ))}
            {cardsUnread.map((c) => (
              <li key={c.id} className="row">
                <span className="row-lead">
                  <FileIcon size={18} />
                </span>
                <span className="row-body">
                  {/* a manager sees the chain's queue (RLS), but only the rep
                      who snapped a card can run the read on it */}
                  <span className="t-title block">
                    {c.source === "BUSINESS_CARD"
                      ? "Business card"
                      : c.source === "EMAIL_METADATA"
                        ? "Emailed you"
                        : "Contact entry"}
                  </span>
                  <span className="t-sub block">
                    {c.created_by === profile?.membershipId
                      ? "Waiting to be read"
                      : "Waiting for its rep to read it"}
                  </span>
                </span>
              </li>
            ))}
            {cardsFailed.map((c) => (
              <li key={c.id} className="row">
                <span
                  className="row-lead"
                  style={{ background: "var(--danger-tint)" }}
                >
                  <AlertIcon size={18} style={{ color: "var(--danger)" }} />
                </span>
                <span className="row-body">
                  <span className="t-title block">
                    A card couldn&apos;t be read
                  </span>
                  <span className="t-sub block">{c.extracted.error}</span>
                </span>
                <button
                  onClick={() => discardCandidate(c)}
                  className="btn-quiet shrink-0"
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
          {cardsUnread.some(
            (c) => c.created_by === profile?.membershipId,
          ) && (
            <button
              onClick={readCards}
              disabled={reading}
              className="btn-secondary mt-2 w-full"
            >
              {reading ? "Reading…" : "Read my cards now"}
            </button>
          )}
        </section>
      )}

      {inFlight.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">On its way</h2>
            <span className="t-meta">{inFlight.length}</span>
          </div>
          <ul className="list">
            {inFlight.map((c) => (
              <li key={c.id} className="row">
                <span className="row-body">
                  <span className="t-title line-clamp-1 block">
                    {c.transcript ?? "Voice note"}
                  </span>
                  <span className="t-sub block">
                    {STATUS_LABEL[c.status] ?? humanize(c.status)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {inFlight.some((c) => c.status === "UPLOADED") && (
            <button
              onClick={draftPending}
              disabled={processing}
              className="btn-secondary mt-2 w-full"
            >
              {processing ? "Writing up…" : "Write them up now"}
            </button>
          )}
        </section>
      )}

      {(failed.length > 0 || rejected.length > 0) && (
        <section>
          <div className="section-head">
            <h2 className="t-section" style={{ color: "var(--danger)" }}>
              Didn&apos;t go through
            </h2>
            <span className="tag tag-danger">
              {failed.length + rejected.length}
            </span>
          </div>
          <ul className="list">
            {failed.map((c) => (
              <li key={c.id} className="row">
                <span
                  className="row-lead"
                  style={{ background: "var(--danger-tint)" }}
                >
                  <AlertIcon size={18} style={{ color: "var(--danger)" }} />
                </span>
                <span className="row-body">
                  <span className="t-title line-clamp-1 block">
                    {c.transcript ?? "Voice note"}
                  </span>
                  <span className="t-sub block">
                    Couldn&apos;t be written up
                    {c.ai_draft?.error ? ` — ${c.ai_draft.error}` : ""}
                  </span>
                </span>
              </li>
            ))}
            {rejected.map((r) => (
              <li key={r.seq} className="row items-start">
                <span
                  className="row-lead"
                  style={{ background: "var(--danger-tint)" }}
                >
                  <AlertIcon size={18} style={{ color: "var(--danger)" }} />
                </span>
                <span className="row-body">
                  <span className="t-title block">
                    A {humanize(r.entityType)} didn&apos;t save
                  </span>
                  <span className="t-sub block">{r.lastError}</span>
                  <details className="mt-1">
                    <summary className="t-meta flex cursor-pointer items-center gap-1">
                      <ChevronDownIcon size={12} />
                      What you recorded
                    </summary>
                    <pre
                      className="t-meta mt-1 overflow-x-auto rounded-lg p-2"
                      style={{ background: "var(--surface-card)" }}
                    >
                      {JSON.stringify(r.payload, null, 2)}
                    </pre>
                  </details>
                </span>
                <button
                  onClick={() => discardRejected(r.seq as number)}
                  className="btn-quiet shrink-0"
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Recently saved</h2>
          </div>
          <ul className="list">
            {done.map((c) => (
              <li key={c.id} className="row">
                <span className="row-body">
                  <span className="t-sub line-clamp-1 block">
                    {c.ai_draft?.summary ?? c.transcript ?? "Note"}
                  </span>
                </span>
                <span className="tag tag-success shrink-0">Saved</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p className="t-sub px-1" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      {reviewing && reviewing.ai_draft && (
        <ReviewSheet
          capture={reviewing}
          accounts={accounts}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            void load();
          }}
        />
      )}

      {reviewingCard && reviewingCard.extracted.fields && profile && (
        <CardSheet
          candidate={reviewingCard}
          accounts={accounts}
          profile={profile}
          onClose={() => setReviewingCard(null)}
          onDone={() => {
            setReviewingCard(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// The D9 gate: every field editable, the rep commits explicitly. Send fans out
// through the standard outbox (D10) — activity + next actions + capture update.
function ReviewSheet({
  capture,
  accounts,
  onClose,
  onDone,
}: {
  capture: CaptureRow;
  accounts: CachedAccount[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { profile } = useOffline();
  const draft = capture.ai_draft as DebriefDraft;
  const [accountId, setAccountId] = useState("");
  const [activityType, setActivityType] = useState<ActivityType>(
    draft.activity_type,
  );
  const [whatHappened, setWhatHappened] = useState(draft.what_happened);
  const [keyInfo, setKeyInfo] = useState(draft.key_information ?? "");
  const [potential, setPotential] = useState(draft.commercial_potential ?? "");
  const [outcomes, setOutcomes] = useState<ActivityOutcome[]>(draft.outcomes);
  const [followUp, setFollowUp] = useState(draft.follow_up_required);
  const [actions, setActions] = useState(draft.next_actions);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!profile) return;
    if (!accountId) {
      setError("Pick the account this belongs to.");
      return;
    }
    setBusy(true);
    setError(null);
    // Compensation: the fan-out is multiple outbox ops; if any enqueue fails,
    // roll back the ones already queued so a retry can't create duplicates.
    const enqueuedSeqs: number[] = [];
    try {
      const layer = getOfflineLayer();
      const activityId = crypto.randomUUID();
      enqueuedSeqs.push(
        await layer.sync.enqueue({
          clientId: activityId,
          entityType: "activity",
          op: "create",
          payload: {
            id: activityId,
            org_id: profile.orgId,
            activity_type: activityType,
            primary_account_id: accountId,
            owner_id: profile.membershipId,
            occurred_at: capture.created_at,
            was_planned: false,
            what_happened: whatHappened,
            key_information: keyInfo.trim() || null,
            commercial_potential: potential.trim() || null,
            outcomes,
            follow_up_required: followUp,
          },
          baseVersion: null,
          blobRef: null,
        }),
      );
      for (const na of actions) {
        if (!na.action.trim() || !na.due_date) continue;
        const naId = crypto.randomUUID();
        enqueuedSeqs.push(
          await layer.sync.enqueue({
            clientId: naId,
            entityType: "next_action",
            op: "create",
            payload: {
              id: naId,
              org_id: profile.orgId,
              action: na.action.trim(),
              owner_id: profile.membershipId,
              due_date: na.due_date,
              account_id: accountId,
              activity_id: activityId, // Rule 3 linkage
              // D48: OTHER requires objective_detail — a draft can't supply
              // it, so drop OTHER rather than trip the check.
              objective:
                na.objective === "OTHER" ? null : (na.objective ?? null),
            },
            baseVersion: null,
            blobRef: null,
          }),
        );
      }
      const now = new Date().toISOString();
      enqueuedSeqs.push(
        await layer.sync.enqueue({
          clientId: capture.id,
          entityType: "voice_capture",
          op: "update",
          payload: {
            id: capture.id,
            status: "SENT",
            reviewed_at: now,
            sent_at: now,
            activity_id: activityId,
          },
          baseVersion: capture.updated_at,
          blobRef: null,
        }),
      );
      await layer.local.putLocalActivity({
        id: activityId,
        activity_type: activityType,
        primary_account_id: accountId,
        occurred_at: capture.created_at,
        what_happened: whatHappened,
        follow_up_required: followUp,
        // This send path doesn't link to a planned visit (the payload above
        // hardcodes was_planned: false, no planned_action_id) — null here
        // matches what the server row will actually carry.
        planned_action_id: null,
        pendingSync: true,
      });
      void layer.sync.drain();
      onDone();
    } catch (err) {
      // Roll back whatever part of the fan-out already queued.
      const layer = getOfflineLayer();
      for (const seq of enqueuedSeqs) {
        await layer.local.deleteOutbox(seq);
      }
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function discard() {
    const layer = getOfflineLayer();
    await layer.sync.enqueue({
      clientId: capture.id,
      entityType: "voice_capture",
      op: "update",
      payload: { id: capture.id, status: "DISCARDED" },
      baseVersion: capture.updated_at,
      blobRef: null,
    });
    void layer.sync.drain();
    onDone();
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl p-5"
        style={{ background: "var(--surface-page)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="t-title text-base">Check &amp; save</h2>
        <p className="t-sub mt-1">{draft.summary}</p>

        {capture.transcript && (
          <details className="t-sub mt-2">
            <summary className="cursor-pointer">
              What you said, word for word
            </summary>
            <p className="mt-1">{capture.transcript}</p>
          </details>
        )}

        <div className="mt-4 flex flex-col gap-3">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="field"
          >
            <option value="">Which account is this?</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            value={activityType}
            onChange={(e) => setActivityType(e.target.value as ActivityType)}
            className="field"
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>

          <textarea
            value={whatHappened}
            onChange={(e) => setWhatHappened(e.target.value)}
            rows={3}
            className="field"
          />
          <textarea
            placeholder="Anything worth remembering"
            value={keyInfo}
            onChange={(e) => setKeyInfo(e.target.value)}
            rows={2}
            className="field"
          />
          <input
            placeholder="Business potential you saw"
            value={potential}
            onChange={(e) => setPotential(e.target.value)}
            className="field"
          />

          <div className="flex flex-wrap gap-1.5">
            {ACTIVITY_OUTCOMES.map((o) => {
              const on = outcomes.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() =>
                    setOutcomes((prev) =>
                      on ? prev.filter((x) => x !== o) : [...prev, o],
                    )
                  }
                  className={on ? "tag tag-solid" : "tag"}
                >
                  {humanize(o)}
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={followUp}
              onChange={(e) => setFollowUp(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Needs a follow-up
          </label>

          <div className="flex flex-col gap-2">
            <span className="t-meta">What happens next</span>
            {actions.map((na, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={na.action}
                  onChange={(e) =>
                    setActions((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, action: e.target.value } : x,
                      ),
                    )
                  }
                  className="field min-w-0 flex-1"
                />
                <input
                  type="date"
                  value={na.due_date}
                  onChange={(e) =>
                    setActions((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, due_date: e.target.value } : x,
                      ),
                    )
                  }
                  className="field"
                />
                <button
                  onClick={() =>
                    setActions((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="btn-quiet shrink-0"
                  aria-label={`Remove: ${na.action || "untitled"}`}
                >
                  <XIcon size={14} />
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setActions((prev) => [
                  ...prev,
                  { action: "", due_date: "", objective: null },
                ])
              }
              className="t-action text-left"
              type="button"
            >
              + Add one
            </button>
          </div>

          {error && (
            <p className="t-sub" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <button
              onClick={send}
              disabled={busy}
              className="btn-primary flex-1"
              style={{ maxWidth: "none" }}
            >
              Save it
            </button>
            <button onClick={discard} className="btn-secondary" type="button">
              Throw away
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// The card confirm gate (D41/D43): every extracted field editable, low-
// confidence reads flagged, and the account attached — or created, which is
// where lead-source attribution is forced at first contact (D43). Saving fans
// out through the outbox like everything else.
function CardSheet({
  candidate,
  accounts,
  profile,
  onClose,
  onDone,
}: {
  candidate: CandidateRow;
  accounts: CachedAccount[];
  profile: Profile;
  onClose: () => void;
  onDone: () => void;
}) {
  const fields = candidate.extracted.fields!;
  const match = candidate.extracted.contact_match ?? null;
  const suggested = (candidate.extracted.suggested_source ?? "") as
    | LeadSource
    | "";

  const [name, setName] = useState(fields.name.value ?? "");
  const [jobTitle, setJobTitle] = useState(fields.job_title.value ?? "");
  const [email, setEmail] = useState(fields.email.value ?? "");
  const [phone, setPhone] = useState(fields.phone.value ?? "");
  const [accountMode, setAccountMode] = useState<"existing" | "new">(
    candidate.matched_account_id || !fields.company.value ? "existing" : "new",
  );
  const [accountId, setAccountId] = useState(candidate.matched_account_id ?? "");
  // Cards SHOUT; records shouldn't. The rep can always re-capitalize a brand.
  const [newName, setNewName] = useState(
    displayAccountName(fields.company.value ?? ""),
  );
  const [newType, setNewType] = useState<AccountType>("CONTRACTOR");
  const [newCity, setNewCity] = useState("");
  const [leadSource, setLeadSource] = useState<LeadSource | "">(suggested);
  const [sourceDetail, setSourceDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Referral sources need a referring account (D7) — that flow belongs on the
  // account screen, not a card sheet. Quick-create offers the rest.
  const quickSources = LEAD_SOURCES_ALL.filter(
    (s) => !(REFERRAL_LEAD_SOURCES as readonly string[]).includes(s),
  );

  const check = (f: { value: string | null; confidence: number }) =>
    f.confidence < CONFIDENCE_OK;

  async function merge() {
    if (!match) return;
    setBusy(true);
    const layer = getOfflineLayer();
    await layer.sync.enqueue({
      clientId: candidate.id,
      entityType: "contact_candidate",
      op: "update",
      payload: {
        id: candidate.id,
        status: "MERGED",
        matched_contact_id: match.id,
        resolved_at: new Date().toISOString(),
      },
      baseVersion: candidate.updated_at,
      blobRef: null,
    });
    void layer.sync.drain();
    onDone();
  }

  async function save() {
    if (!name.trim()) {
      setError("The contact needs a name.");
      return;
    }
    if (accountMode === "existing" && !accountId) {
      setError("Pick the account this person belongs to.");
      return;
    }
    if (accountMode === "new") {
      if (!profile.territoryId) {
        setError(
          "Your login has no territory, so it can't create accounts — attach an existing one.",
        );
        return;
      }
      if (!newName.trim()) {
        setError("The new account needs its name.");
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
    }
    setBusy(true);
    setError(null);
    // Compensation: multiple outbox ops; if any enqueue fails, roll back the
    // ones already queued so a retry can't create duplicates.
    const enqueuedSeqs: number[] = [];
    try {
      const layer = getOfflineLayer();
      let targetAccountId = accountId;
      if (accountMode === "new") {
        targetAccountId = crypto.randomUUID();
        enqueuedSeqs.push(
          await layer.sync.enqueue({
            clientId: targetAccountId,
            entityType: "account",
            op: "create",
            payload: {
              id: targetAccountId,
              org_id: profile.orgId,
              name: newName.trim(),
              account_type: newType,
              city: newCity.trim() || null,
              territory_id: profile.territoryId,
              owner_id: profile.membershipId,
              lead_source: leadSource,
              source_detail: sourceDetail.trim() || null,
            },
            baseVersion: null,
            blobRef: null,
          }),
        );
      }
      const contactId = crypto.randomUUID();
      enqueuedSeqs.push(
        await layer.sync.enqueue({
          clientId: contactId,
          entityType: "contact",
          op: "create",
          payload: {
            id: contactId,
            org_id: profile.orgId,
            account_id: targetAccountId,
            name: name.trim(),
            job_title: jobTitle.trim() || null,
            email: email.trim().toLowerCase() || null,
            phone: phone.trim() || null,
          },
          baseVersion: null,
          blobRef: null,
        }),
      );
      enqueuedSeqs.push(
        await layer.sync.enqueue({
          clientId: candidate.id,
          entityType: "contact_candidate",
          op: "update",
          payload: {
            id: candidate.id,
            status: "CONFIRMED",
            matched_contact_id: contactId,
            matched_account_id: targetAccountId,
            resolved_at: new Date().toISOString(),
          },
          baseVersion: candidate.updated_at,
          blobRef: null,
        }),
      );
      void layer.sync.drain();
      onDone();
    } catch (err) {
      const layer = getOfflineLayer();
      for (const seq of enqueuedSeqs) {
        await layer.local.deleteOutbox(seq);
      }
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function discard() {
    const layer = getOfflineLayer();
    await layer.sync.enqueue({
      clientId: candidate.id,
      entityType: "contact_candidate",
      op: "update",
      payload: {
        id: candidate.id,
        status: "DISCARDED",
        resolved_at: new Date().toISOString(),
      },
      baseVersion: candidate.updated_at,
      blobRef: null,
    });
    void layer.sync.drain();
    onDone();
  }

  const flagged = (
    label: string,
    f: { value: string | null; confidence: number },
  ) => (
    <span className="t-meta flex items-center gap-1.5">
      {label}
      {check(f) && <span className="tag tag-danger">check this</span>}
    </span>
  );

  return (
    <div
      className="fixed inset-0 z-30 flex items-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl p-5"
        style={{ background: "var(--surface-page)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="t-title text-base">
          {candidate.source === "EMAIL_METADATA"
            ? "New lead — emailed you"
            : "New contact from a card"}
        </h2>
        {candidate.source === "EMAIL_METADATA" ? (
          <p className="t-sub mt-1">
            Someone outside your accounts wrote in. Only the sender details
            were read — never the message. Save them if they belong in your
            book.
          </p>
        ) : (
          <p className="t-sub mt-1">
            Read off the photo — anything marked
            <span className="tag tag-danger mx-1">check this</span>
            was hard to read. Fix it before saving.
          </p>
        )}

        {match && (
          <div className="card card-pad mt-3 flex items-center gap-3">
            <span className="row-body t-sub">
              <span className="t-title block">
                Looks like {match.name} — already in your contacts.
              </span>
              Same email address.
            </span>
            <button
              onClick={merge}
              disabled={busy}
              className="btn-secondary shrink-0"
            >
              It&apos;s them
            </button>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            {flagged("Name", fields.name)}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1">
            {flagged("Role", fields.job_title)}
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1">
            {flagged("Email", fields.email)}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
              inputMode="email"
            />
          </label>
          <label className="flex flex-col gap-1">
            {flagged("Phone", fields.phone)}
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="field"
              inputMode="tel"
            />
          </label>

          {fields.handwritten_notes && (
            <p className="t-sub">
              Written on the card: “{fields.handwritten_notes}”
            </p>
          )}

          <div className="section-head mt-1">
            <span className="t-section">Their company</span>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setAccountMode("existing")}
              className={accountMode === "existing" ? "tag tag-solid" : "tag"}
            >
              An account you have
            </button>
            <button
              type="button"
              onClick={() => setAccountMode("new")}
              className={accountMode === "new" ? "tag tag-solid" : "tag"}
            >
              New account
            </button>
          </div>

          {accountMode === "existing" ? (
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="field"
            >
              <option value="">Which account?</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                {flagged("Company name", fields.company)}
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="field"
                />
              </label>
              <div className="flex gap-2">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as AccountType)}
                  className="field flex-1"
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {humanize(t)}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="City"
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  className="field flex-1"
                />
              </div>
              <label className="flex flex-col gap-1">
                <span className="t-meta">How did you get to them?</span>
                <select
                  value={leadSource}
                  onChange={(e) =>
                    setLeadSource(e.target.value as LeadSource | "")
                  }
                  className="field"
                >
                  <option value="">Pick the source</option>
                  {quickSources.map((s) => (
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
            </>
          )}

          {error && (
            <p className="t-sub" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="btn-primary flex-1"
              style={{ maxWidth: "none" }}
            >
              Save contact
            </button>
            <button onClick={discard} className="btn-secondary" type="button">
              Throw away
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
