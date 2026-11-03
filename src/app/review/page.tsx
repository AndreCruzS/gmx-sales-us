"use client";

// Review — the one inbox of things waiting on the rep's decision:
//   · notes the system wrote up, waiting for their OK (D9 — nothing becomes a
//     record without review; Send fans out through the outbox, D10)
//   · saves that didn't land (LWW conflicts / rejected writes, D61/D62) —
//     surfaced, never silently dropped
//
// WAITING ON THE REP'S DECISION IS THE POINT. WAITING ON THEIR BUTTON IS NOT.
// This screen used to show a voice note sitting under "Waiting to be written up"
// with a "Write them up now" button beneath it — so a rep who had just finished
// talking had to ask the system to listen. That is a seam in the one flow that
// has to have none: a rep records in a truck, in a yard, between visits, and the
// gap between saying it and seeing it is the whole product.
//
// The writing-up now starts by itself, the moment a note lands here. The button
// only comes back if that failed — which offline it will, and honestly should.

import { useCallback, useEffect, useRef, useState } from "react";
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
import { DebriefSheet, type CaptureRow } from "@/components/debrief-sheet";
import {
  getOfflineLayer,
  type CachedAccount,
  type CachedAgendaItem,
  type OutboxRecord,
} from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

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
  // Not "waiting to be written up" any more, because nothing is waiting: by the
  // time a row can be seen in this state the request is already out. A label that
  // says "waiting" invites the reader to look for the thing to press.
  UPLOADED: "Being written up…",
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
  const [agenda, setAgenda] = useState<CachedAgendaItem[]>([]);
  const [rejected, setRejected] = useState<OutboxRecord[]>([]);
  const [reviewing, setReviewing] = useState<CaptureRow | null>(null);
  const [reviewingCard, setReviewingCard] = useState<CandidateRow | null>(null);
  const [processing, setProcessing] = useState(false);
  const [reading, setReading] = useState(false);
  // Which captures and cards this screen has already offered to the model on its
  // own. A ref, not state: it must not cause a render, and it must survive the
  // reload that drafting triggers — otherwise a note the model cannot write up
  // would be sent back to it on every refresh, forever.
  const autoTried = useRef<Set<string>>(new Set());
  // Set only when the automatic attempt actually failed, which is what brings the
  // manual button back. Offline that is the honest state and the rep needs the
  // retry; online it should never be seen.
  const [autoFailed, setAutoFailed] = useState<"voice" | "cards" | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Ask the model to write up whatever is waiting, and say whether it managed to.
   *
   * `auto` is the difference between the system doing its job and the rep asking
   * it to, and it changes exactly one thing: an automatic run that fails stays
   * QUIET. The note is already saved and will be written the moment there is
   * signal, so a red error would be telling the rep something is broken when
   * nothing is. It raises the retry button instead, which is the only useful
   * thing to show and the thing they would have wanted anyway.
   *
   * Deliberately knows nothing about reloading. That is what lets it be stable,
   * which is what lets load() call it without the two becoming each other's
   * dependency — the caller reloads.
   */
  const postDraft = useCallback(async (auto: boolean) => {
    setProcessing(true);
    if (!auto) setError(null);
    try {
      const res = await fetch("/api/voice/process", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setAutoFailed((f) => (f === "voice" ? null : f));
      return true;
    } catch (err) {
      if (auto) setAutoFailed("voice");
      else setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setProcessing(false);
    }
  }, []);

  /** Same contract, for a photographed card. */
  const postCards = useCallback(async (auto: boolean) => {
    setReading(true);
    if (!auto) setError(null);
    try {
      const res = await fetch("/api/cards/process", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setAutoFailed((f) => (f === "cards" ? null : f));
      return true;
    } catch (err) {
      if (auto) setAutoFailed("cards");
      else setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setReading(false);
    }
  }, []);

  // load() needs to run again once the model has written something up, and it
  // cannot name itself inside its own definition. Held in a ref rather than
  // rebuilt on every render, which also keeps it out of its own dependency list.
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    const layer = getOfflineLayer();
    void layer.local.getAccounts().then(setAccounts);
    void layer.local.getAgenda().then(setAgenda);
    void layer.local.listRejected().then(setRejected);
    try {
      const supabase = getSupabaseBrowserClient();
      const [caps, cands] = await Promise.all([
        supabase
          .from("voice_captures")
          .select(
            "id, status, transcript, ai_draft, audio_path, created_at, updated_at, account_id, planned_action_id, activity_id",
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
      // ── The work starts here, not on a tap ────────────────────────────────
      //
      // Anything that arrived undrafted goes to the model now. Fired from load()
      // rather than from an effect on purpose: an effect watching `captures`
      // would be setting state in response to state it just set, which this
      // codebase's lint rules forbid for good reason — and it would race the
      // reload that drafting itself triggers.
      //
      // Each id is marked BEFORE the call, so a note the model cannot handle is
      // offered exactly once. Without that, a capture stuck at UPLOADED would be
      // resubmitted on every refresh and every pull.
      if (caps.data) {
        const undrafted = (caps.data as CaptureRow[]).filter(
          (c) => c.status === "UPLOADED" && !autoTried.current.has(c.id),
        );
        if (undrafted.length > 0) {
          for (const c of undrafted) autoTried.current.add(c.id);
          void postDraft(true).then((ok) => (ok ? loadRef.current() : undefined));
        }
      }
      // A photographed card is the same promise as a spoken note — something the
      // rep handed over and should not have to ask twice about. Same rule, same
      // guard; leaving one of the two behind a button would just move the seam.
      if (cands.data) {
        const unread = (cands.data as CandidateRow[]).filter(
          (c) => !c.extracted && !autoTried.current.has(c.id),
        );
        if (unread.length > 0) {
          for (const c of unread) autoTried.current.add(c.id);
          void postCards(true).then((ok) => (ok ? loadRef.current() : undefined));
        }
      }
    } catch {
      // offline — rejected saves still show; drafts need signal
    }
  }, [postDraft, postCards]);

  // Assigned in an effect, never during render: mutating a ref while rendering is
  // the kind of impurity this codebase's lint rules exist to catch. The first
  // load() runs from a timer, which fires after effects, so this is always set by
  // the time anything reads it.
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, status.lastPulledAt, status.rejected]);

  async function draftPending() {
    if (await postDraft(false)) await load();
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
    if (await postCards(false)) await load();
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
          {autoFailed === "cards" &&
            cardsUnread.some((c) => c.created_by === profile?.membershipId) && (
              <button
                onClick={() => void readCards()}
                disabled={reading}
                className="btn-secondary mt-2 w-full"
              >
                {reading ? "Reading…" : "Try reading them again"}
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
          {/* Only after the automatic attempt failed — offline, usually. Then it
              is not a step in the flow, it is the one useful thing on screen. */}
          {autoFailed === "voice" && inFlight.some((c) => c.status === "UPLOADED") && (
            <button
              onClick={() => void draftPending()}
              disabled={processing}
              className="btn-secondary mt-2 w-full"
            >
              {processing ? "Writing up…" : "Try writing them up again"}
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
        <DebriefSheet
          capture={reviewing}
          accounts={accounts}
          agenda={agenda}
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
    <span className="t-hint flex items-center gap-1.5">
      {label}
      {check(f) && <span className="tag tag-danger">check this</span>}
    </span>
  );

  return (
    <div
      className="sheet-overlay flex items-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="sheet-panel max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl p-5"
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
                <span className="t-hint">How did you get to them?</span>
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
