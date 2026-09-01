"use client";

// The big mic on the quote — and its ENGINE ROOM.
//
// Tap, talk the quote through, tap again. What used to be a silent wait is
// now the show itself: the room narrates the real work as the server streams
// it — the transcript as it lands, every catalog search with its hit count,
// the draft arriving. No spinner theatre; every line on screen is a thing
// that actually happened, which is both the loading state this flow was
// missing and the technology made visible.
//
// Everything still lands in the form, editable. The rep stays the gate.

import { useEffect, useRef, useState } from "react";

export interface QuoteDraftLine {
  sku: string;
  random_length?: boolean;
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

type RoomEvent =
  | { type: "stage"; stage: "transcribing" | "reading" }
  | { type: "transcript"; text: string }
  | { type: "search"; query: string }
  | { type: "found"; query: string; count: number; top?: string | null }
  | { type: "draft"; draft: QuoteDraft }
  | { type: "error"; message: string };

type Phase = "idle" | "recording" | "working";

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function QuoteVoice({
  account,
  onDraft,
}: {
  account: string;
  onDraft: (draft: QuoteDraft) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function start() {
    setEvents([]);
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
      setEvents([{ type: "error", message: "no microphone — type it instead" }]);
    }
  }

  function stop() {
    recorder.current?.stop();
    setPhase("working");
  }

  async function send(blob: Blob) {
    try {
      const form = new FormData();
      form.append("audio", blob, "quote.webm");
      form.append("account", account);
      const res = await fetch("/api/voice/quote", { method: "POST", body: form });
      if (!res.ok || !res.body) throw new Error(String(res.status));

      // NDJSON, event by event — the room draws each line as it happens.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.trim()) continue;
          const ev = JSON.parse(part) as RoomEvent;
          setEvents((prev) => [...prev, ev]);
          if (ev.type === "draft") onDraft(ev.draft);
        }
      }
    } catch {
      setEvents((prev) => [
        ...prev,
        { type: "error", message: "couldn't draft from that — try again, or type it" },
      ]);
    } finally {
      setPhase("idle");
    }
  }

  // The room's reading of the raw event stream: searches pair with their
  // results, the last unfinished thing breathes.
  const draft = events.findLast?.((e) => e.type === "draft") as
    | Extract<RoomEvent, { type: "draft" }>
    | undefined;
  const rows: {
    key: string;
    text: string;
    sub?: string;
    state: "doing" | "done" | "error";
  }[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === "stage" && e.stage === "transcribing") {
      const heard = events.slice(i).some((x) => x.type === "transcript");
      rows.push({
        key: `t${i}`,
        text: "listening back…",
        state: heard ? "done" : "doing",
      });
    } else if (e.type === "transcript") {
      rows.push({ key: `h${i}`, text: "heard", sub: `“${e.text}”`, state: "done" });
    } else if (e.type === "stage" && e.stage === "reading") {
      const moved = events
        .slice(i + 1)
        .some((x) => x.type === "search" || x.type === "draft");
      rows.push({
        key: `r${i}`,
        text: "reading the note…",
        state: moved ? "done" : "doing",
      });
    } else if (e.type === "search") {
      const found = events
        .slice(i + 1)
        .find((x) => x.type === "found" && x.query === e.query) as
        | Extract<RoomEvent, { type: "found" }>
        | undefined;
      rows.push({
        key: `s${i}`,
        text: `catalog · “${e.query}”`,
        sub: found
          ? found.count > 0
            ? `${found.count} found${found.top ? ` · ${found.top}` : ""}`
            : "nothing under that name"
          : undefined,
        state: found ? "done" : "doing",
      });
    } else if (e.type === "draft") {
      const d = e.draft;
      const bits = [
        `${d.lines.length} ${d.lines.length === 1 ? "line" : "lines"}`,
        d.nextAction
          ? `follow-up${d.nextAction.due ? ` ${DAY.format(new Date(`${d.nextAction.due}T00:00:00`))}` : ""}`
          : null,
      ].filter(Boolean);
      rows.push({
        key: `d${i}`,
        text: `drafted — ${bits.join(" · ")}. Yours to edit.`,
        state: "done",
      });
    } else if (e.type === "error") {
      rows.push({ key: `e${i}`, text: e.message, state: "error" });
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
            : phase === "working"
              ? "Drafting the quote…"
              : "Talk the quote through"
        }
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

      {phase === "recording" && (
        <p className="t-hint" style={{ color: "var(--danger)" }}>
          listening — who wants what, sizes, quantities, what happens next.
          Tap to finish.
        </p>
      )}

      {(rows.length > 0 || phase === "working") && phase !== "recording" && (
        <div className="qvoice-room" aria-live="polite">
          {rows.map((r) => (
            <p key={r.key} className="qvoice-row" data-state={r.state}>
              <span className="qvoice-dot" aria-hidden="true" />
              <span className="qvoice-row-body">
                <span>{r.text}</span>
                {r.sub && <span className="qvoice-sub">{r.sub}</span>}
              </span>
            </p>
          ))}
          {draft && draft.draft.unmatched.length > 0 && (
            <p className="qvoice-row" data-state="error">
              <span className="qvoice-dot" aria-hidden="true" />
              <span className="qvoice-row-body">
                <span>couldn&rsquo;t find in the catalog</span>
                <span className="qvoice-sub">
                  {draft.draft.unmatched.join("; ")} — add these by hand
                </span>
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
