"use client";

// The mic beside "Where does this stand?".
//
// Tap, talk like you'd brief a colleague, tap again — the note comes back as
// the one-or-two-line status the field wants, and lands IN the field where it
// can still be edited before anything is saved. A draft, like every AI output
// in this app: the person is the gate.
//
// Needs signal by nature (the summarising happens server-side), so the button
// simply reports failure and leaves typing as the path — it augments the
// field, never replaces it.

import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "recording" | "thinking";

export function StatusVoiceButton({
  onText,
}: {
  /** Receives the summarised status once the server answers. */
  onText: (status: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [failed, setFailed] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  // A recorder must not outlive the form it was speaking into.
  useEffect(() => {
    return () => {
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function start() {
    setFailed(false);
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
      // No mic, or no permission — the field is still a field.
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
      form.append("audio", blob, "status.webm");
      const res = await fetch("/api/voice/status", { method: "POST", body: form });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { status?: string };
      if (!body.status) throw new Error("empty");
      onText(body.status);
    } catch {
      setFailed(true);
    } finally {
      setPhase("idle");
    }
  }

  return (
    <span className="voice-status">
      <button
        type="button"
        className={`voice-status-btn${phase === "recording" ? " is-recording" : ""}`}
        aria-label={
          phase === "recording"
            ? "Stop and summarise"
            : phase === "thinking"
              ? "Summarising…"
              : "Speak the status instead"
        }
        disabled={phase === "thinking"}
        onClick={() => (phase === "recording" ? stop() : void start())}
      >
        {phase === "thinking" ? (
          <span className="voice-status-dots" aria-hidden="true">
            …
          </span>
        ) : (
          // The same microphone glyph language as Tap and talk.
          <svg
            width="18"
            height="18"
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
        <span className="t-hint" style={{ color: "var(--danger)" }}>
          listening — tap to finish
        </span>
      )}
      {phase === "thinking" && <span className="t-hint">summarising…</span>}
      {failed && phase === "idle" && (
        <span className="t-hint">couldn&rsquo;t hear that — type it instead</span>
      )}
    </span>
  );
}
