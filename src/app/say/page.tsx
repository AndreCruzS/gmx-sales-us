"use client";

// SAY IT — one sentence from the add menu, a card per thing it asked for.
//
// "Book me Ganahl Anaheim Thursday to collect the quote and remind me to call
// Truckee Monday" comes back as two cards, each filled and editable, each
// written with one tap through the outbox like any form. A quote card hands
// what was said to the quote's own engine room on the account. Nothing is
// written by the model (lib/voice/command.ts): the person is the gate.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { CheckIcon } from "@/components/icons";
import { VISIT_OBJECTIVES, humanize, type VisitObjective } from "@/lib/domain/enums";
import { displayAccountName } from "@/lib/format";
import { getOfflineLayer, type CachedAccount } from "@/lib/offline";
import type { Command, CommandAccount, CommandRep } from "@/lib/voice/command";

type Phase = "idle" | "recording" | "working";

interface Card extends Command {
  key: string;
  done: boolean;
}

const KIND_LABEL: Record<Command["kind"], string> = {
  VISIT: "Visit",
  FOLLOW_UP: "Follow-up",
  QUOTE: "Quote",
};

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

export default function SayPage() {
  const { profile } = useOffline();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [typed, setTyped] = useState("");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [shown, setShown] = useState<CommandAccount[]>([]);
  const [reps, setReps] = useState<CommandRep[]>([]);
  const [cached, setCached] = useState<CachedAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    void getOfflineLayer().local.getAccounts().then(setCached);
    return () => recorder.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  // What the account picker offers: the doors the sentence matched first,
  // then the rest of the working set.
  const choices = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const a of [...shown, ...cached]) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ id: a.id, name: displayAccountName(a.name) });
    }
    return out;
  }, [shown, cached]);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const form = new FormData();
        form.append("audio", new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }), "say.webm");
        void ask(form);
      };
      recorder.current = rec;
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

  async function ask(form: FormData) {
    setPhase("working");
    setCards([]);
    setError(null);
    try {
      const res = await fetch("/api/voice/command", { method: "POST", body: form });
      const body = (await res.json()) as {
        transcript?: string;
        commands?: Command[];
        accounts?: CommandAccount[];
        reps?: CommandRep[];
        error?: string;
      };
      if (body.transcript) setTranscript(body.transcript);
      if (!res.ok) throw new Error(body.error ?? String(res.status));
      setShown(body.accounts ?? []);
      setReps(body.reps ?? []);
      const list = (body.commands ?? []).map((c, i) => ({ ...c, key: `${Date.now()}-${i}`, done: false }));
      setCards(list);
      if (list.length === 0) setError("Nothing to book or chase in that — try again.");
    } catch {
      setError("Couldn't read that — try again, or type it.");
    } finally {
      setPhase("idle");
    }
  }

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    if (!typed.trim()) return;
    const form = new FormData();
    form.append("text", typed.trim());
    void ask(form);
  }

  function patch(key: string, p: Partial<Card>) {
    setCards((cs) => cs.map((c) => (c.key === key ? { ...c, ...p } : c)));
  }

  async function confirm(card: Card) {
    if (!profile) return;
    setError(null);
    if (card.kind === "QUOTE") {
      if (!card.accountId) return setError("Which account is the quote for?");
      const say = encodeURIComponent(card.action);
      router.push(`/accounts/${card.accountId}/new-deal?stage=QUOTE&say=${say}`);
      return;
    }
    if (!card.accountId) return setError("Pick the account first.");
    if (!card.dueDate) return setError("Pick the day.");
    if (card.kind === "VISIT" && !card.objective) return setError("Every visit has a purpose — pick it.");
    const id = crypto.randomUUID();
    const layer = getOfflineLayer();
    try {
      await layer.sync.enqueue({
        clientId: id,
        entityType: "next_action",
        op: "create",
        payload: {
          id,
          org_id: profile.orgId,
          action: card.action.trim(),
          owner_id: card.ownerId ?? profile.membershipId,
          due_date: card.dueDate,
          account_id: card.accountId,
          ...(card.kind === "VISIT" ? { objective: card.objective, kind: "VISIT" } : {}),
        },
        baseVersion: null,
        blobRef: null,
      });
      patch(card.key, { done: true });
      void layer.sync.drain();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="stack pt-2">
      <section className="card card-pad flex flex-col items-center gap-3 text-center">
        <p className="t-title">Say what you need</p>
        <p className="t-sub">
          &ldquo;Book Ganahl Anaheim Thursday to collect the quote&rdquo; · &ldquo;Remind me to call
          Truckee Monday&rdquo; · &ldquo;Quote Boise 2,000 feet of ipe 1x6&rdquo;
        </p>
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
      </section>

      {transcript && (
        <p className="t-hint px-1">
          Heard: &ldquo;{transcript}&rdquo;
        </p>
      )}

      {cards.map((c) => (
        <section key={c.key} className="card card-pad flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="t-meta uppercase tracking-wide">{KIND_LABEL[c.kind]}</p>
            {c.dueDate && <p className="t-meta">{DAY.format(new Date(`${c.dueDate}T12:00:00`))}</p>}
          </div>
          {c.done ? (
            <p className="t-sub flex items-center gap-1.5">
              <CheckIcon size={16} /> {c.kind === "VISIT" ? "On the agenda" : "Added"} — {c.action}
            </p>
          ) : (
            <>
              <select
                className="field"
                style={{ background: "var(--surface-page)" }}
                value={c.accountId ?? ""}
                onChange={(e) => patch(c.key, { accountId: e.target.value || null })}
              >
                <option value="">
                  {c.accountHeard ? `Which account? (heard “${c.accountHeard}”)` : "Which account?"}
                </option>
                {choices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <input
                className="field"
                style={{ background: "var(--surface-page)" }}
                value={c.action}
                onChange={(e) => patch(c.key, { action: e.target.value })}
                aria-label={c.kind === "QUOTE" ? "What they want" : "What to do"}
              />
              {c.kind !== "QUOTE" && (
                <input
                  type="date"
                  className="field"
                  style={{ background: "var(--surface-page)" }}
                  value={c.dueDate ?? ""}
                  onChange={(e) => patch(c.key, { dueDate: e.target.value || null })}
                  aria-label="Which day"
                />
              )}
              {c.kind === "VISIT" && (
                <select
                  className="field"
                  style={{ background: "var(--surface-page)" }}
                  value={c.objective ?? ""}
                  onChange={(e) => patch(c.key, { objective: (e.target.value || null) as VisitObjective | null })}
                >
                  <option value="">Why are you going?</option>
                  {VISIT_OBJECTIVES.filter((o) => o !== "OTHER").map((o) => (
                    <option key={o} value={o}>
                      {humanize(o)}
                    </option>
                  ))}
                </select>
              )}
              {reps.length > 0 && c.kind !== "QUOTE" && (
                <select
                  className="field"
                  style={{ background: "var(--surface-page)" }}
                  value={c.ownerId ?? ""}
                  onChange={(e) => patch(c.key, { ownerId: e.target.value || null })}
                  aria-label="Whose is it"
                >
                  <option value="">For me</option>
                  {reps.map((r) => (
                    <option key={r.membershipId} value={r.membershipId}>
                      For {r.name}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn-primary mt-1" onClick={() => void confirm(c)}>
                {c.kind === "VISIT" ? "Book it" : c.kind === "QUOTE" ? "Draft the quote" : "Add it"}
              </button>
            </>
          )}
        </section>
      ))}

      {error && (
        <p className="t-sub px-1" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
