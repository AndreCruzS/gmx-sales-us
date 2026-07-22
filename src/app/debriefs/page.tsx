"use client";

// Voice debrief (spec §5): record in the truck (offline-safe — the blob rides
// the outbox, D59), or type the note instead (same pipeline, no audio). The
// server drafts; NOTHING becomes a record until the rep reviews and sends
// (D9) — and Send fans out through the SAME outbox as manual capture (D10).

import { useCallback, useEffect, useRef, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import {
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  type ActivityOutcome,
  type ActivityType,
} from "@/lib/domain/enums";
import type { DebriefDraft } from "@/lib/voice/draft";
import { getOfflineLayer, type CachedAccount } from "@/lib/offline";
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

const MIME_CANDIDATES = [
  "audio/mp4", // iOS Safari — validate at capture, not upload (offline doc §6)
  "audio/webm;codecs=opus",
  "audio/webm",
];

export default function DebriefsPage() {
  const { profile, status } = useOffline();
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [typed, setTyped] = useState("");
  const [reviewing, setReviewing] = useState<CaptureRow | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    void getOfflineLayer().local.getAccounts().then(setAccounts);
    const { data } = await getSupabaseBrowserClient()
      .from("voice_captures")
      .select("id, status, transcript, ai_draft, audio_path, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setCaptures(data as CaptureRow[]);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, status.lastPulledAt]);

  async function enqueueCapture(fields: {
    audioPath: string | null;
    blobRef: string | null;
    transcript: string | null;
    duration: number | null;
  }) {
    if (!profile) return;
    const id = crypto.randomUUID();
    const layer = getOfflineLayer();
    await layer.sync.enqueue({
      clientId: id,
      entityType: "voice_capture",
      op: "create",
      payload: {
        id,
        org_id: profile.orgId,
        owner_id: profile.membershipId,
        audio_path: fields.audioPath,
        duration_seconds: fields.duration,
        transcript: fields.transcript,
        status: "UPLOADED", // blob (if any) uploads before the row lands (D59)
        language: null, // server falls back to membership.debrief_language (Q7)
      },
      baseVersion: null,
      blobRef: fields.blobRef,
    });
    setCaptures((prev) => [
      {
        id,
        status: "queued…",
        transcript: fields.transcript,
        ai_draft: null,
        audio_path: fields.audioPath,
        created_at: new Date().toISOString(),
        updated_at: "",
      },
      ...prev,
    ]);
    void layer.sync.drain().then(load);
  }

  async function startRecording() {
    setError(null);
    const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      setError("Recording is not supported on this device — type the debrief instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size === 0) {
          setError("Nothing was recorded — try again or type the debrief.");
          return;
        }
        if (!profile) return;
        const id = crypto.randomUUID();
        const ext = mime.startsWith("audio/mp4") ? "m4a" : "webm";
        const audioPath = `${profile.orgId}/${profile.userId}/${id}.${ext}`;
        await getOfflineLayer().blobs.put(`voice::${audioPath}`, blob);
        await enqueueCapture({
          audioPath,
          blobRef: `voice::${audioPath}`,
          transcript: null,
          duration: seconds,
        });
      };
      recorderRef.current = recorder;
      recorder.start();
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setRecording(true);
    } catch {
      setError("Microphone unavailable — type the debrief instead.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }

  async function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    if (!typed.trim()) return;
    await enqueueCapture({
      audioPath: null,
      blobRef: null,
      transcript: typed.trim(),
      duration: null,
    });
    setTyped("");
  }

  async function processPending() {
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

  const hasUploaded = captures.some((c) => c.status === "UPLOADED");

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Voice debrief</h1>

      <div className="flex flex-col gap-3 rounded-2xl border border-black/10 p-4 dark:border-white/15">
        <button
          onClick={recording ? stopRecording : startRecording}
          className={`rounded-2xl px-5 py-4 text-lg font-semibold ${
            recording
              ? "bg-red-600 text-white"
              : "bg-amber-500 text-black"
          }`}
        >
          {recording ? `■ Stop (${seconds}s)` : "● Record debrief"}
        </button>
        <form onSubmit={submitTyped} className="flex flex-col gap-2">
          <textarea
            placeholder="…or type the debrief (same pipeline, no audio)"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            rows={2}
            className="rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          />
          {typed.trim() && (
            <button
              type="submit"
              className="rounded-xl border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-600"
            >
              Queue typed debrief
            </button>
          )}
        </form>
        <p className="text-xs opacity-50">
          Works offline — the recording is queued and uploads when you have
          signal. Nothing reaches your manager without your review.
        </p>
      </div>

      {hasUploaded && (
        <button
          onClick={processPending}
          disabled={processing}
          className="rounded-xl border border-black/15 px-4 py-3 text-sm font-medium disabled:opacity-50 dark:border-white/20"
        >
          {processing ? "Drafting…" : "Draft my pending debriefs (AI)"}
        </button>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="flex flex-col gap-2">
        {captures.map((c) => (
          <li
            key={c.id}
            className="rounded-xl border border-black/10 px-4 py-3 text-sm dark:border-white/15"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs opacity-60">
                {new Date(c.created_at).toLocaleString()}
                {c.audio_path ? " · audio" : " · typed"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  c.status === "DRAFTED"
                    ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                    : c.status === "SENT"
                      ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
                      : c.status === "FAILED"
                        ? "bg-red-600/15 text-red-600"
                        : "bg-black/10 dark:bg-white/10"
                }`}
              >
                {c.status}
              </span>
            </div>
            {c.transcript && (
              <p className="mt-1 line-clamp-2 opacity-70">{c.transcript}</p>
            )}
            {c.status === "FAILED" && c.ai_draft?.error && (
              <p className="mt-1 text-xs text-red-600">{c.ai_draft.error}</p>
            )}
            {c.status === "DRAFTED" && (
              <button
                onClick={() => setReviewing(c)}
                className="mt-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black"
              >
                Review &amp; send
              </button>
            )}
          </li>
        ))}
        {captures.length === 0 && (
          <p className="text-sm opacity-60">No debriefs yet.</p>
        )}
      </ul>

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
      setError("Attach the account — everything hangs off it.");
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
              // D48 constraint: OTHER requires objective_detail — a draft
              // can't supply it, so drop OTHER rather than trip the check.
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
    <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-[var(--background)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Review draft</h2>
        <p className="mt-1 text-xs opacity-60">{draft.summary}</p>

        {capture.transcript && (
          <details className="mt-2 text-xs opacity-70">
            <summary className="cursor-pointer">Transcript</summary>
            <p className="mt-1">{capture.transcript}</p>
          </details>
        )}

        <div className="mt-4 flex flex-col gap-3 text-sm">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
          >
            <option value="">Attach account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            value={activityType}
            onChange={(e) => setActivityType(e.target.value as ActivityType)}
            className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>

          <textarea
            value={whatHappened}
            onChange={(e) => setWhatHappened(e.target.value)}
            rows={3}
            className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
          />
          <textarea
            placeholder="Key information learned"
            value={keyInfo}
            onChange={(e) => setKeyInfo(e.target.value)}
            rows={2}
            className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
          />
          <input
            placeholder="Commercial potential"
            value={potential}
            onChange={(e) => setPotential(e.target.value)}
            className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
          />

          <div className="flex flex-wrap gap-2">
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
                  className={`rounded-full border px-3 py-1 text-xs ${
                    on
                      ? "border-amber-500 bg-amber-500/15 font-medium"
                      : "border-black/15 dark:border-white/20"
                  }`}
                >
                  {o.replaceAll("_", " ")}
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={followUp}
              onChange={(e) => setFollowUp(e.target.checked)}
              className="h-4 w-4 accent-amber-500"
            />
            Needs follow-up
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase opacity-60">
              Next actions
            </span>
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
                  className="min-w-0 flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
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
                  className="rounded-lg border border-black/15 bg-transparent px-2 py-2 dark:border-white/20"
                />
                <button
                  onClick={() =>
                    setActions((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="text-red-600"
                >
                  ✕
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
              className="text-left text-xs font-medium text-amber-600"
            >
              + Add next action
            </button>
          </div>

          {error && <p className="text-red-600">{error}</p>}

          <div className="mt-2 flex gap-2">
            <button
              onClick={send}
              disabled={busy}
              className="flex-1 rounded-xl bg-amber-500 px-4 py-3 font-semibold text-black disabled:opacity-50"
            >
              Send — creates the activity
            </button>
            <button
              onClick={discard}
              className="rounded-xl border border-black/15 px-4 py-3 dark:border-white/20"
            >
              Discard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
