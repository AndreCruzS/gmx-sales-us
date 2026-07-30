"use client";

// Record — the one place a rep tells the system what happened. Voice or
// typed is a mode, not a destination.
//
// Three paths out of one screen, chosen by what the rep gives us:
//   · voice        → queued, drafted by the system, confirmed in Review (D9)
//   · note + account → saved as the activity directly (D45: one note + flag),
//                      linking the planned visit when there is one (D46)
//   · note alone   → same drafting path as voice, confirmed in Review
//
// Everything works offline: blobs and writes ride the outbox (D57/D59).

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { CheckIcon, FileIcon, MicrophoneIcon } from "@/components/icons";
import {
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  VISIT_OBJECTIVES,
  humanize,
  type ActivityOutcome,
  type ActivityType,
  type VisitObjective,
} from "@/lib/domain/enums";
import {
  getOfflineLayer,
  type CachedAccount,
  type CachedAgendaItem,
} from "@/lib/offline";

const MIME_CANDIDATES = [
  "audio/mp4", // iOS Safari — validate at capture, not upload (offline doc §6)
  "audio/webm;codecs=opus",
  "audio/webm",
];

// useSearchParams opts this tree into client-side rendering; a page-level
// Suspense boundary is required so `npm run build` doesn't fail the static
// prerender of this route (same guard as src/app/visits/page.tsx).
export default function RecordPage() {
  return (
    <Suspense fallback={null}>
      <RecordPageInner />
    </Suspense>
  );
}

function RecordPageInner() {
  const { profile } = useOffline();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Deep-link contracts (D46, task 5): Home's "How did it go?" card lands
  // with ?visit=<nextActionId> — the account isn't known yet, it's resolved
  // from the agenda once cached. Routine's rows land with
  // ?account=<accountId>&item=<nextActionId> — both are known up front.
  // Lazy initializers read the params once, on first render — no effect, no
  // cascading setState (mirrors visits/page.tsx).
  const [visitParam] = useState(() => searchParams.get("visit"));
  const [itemParam] = useState(() => searchParams.get("item"));
  const targetItemId = visitParam ?? itemParam;

  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [agenda, setAgenda] = useState<CachedAgendaItem[]>([]);
  const [accountQuery, setAccountQuery] = useState("");
  // "Log a visit here" on an account page lands with ?account=<id>; the
  // Routine deep link supplies it directly too.
  const [accountId, setAccountId] = useState<string | null>(
    () => searchParams.get("account"),
  );
  const [pickingAccount, setPickingAccount] = useState(false);
  const [linkPlanned, setLinkPlanned] = useState(true);
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType>("DEALER_VISIT");
  const [objective, setObjective] = useState<VisitObjective | "">("");
  const [objectiveDetail, setObjectiveDetail] = useState("");
  const [outcomes, setOutcomes] = useState<ActivityOutcome[]>([]);
  const [keyInfo, setKeyInfo] = useState("");

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [queuedVoice, setQueuedVoice] = useState(false);
  const [queuedCards, setQueuedCards] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cardInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // deferred so state lands from callbacks, never synchronously in the effect
    const t = setTimeout(() => {
      const layer = getOfflineLayer();
      void layer.local.getAccounts().then(setAccounts);
      void layer.local.getAgenda().then((items) => {
        setAgenda(items);
        // ?visit=<nextActionId>: the account isn't in the URL — resolve it
        // from the cached agenda item once it lands.
        if (visitParam) {
          const item = items.find((i) => i.id === visitParam);
          if (item?.account_id) setAccountId(item.account_id);
        }
      });
    }, 0);
    return () => clearTimeout(t);
  }, [visitParam]);

  const filtered = useMemo(() => {
    const q = accountQuery.trim().toLowerCase();
    if (!q) return accounts.slice(0, 6);
    return accounts.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 6);
  }, [accounts, accountQuery]);

  const selected = accounts.find((a) => a.id === accountId) ?? null;

  // D46: if the cached agenda holds an open item for this account, offer to
  // record this as that planned visit — linking and completing it. A
  // ?visit=<id> or ?item=<id> deep link names the exact agenda item; without
  // one, fall back to whatever open item matches the selected account.
  const plannedItem = useMemo(() => {
    if (targetItemId) {
      const exact = agenda.find(
        (i) => i.id === targetItemId && !i.completed_at,
      );
      if (exact) return exact;
    }
    return accountId
      ? (agenda.find((i) => i.account_id === accountId && !i.completed_at) ??
          null)
      : null;
  }, [agenda, accountId, targetItemId]);

  // D46: the link starts already-on for a pre-linked debrief; the checkbox
  // lets the rep turn it off before anything gets sent.
  const linkedPlannedActionId =
    linkPlanned && plannedItem ? plannedItem.id : null;

  // ── Voice: queued the moment recording stops ─────────────────────────────

  async function startRecording() {
    setError(null);
    setQueuedVoice(false);
    const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      setError("This device can't record audio — type your note instead.");
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
          setError("Nothing was recorded — try again, or type your note.");
          return;
        }
        if (!profile) return;
        const id = crypto.randomUUID();
        const ext = mime.startsWith("audio/mp4") ? "m4a" : "webm";
        const audioPath = `${profile.orgId}/${profile.userId}/${id}.${ext}`;
        const layer = getOfflineLayer();
        await layer.blobs.put(`voice::${audioPath}`, blob);
        await layer.sync.enqueue({
          clientId: id,
          entityType: "voice_capture",
          op: "create",
          payload: {
            id,
            org_id: profile.orgId,
            owner_id: profile.membershipId,
            audio_path: audioPath,
            duration_seconds: seconds,
            transcript: null,
            status: "UPLOADED", // the blob uploads before the row lands (D59)
            language: null, // server falls back to membership.debrief_language
            // D46 pre-link: whichever account is on-screen (deep-linked or
            // picked by the rep) rides along so the debrief keeps context.
            account_id: accountId,
            planned_action_id: linkedPlannedActionId,
          },
          baseVersion: null,
          blobRef: `voice::${audioPath}`,
        });
        void layer.sync.drain();
        setQueuedVoice(true);
      };
      recorderRef.current = recorder;
      recorder.start();
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setRecording(true);
    } catch {
      setError("Microphone unavailable — type your note instead.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }

  // ── Business cards: snapped now, read later, confirmed in Review ─────────
  // (D41–D43: the photo queues offline exactly like audio; the vision read
  // happens server-side; nothing becomes a contact without the rep's OK.)

  async function snapCards(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // same card can be retaken
    if (!files.length || !profile) return;
    setError(null);
    try {
      const layer = getOfflineLayer();
      for (const file of files) {
        const id = crypto.randomUUID();
        const ext = file.type === "image/png" ? "png" : "jpg";
        const path = `${profile.orgId}/cards/${id}.${ext}`;
        await layer.blobs.put(`cards::${path}`, file);
        await layer.sync.enqueue({
          clientId: id,
          entityType: "contact_candidate",
          op: "create",
          payload: {
            id,
            org_id: profile.orgId,
            created_by: profile.membershipId,
            source: "BUSINESS_CARD",
            raw_ref: path,
            status: "PENDING",
          },
          baseVersion: null,
          blobRef: `cards::${path}`,
        });
      }
      void layer.sync.drain();
      setQueuedCards((n) => n + files.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // ── Typed: direct save with an account, drafted without one ──────────────

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) {
      setError("You're signed out.");
      return;
    }
    if (!note.trim()) {
      setError("Say what happened — one line is enough.");
      return;
    }
    if (accountId && objective === "OTHER" && !objectiveDetail.trim()) {
      setError("A word on what the objective was.");
      return;
    }
    setBusy(true);
    setError(null);
    const layer = getOfflineLayer();

    try {
      if (!accountId) {
        // No account: same drafting path as voice — the system proposes the
        // account and details, the rep confirms in Review.
        const id = crypto.randomUUID();
        await layer.sync.enqueue({
          clientId: id,
          entityType: "voice_capture",
          op: "create",
          payload: {
            id,
            org_id: profile.orgId,
            owner_id: profile.membershipId,
            audio_path: null,
            duration_seconds: null,
            transcript: note.trim(),
            status: "UPLOADED",
            language: null,
            account_id: accountId,
            planned_action_id: linkedPlannedActionId,
          },
          baseVersion: null,
          blobRef: null,
        });
        void layer.sync.drain();
        router.push("/review");
        return;
      }

      const id = crypto.randomUUID();
      const linked = linkPlanned ? plannedItem : null;
      await layer.sync.enqueue({
        clientId: id,
        entityType: "activity",
        op: "create",
        payload: {
          id,
          org_id: profile.orgId,
          activity_type: activityType,
          primary_account_id: accountId,
          owner_id: profile.membershipId,
          occurred_at: new Date().toISOString(),
          // D46: planned_done when linked to an agenda item.
          was_planned: Boolean(linked),
          planned_action_id: linked?.id ?? null,
          objective: objective || (linked?.objective as typeof objective) || null,
          objective_detail: objectiveDetail.trim() || null,
          what_happened: note.trim(),
          key_information: keyInfo.trim() || null,
          outcomes,
          follow_up_required: followUp,
        },
        baseVersion: null,
        blobRef: null,
      });
      // Recording the planned visit completes its agenda item.
      if (linked) {
        await layer.sync.enqueue({
          clientId: linked.id,
          entityType: "next_action",
          op: "update",
          payload: { id: linked.id, completed_at: new Date().toISOString() },
          baseVersion: linked.updated_at, // D61: stale completion → Review
          blobRef: null,
        });
      }
      await layer.local.putLocalActivity({
        id,
        activity_type: activityType,
        primary_account_id: accountId,
        occurred_at: new Date().toISOString(),
        what_happened: note.trim(),
        follow_up_required: followUp,
        pendingSync: true,
      });
      void layer.sync.drain();
      router.push("/");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={submit} className="stack pt-2">
      {/* Voice first: a rep in a truck taps once, talks, taps again. Done. */}
      <section className="card card-pad flex flex-col gap-3">
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          className="btn-primary"
          style={
            recording
              ? { background: "var(--danger)", maxWidth: "none" }
              : { maxWidth: "none" }
          }
        >
          <MicrophoneIcon size={19} />
          {recording ? `Stop · ${seconds}s` : "Tap and talk"}
        </button>
        {queuedVoice ? (
          <p className="t-sub flex items-center gap-1.5">
            <CheckIcon size={14} style={{ color: "var(--accent)" }} />
            Saved. It gets written up for you — confirm it in{" "}
            <Link href="/review" className="t-action">
              Review
            </Link>
            .
          </p>
        ) : (
          <p className="t-meta">
            Talk like you&apos;d brief a colleague. Works with no signal — it
            uploads when you&apos;re back in coverage.
          </p>
        )}

        {/* Got a card in hand? It rides the same offline queue as audio. */}
        <input
          ref={cardInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={snapCards}
          className="hidden"
          aria-label="Photograph a business card"
        />
        <button
          type="button"
          onClick={() => cardInputRef.current?.click()}
          className="btn-secondary"
        >
          <FileIcon size={17} style={{ color: "var(--ink-secondary)" }} />
          Snap a business card
        </button>
        {queuedCards > 0 && (
          <p className="t-sub flex items-center gap-1.5">
            <CheckIcon size={14} style={{ color: "var(--accent)" }} />
            {queuedCards === 1 ? "1 card" : `${queuedCards} cards`} saved — the
            contact details get read off{" "}
            {queuedCards === 1 ? "it" : "them"} and wait for your OK in{" "}
            <Link href="/review" className="t-action">
              Review
            </Link>
            .
          </p>
        )}
      </section>

      {/* …or type it */}
      <section className="stack-tight flex flex-col gap-3">
        <textarea
          placeholder="…or type it. One line is enough."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="field"
        />

        {/* Account: optional. With it the note saves directly; without it the
            system drafts the details and Review is the safety net. */}
        {selected ? (
          <div className="row">
            <span className="row-body">
              <span className="t-title block truncate">{selected.name}</span>
              <span className="t-sub block truncate">
                {humanize(selected.account_type)}
                {selected.city ? ` · ${selected.city}` : ""}
              </span>
            </span>
            <button
              type="button"
              className="btn-quiet shrink-0"
              onClick={() => {
                setAccountId(null);
                setPickingAccount(true);
              }}
            >
              Change
            </button>
          </div>
        ) : pickingAccount ? (
          <div className="card overflow-hidden">
            <input
              autoFocus
              placeholder="Which account?"
              value={accountQuery}
              onChange={(e) => setAccountQuery(e.target.value)}
              className="field"
              style={{ borderRadius: 0, border: 0 }}
            />
            <ul>
              {filtered.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountId(a.id);
                      setPickingAccount(false);
                      setAccountQuery("");
                    }}
                    className="flex w-full items-baseline gap-2 px-4 py-3 text-left"
                    style={{ borderTop: "1px solid var(--rule)" }}
                  >
                    <span className="t-title">{a.name}</span>
                    <span className="t-meta">{humanize(a.account_type)}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <p className="t-sub px-4 py-3">
                  No saved accounts match — leave it off and the system will
                  figure out the account from your note.
                </p>
              )}
            </ul>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPickingAccount(true)}
            className="btn-secondary"
          >
            Attach the account (optional)
          </button>
        )}

        {/* D46: planned vs actual */}
        {plannedItem && (
          <label className="row cursor-pointer">
            <input
              type="checkbox"
              checked={linkPlanned}
              onChange={(e) => setLinkPlanned(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
            <span className="row-body t-sub">
              <span className="t-title block">This was the planned visit</span>
              {plannedItem.action}
            </span>
          </label>
        )}

        <label className="row cursor-pointer">
          <input
            type="checkbox"
            checked={followUp}
            onChange={(e) => setFollowUp(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-[var(--accent)]"
          />
          <span className="t-title">Needs a follow-up</span>
        </label>

        {selected && (
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="t-action text-left"
          >
            {showMore ? "Hide the detail" : "Add detail (optional)"}
          </button>
        )}

        {selected && showMore && (
          <div className="card card-pad flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="t-meta">What kind of contact</span>
              <select
                value={activityType}
                onChange={(e) =>
                  setActivityType(e.target.value as ActivityType)
                }
                className="field"
                style={{ background: "var(--surface-page)" }}
              >
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="t-meta">What you went there to do</span>
              <select
                value={objective}
                onChange={(e) =>
                  setObjective(e.target.value as VisitObjective | "")
                }
                className="field"
                style={{ background: "var(--surface-page)" }}
              >
                <option value="">—</option>
                {VISIT_OBJECTIVES.map((o) => (
                  <option key={o} value={o}>
                    {humanize(o)}
                  </option>
                ))}
              </select>
            </label>
            {objective === "OTHER" && (
              <input
                placeholder="What was the objective?"
                value={objectiveDetail}
                onChange={(e) => setObjectiveDetail(e.target.value)}
                className="field"
                style={{ background: "var(--surface-page)" }}
              />
            )}

            <fieldset className="flex flex-col gap-1.5">
              <span className="t-meta">What came out of it</span>
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
            </fieldset>

            <textarea
              placeholder="Anything worth remembering — pricing, staff changes, competitors…"
              value={keyInfo}
              onChange={(e) => setKeyInfo(e.target.value)}
              rows={2}
              className="field"
              style={{ background: "var(--surface-page)" }}
            />
          </div>
        )}

        {error && (
          <p className="t-sub" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        {note.trim() && (
          <>
            <button type="submit" disabled={busy} className="btn-primary">
              {selected ? `Save to ${selected.name}` : "Save note"}
            </button>
            <p className="t-meta">
              {selected
                ? "Saves straight to the account — offline too."
                : "No account attached — it gets written up and waits for your OK in Review."}
            </p>
          </>
        )}
      </section>
    </form>
  );
}
