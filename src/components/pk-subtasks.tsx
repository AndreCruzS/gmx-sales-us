"use client";

// A PK follow-up's checklist (spec 2026-11-02 §2.6): tick, add, remove. Each
// subtask counts in the PK's % on the board, so the board moves on the tick;
// the write goes straight to Supabase and, if it fails, the tick goes back
// with one line saying so.

import { useState } from "react";
import type { PkSubtask } from "@/lib/domain/pk-follow-up";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function PkSubtasks({
  itemId,
  orgId,
  subtasks,
  onSubtasks,
  readOnly = false,
}: {
  itemId: string;
  orgId: string;
  subtasks: PkSubtask[];
  onSubtasks: (fn: (list: PkSubtask[]) => PkSubtask[]) => void;
  /** Someone else's item: the list shows, nothing ticks, nothing is added. */
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const done = subtasks.filter((s) => s.done_at !== null).length;

  async function toggle(s: PkSubtask) {
    const before = s.done_at;
    const after = before === null ? new Date().toISOString() : null;
    onSubtasks((list) => list.map((x) => (x.id === s.id ? { ...x, done_at: after } : x)));
    const { error } = await getSupabaseBrowserClient()
      .from("next_action_subtasks")
      .update({ done_at: after })
      .eq("id", s.id);
    if (error) {
      onSubtasks((list) => list.map((x) => (x.id === s.id ? { ...x, done_at: before } : x)));
      setFailed("That tick was not saved. Try again.");
    } else setFailed(null);
  }

  async function add() {
    const title = draft.trim();
    if (!title || !orgId) return;
    const row: PkSubtask = {
      id: crypto.randomUUID(),
      next_action_id: itemId,
      title,
      done_at: null,
      position: subtasks.reduce((m, s) => Math.max(m, s.position), -1) + 1,
    };
    setDraft("");
    onSubtasks((list) => [...list, row]);
    const { error } = await getSupabaseBrowserClient()
      .from("next_action_subtasks")
      .insert({ org_id: orgId, ...row });
    if (error) {
      onSubtasks((list) => list.filter((x) => x.id !== row.id));
      setDraft(title);
      setFailed("That subtask was not saved. Try again.");
    } else setFailed(null);
  }

  async function remove(s: PkSubtask) {
    onSubtasks((list) => list.filter((x) => x.id !== s.id));
    const { error } = await getSupabaseBrowserClient().from("next_action_subtasks").delete().eq("id", s.id);
    if (error) {
      onSubtasks((list) => [...list, s].sort((a, b) => a.position - b.position));
      setFailed("That subtask could not be removed. Try again.");
    } else setFailed(null);
  }

  return (
    <section>
      <h3 className="pkd-lbl">
        Subtasks
        {subtasks.length > 0 && (
          <>
            {" · "}
            {done} of {subtasks.length}
          </>
        )}
      </h3>
      {readOnly && subtasks.length === 0 && <p className="pkd-quiet">No subtasks.</p>}
      {readOnly && subtasks.length > 0 && (
        <ul className="pkd-checks pkd-checks-ro">
          {subtasks.map((s) => (
            <li key={s.id}>
              <span className="pkd-tick" data-done={s.done_at !== null || undefined} aria-hidden="true">
                {s.done_at !== null ? "✓" : ""}
              </span>
              <span data-done={s.done_at !== null || undefined}>
                {s.title}
                <span className="sr-only">{s.done_at !== null ? " (done)" : " (not done)"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!readOnly && subtasks.length > 0 && (
        <ul className="pkd-checks">
          {subtasks.map((s) => (
            <li key={s.id}>
              <label>
                <input type="checkbox" checked={s.done_at !== null} onChange={() => void toggle(s)} />
                <span data-done={s.done_at !== null || undefined}>{s.title}</span>
              </label>
              <button
                type="button"
                className="pkd-x pkd-x-small"
                aria-label={`Remove ${s.title}`}
                onClick={() => void remove(s)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
      <form
        className="pkd-addsub"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="pkd-select"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="+ Add a subtask"
          aria-label="Add a subtask"
        />
        {draft.trim() && (
          <button type="submit" className="pk-btn">
            Add
          </button>
        )}
      </form>
      )}
      {failed && (
        <p className="pkd-error" role="alert">
          {failed}
        </p>
      )}
    </section>
  );
}
