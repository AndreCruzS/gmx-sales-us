"use client";

// Review — the one inbox of things waiting on the rep's decision:
//   · notes the system wrote up, waiting for their OK (D9 — nothing becomes a
//     record without review; Send fans out through the outbox, D10)
//   · saves that didn't land (LWW conflicts / rejected writes, D61/D62) —
//     surfaced, never silently dropped

import { useCallback, useEffect, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { AlertIcon, ChevronDownIcon, XIcon } from "@/components/icons";
import {
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  humanize,
  type ActivityOutcome,
  type ActivityType,
} from "@/lib/domain/enums";
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
  const { status } = useOffline();
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [rejected, setRejected] = useState<OutboxRecord[]>([]);
  const [reviewing, setReviewing] = useState<CaptureRow | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const layer = getOfflineLayer();
    void layer.local.getAccounts().then(setAccounts);
    void layer.local.listRejected().then(setRejected);
    try {
      const { data } = await getSupabaseBrowserClient()
        .from("voice_captures")
        .select(
          "id, status, transcript, ai_draft, audio_path, created_at, updated_at",
        )
        .neq("status", "DISCARDED")
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setCaptures(data as CaptureRow[]);
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

  const toConfirm = captures.filter((c) => c.status === "DRAFTED");
  const inFlight = captures.filter(
    (c) => c.status === "UPLOADED" || c.status === "PROCESSING" || c.status === "queued…",
  );
  const failed = captures.filter((c) => c.status === "FAILED");
  const done = captures.filter((c) => c.status === "SENT").slice(0, 5);
  const quiet =
    toConfirm.length === 0 &&
    inFlight.length === 0 &&
    failed.length === 0 &&
    rejected.length === 0;

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
