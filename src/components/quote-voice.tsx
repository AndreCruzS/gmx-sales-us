"use client";

// The big mic on the quote: "What is this quote about?"
//
// This is the quote's front door for a rep standing at a counter: hold forth
// the way you would brief a colleague — who wants what, sizes, quantities,
// what happens next — and the system DRAFTS the survey: it searches the real
// catalog while it listens, fills the product lines, the status, the next
// action. Everything lands in the form, editable; the rep stays the gate.
//
// Deliberately larger than the status mic elsewhere: on this form the voice
// is not a convenience beside a field, it is the fastest way to build the
// whole thing.

import { useEffect, useRef, useState } from "react";

export interface QuoteDraftLine {
  sku: string;
  description: string;
  species: string | null;
  profile: string | null;
  nominal_size: string | null;
  lf_per_piece: number | null;
  quantity: number;
  uom: "PC" | "LF";
}

export interface QuoteDraft {
  status: string;
  lines: QuoteDraftLine[];
  unmatched: string[];
  nextAction: { text: string; due: string | null } | null;
  expectedClose: string | null;
}

type Phase = "idle" | "recording" | "thinking";

export function QuoteVoice({
  account,
  onDraft,
}: {
  account: string;
  onDraft: (draft: QuoteDraft) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [failed, setFailed] = useState(false);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function start() {
    setFailed(false);
    setUnmatched([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void send(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
      };
      recorder.current = rec;
      rec.start();
      setPhase("recording");
    } catch {
      setFailed(true);
    }
  }

  function stop() {
    recorder.current?.stop();
    setPhase("thinking");
  }

  async function send(blob: Blob) {
    try {
      const form = new FormData();
      form.append("audio", blob, "quote.webm");
      form.append("account", account);
      const res = await fetch("/api/voice/quote", { method: "POST", body: form });
      if (!res.ok) throw new Error(String(res.status));
      const draft = (await res.json()) as QuoteDraft;
      setUnmatched(draft.unmatched ?? []);
      onDraft(draft);
    } catch {
      setFailed(true);
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className="qvoice">
      <button
        type="button"
        className={`qvoice-btn${phase === "recording" ? " is-recording" : ""}`}
        aria-label={
          phase === "recording"
            ? "Stop — draft the quote from what you said"
            : phase === "thinking"
              ? "Drafting the quote…"
              : "Talk the quote through"
        }
        disabled={phase === "thinking"}
        onClick={() => (phase === "recording" ? stop() : void start())}
      >
        {phase === "thinking" ? (
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
      {phase === "recording" && (
        <p className="t-hint" style={{ color: "var(--danger)" }}>
          listening — who wants what, sizes, quantities, what happens next.
          Tap to finish.
        </p>
      )}
      {phase === "thinking" && (
        <p className="t-hint">drafting — searching the catalog for what you said…</p>
      )}
      {failed && phase === "idle" && (
        <p className="t-hint">couldn&rsquo;t draft from that — try again, or type it</p>
      )}
      {unmatched.length > 0 && phase === "idle" && (
        <p className="t-hint" style={{ color: "var(--warn-ink)" }}>
          Couldn&rsquo;t find in the catalog: {unmatched.join("; ")} — add these
          by hand.
        </p>
      )}
    </div>
  );
}
