"use client";

// SAY IT — the one microphone (spec 2026-11-04-one-mic-design.md).
//
// Anything a rep says, about what happened or what to do, in one go: "Trained
// eight of them at Buffalo, they want the literature tomorrow, and call their
// buyer Monday at 2." Every utterance, spoken or typed, is a voice capture
// through the outbox — the path Log a visit proved offline (D57/D59) — and
// is read once for both halves (lib/voice/say.ts):
//
//   · with signal: written up on the spot. A visit opens the check-and-save
//     sheet (the same one Review uses) with its follow-ups and the bookings;
//     bookings alone come back as cards, each confirmed with one tap;
//   · without: saved on the phone, written up the moment the signal is back,
//     and waiting in Review.
//
// /say?visit=<id> (Home's "How did it go?") ties it to that planned visit;
// /say?account=<id> to an account. Nothing is written by the model: the
// person is the gate (D9).

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { BookingCard, bookingPayload, bookingProblem, type BookingCardState } from "@/components/booking-card";
import { DebriefSheet, type CaptureRow } from "@/components/debrief-sheet";
import { useOffline } from "@/components/offline-provider";
import { CheckIcon } from "@/components/icons";
import { displayAccountName } from "@/lib/format";
import { getOfflineLayer, type CachedAccount, type CachedAgendaItem } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CommandRep, CommandTeammate } from "@/lib/voice/command";
import { hasVisit, type SayStoredDraft } from "@/lib/voice/say";

type Phase = "idle" | "recording" | "working";

const MIME_CANDIDATES = [
  "audio/mp4", // iOS Safari — validate at capture, not upload (offline doc §6)
  "audio/webm;codecs=opus",
  "audio/webm",
];

const CAPTURE_COLS =
  "id, status, transcript, ai_draft, audio_path, created_at, updated_at, account_id, planned_action_id, activity_id";

/** How long to wait for the write-up before handing it to Review. */
const WAIT_MS = 30_000;

export default function SayPage() {
  return (
    <Suspense fallback={null}>
      <SayInner />
    </Suspense>
  );
}

function SayInner() {
  const { profile } = useOffline();
  const router = useRouter();
  const params = useSearchParams();
  const visitParam = params.get("visit");
  const accountParam = params.get("account");

  const [phase, setPhase] = useState<Phase>("idle");
  const [typed, setTyped] = useState("");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [cards, setCards] = useState<BookingCardState[]>([]);
  const [reps, setReps] = useState<CommandRep[]>([]);
  const [team, setTeam] = useState<CommandTeammate[]>([]);
  const [cached, setCached] = useState<CachedAccount[]>([]);
  const [agenda, setAgenda] = useState<CachedAgendaItem[]>([]);
  const [sheet, setSheet] = useState<CaptureRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cardsQueued, setCardsQueued] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const cardInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const layer = getOfflineLayer();
    void layer.local.getAccounts().then(setCached);
    void layer.local.getAgenda().then(setAgenda);
    return () => recorder.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  // The planned visit this was opened for, and its account.
  const planned = visitParam ? (agenda.find((i) => i.id === visitParam && !i.completed_at) ?? null) : null;
  const contextAccount = planned?.account_id ?? accountParam ?? null;
  const contextName = contextAccount ? cached.find((a) => a.id === contextAccount)?.name : undefined;

  const choices = useMemo(
    () => cached.map((a) => ({ id: a.id, name: displayAccountName(a.name) })),
    [cached],
  );

  // ── CAPTURE: the outbox first, then the write-up ─────────────────────────
  async function capture(input: { blob: Blob; mime: string; seconds: number } | { text: string }) {
    if (!profile) return;
    setError(null);
    setNotice(null);
    setCards([]);
    setTranscript(null);
    setPhase("working");
    const layer = getOfflineLayer();
    const id = crypto.randomUUID();
    try {
      if ("blob" in input) {
        const ext = input.mime.startsWith("audio/mp4") ? "m4a" : "webm";
        const audioPath = `${profile.orgId}/${profile.userId}/${id}.${ext}`;
        await layer.blobs.put(`voice::${audioPath}`, input.blob);
        await layer.sync.enqueue({
          clientId: id,
          entityType: "voice_capture",
          op: "create",
          payload: {
            id,
            org_id: profile.orgId,
            owner_id: profile.membershipId,
            audio_path: audioPath,
            duration_seconds: input.seconds,
            transcript: null,
            status: "UPLOADED", // the blob uploads before the row lands (D59)
            language: null,
            account_id: contextAccount,
            planned_action_id: planned?.id ?? null,
          },
          baseVersion: null,
          blobRef: `voice::${audioPath}`,
        });
      } else {
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
            transcript: input.text,
            status: "UPLOADED",
            language: null,
            account_id: contextAccount,
            planned_action_id: planned?.id ?? null,
          },
          baseVersion: null,
          blobRef: null,
        });
        setTyped("");
      }
    } catch {
      setPhase("idle");
      setError("Couldn't save that — try again.");
      return;
    }

    // Saved on the phone. From here on nothing can be lost: if the write-up
    // does not come back, Review takes it.
    const handOff = () =>
      setNotice(
        "Saved — it will be written up as soon as you're back online, and wait for you in Review.",
      );
    try {
      await layer.sync.drain();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), WAIT_MS);
      const res = await fetch("/api/voice/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ captureId: id }),
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer));
      const body = (await res.json()) as { drafts?: Record<string, SayStoredDraft> };
      const draft = body.drafts?.[id];
      if (!res.ok || !draft) return handOff();

      const { data: row } = await getSupabaseBrowserClient()
        .from("voice_captures")
        .select(CAPTURE_COLS)
        .eq("id", id)
        .maybeSingle();
      if (!row) return handOff();
      const saved = row as unknown as CaptureRow;
      setTranscript(saved.transcript);

      if (hasVisit(draft)) {
        // The visit and everything with it: one sheet, one Save.
        setSheet(saved);
        return;
      }
      const list = (draft.commands ?? []).map((c, i) => ({ ...c, key: `${id}-${i}`, done: false }));
      setReps(draft.reps ?? []);
      setTeam(draft.team ?? []);
      setCards(list);
      if (list.length === 0) setError("Nothing to log or book in that — try again.");
      // Bookings live on this screen now; the capture is done with, so it never
      // waits in Review as well.
      await layer.sync.enqueue({
        clientId: id,
        entityType: "voice_capture",
        op: "update",
        payload: { id, status: "REVIEWED", reviewed_at: new Date().toISOString() },
        baseVersion: saved.updated_at,
        blobRef: null,
      });
      void layer.sync.drain();
    } catch {
      handOff();
    } finally {
      setPhase("idle");
    }
  }

  async function start() {
    setError(null);
    const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        if (blob.size === 0) {
          setPhase("idle");
          setError("Nothing was recorded — try again, or type it.");
          return;
        }
        const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
        void capture({ blob, mime: type, seconds });
      };
      recorder.current = rec;
      startedAt.current = Date.now();
      rec.start();
      setPhase("recording");
    } catch {
      setError("No microphone here — type it instead.");
    }
  }

  function stop() {
    recorder.current?.stop();
    setPhase("working");
  }

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    if (!typed.trim()) return;
    void capture({ text: typed.trim() });
  }

  function patch(key: string, p: Partial<BookingCardState>) {
    setCards((cs) => cs.map((c) => (c.key === key ? { ...c, ...p } : c)));
  }

  async function confirm(card: BookingCardState) {
    if (!profile) return;
    setError(null);
    const problem = bookingProblem(card);
    if (problem) return setError(problem);
    if (card.kind === "QUOTE") {
      const say = encodeURIComponent(card.action);
      router.push(`/accounts/${card.accountId}/new-deal?stage=QUOTE&say=${say}`);
      return;
    }
    const id = crypto.randomUUID();
    const layer = getOfflineLayer();
    try {
      await layer.sync.enqueue({
        clientId: id,
        entityType: "next_action",
        op: "create",
        payload: bookingPayload(card, { id, orgId: profile.orgId, membershipId: profile.membershipId }),
        baseVersion: null,
        blobRef: null,
      });
      patch(card.key, { done: true });
      void layer.sync.drain();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // ── Business cards: snapped now, read later, confirmed in Review (D41–D43),
  // moved here from Log a visit so retiring it loses nothing.
  async function snapCards(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
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
      setCardsQueued((n) => n + files.length);
    } catch {
      setError("Couldn't keep that photo — try again.");
    }
  }

  return (
    <div className="stack pt-2">
      <section className="card card-pad flex flex-col items-center gap-3 text-center">
        <p className="t-title">Say what you need</p>
        {planned || contextName ? (
          <p className="t-sub">
            About {contextName ? displayAccountName(contextName) : "this visit"}
            {planned ? " — how did it go?" : ""}
          </p>
        ) : (
          <p className="t-sub">
            &ldquo;Trained eight at Buffalo, they want the literature tomorrow&rdquo; · &ldquo;Call
            Truckee Monday at 2&rdquo; · &ldquo;Quote Boise 2,000 feet of ipe 1x6&rdquo;
          </p>
        )}
        <div className="qvoice">
          <button
            type="button"
            className={`qvoice-btn${phase === "recording" ? " is-recording" : ""}`}
            aria-label={phase === "recording" ? "Stop — read what I said" : "Speak"}
            disabled={phase === "working"}
            onClick={() => (phase === "recording" ? stop() : void start())}
          >
            {phase === "working" ? (
              <span className="qvoice-dots" aria-hidden="true">
                …
              </span>
            ) : (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                <line x1="12" x2="12" y1="18" y2="22" />
              </svg>
            )}
          </button>
        </div>
        {phase === "recording" && (
          <p className="t-hint" style={{ color: "var(--danger)" }}>
            listening — tap to finish
          </p>
        )}
        {phase === "working" && <p className="t-hint">reading it…</p>}
        <form onSubmit={sendTyped} className="flex w-full gap-2">
          <input
            className="field flex-1"
            style={{ background: "var(--surface-page)" }}
            placeholder="…or type it"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            enterKeyHint="send"
          />
          <button type="submit" className="btn-secondary" disabled={phase === "working" || !typed.trim()}>
            Go
          </button>
        </form>
        <button type="button" className="t-action" onClick={() => cardInput.current?.click()}>
          Snap a business card
        </button>
        <input
          ref={cardInput}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => void snapCards(e)}
        />
        {cardsQueued > 0 && (
          <p className="t-hint">
            {cardsQueued} {cardsQueued === 1 ? "card" : "cards"} saved — the details wait for your OK in{" "}
            <Link href="/review" className="t-action">
              Review
            </Link>
            .
          </p>
        )}
      </section>

      {transcript && (
        <p className="t-hint px-1">
          Heard: &ldquo;{transcript}&rdquo;
        </p>
      )}

      {notice && (
        <p className="t-sub flex items-center gap-1.5 px-1">
          <CheckIcon size={16} /> {notice}
        </p>
      )}

      {/* One card per thing to book. On a phone they stack; on the desk they
          sit two to a row (Andre, 2026-11-03). */}
      {cards.length > 0 && (
        <div className="say-cards">
          {cards.map((c) => (
            <BookingCard
              key={c.key}
              card={c}
              choices={choices}
              reps={reps}
              team={team}
              mode="confirm"
              onPatch={(p) => patch(c.key, p)}
              onConfirm={() => void confirm(c)}
            />
          ))}
        </div>
      )}

      {error && (
        <p className="t-sub px-1" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      {sheet && (
        <DebriefSheet
          capture={sheet}
          accounts={cached}
          agenda={agenda}
          onClose={() => {
            // Closing without saving keeps it: it waits in Review.
            setSheet(null);
            setNotice("Kept — it waits for your OK in Review.");
          }}
          onDone={() => {
            setSheet(null);
            setNotice("Saved.");
          }}
        />
      )}
    </div>
  );
}
