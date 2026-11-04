"use client";

// A PK follow-up's notes (spec 2026-11-02 §2.2): a log, oldest first, kept
// for good. Each entry says who and when; an edited one says so, and opens to
// the texts it replaced. Only the author may edit a note, nobody deletes one,
// and the database keeps the earlier text on every edit.

import { useState } from "react";
import type { PkNote } from "@/lib/domain/pk-follow-up";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ViaAgent } from "@/components/via-agent";

export type NoteVersion = { body: string; replaced_at: string };

const WHEN = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
/** "Nov 2, 9:14 AM". */
export function stampOf(iso: string): string {
  return WHEN.format(new Date(iso));
}

const COLS = "id, next_action_id, author_id, body, created_at, edited_at, created_via";

export function PkNotesLog({
  itemId,
  orgId,
  notes,
  versionsByNote,
  names,
  me,
  onNotes,
  onEdited,
}: {
  itemId: string;
  orgId: string;
  /** Oldest first. */
  notes: PkNote[];
  versionsByNote: Map<string, NoteVersion[]>;
  names: Map<string, string>;
  me: string;
  onNotes: (fn: (list: PkNote[]) => PkNote[]) => void;
  /** A note was edited: the earlier text is now on the server to be read back. */
  onEdited: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function add() {
    const body = draft.trim();
    if (!body || !orgId || busy) return;
    setBusy(true);
    // The author and the time are the database's: it stamps the signed-in member.
    const { data, error } = await getSupabaseBrowserClient()
      .from("next_action_notes")
      .insert({ org_id: orgId, next_action_id: itemId, body })
      .select(COLS)
      .single();
    setBusy(false);
    if (error || !data) {
      setFailed("That note was not saved. Try again.");
      return;
    }
    setFailed(null);
    setDraft("");
    // A re-read may have brought it in already: one row per id.
    onNotes((list) => [...list.filter((n) => n.id !== data.id), data as PkNote]);
  }

  async function save() {
    if (!editing || busy) return;
    const body = editing.body.trim();
    const old = notes.find((n) => n.id === editing.id);
    if (!body || !old || body === old.body) {
      setEditing(null);
      return;
    }
    setBusy(true);
    const { data, error } = await getSupabaseBrowserClient()
      .from("next_action_notes")
      .update({ body })
      .eq("id", editing.id)
      .select(COLS)
      .single();
    setBusy(false);
    if (error || !data) {
      setFailed("That edit was not saved. Try again.");
      return;
    }
    setFailed(null);
    setEditing(null);
    onNotes((list) => list.map((n) => (n.id === data.id ? (data as PkNote) : n)));
    onEdited();
  }

  return (
    <section>
      <h3 className="pkd-lbl">Notes · newest last · kept for good</h3>
      {notes.length === 0 ? (
        <p className="pkd-quiet">No notes yet.</p>
      ) : (
        <ol className="pkd-log">
          {notes.map((n) => {
            const earlier = versionsByNote.get(n.id) ?? [];
            const mine = n.author_id === me;
            return (
              <li key={n.id} className="pkd-entry">
                <p className="pkd-by">
                  <b>{names.get(n.author_id) ?? "Someone"}</b> ·{" "}
                  <span className="pkd-fig">{stampOf(n.created_at)}</span>
                  {n.created_via && (
                    <>
                      {" "}
                      · <ViaAgent via={n.created_via} />
                    </>
                  )}
                  {mine && editing?.id !== n.id && (
                    <button
                      type="button"
                      className="pkd-link"
                      onClick={() => setEditing({ id: n.id, body: n.body })}
                    >
                      Edit
                    </button>
                  )}
                </p>
                {editing?.id === n.id ? (
                  <form
                    className="pkd-noteform"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save();
                    }}
                  >
                    <textarea
                      className="pkd-select"
                      rows={3}
                      value={editing.body}
                      aria-label="Edit the note"
                      onChange={(e) => setEditing({ id: n.id, body: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <div className="pkd-row">
                      <button type="submit" className="pk-btn" disabled={busy}>
                        Save
                      </button>
                      <button type="button" className="pkd-link" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="pkd-text">{n.body}</p>
                )}
                {n.edited_at !== null && (
                  <details className="pkd-versions">
                    <summary>
                      edited <span className="pkd-fig">{stampOf(n.edited_at)}</span>
                      {earlier.length > 0 && " · earlier text kept"}
                    </summary>
                    {earlier.length > 0 && (
                      <ol>
                        {earlier.map((v, k) => (
                          <li key={k}>
                            <span className="pkd-fig">until {stampOf(v.replaced_at)}</span>
                            <p className="pkd-text">{v.body}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <form
        className="pkd-noteform"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <textarea
          className="pkd-select"
          rows={2}
          value={draft}
          placeholder="Add a note"
          aria-label="Add a note"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="pkd-row">
          <button type="submit" className="pk-btn" disabled={busy || !draft.trim()}>
            Add note
          </button>
        </div>
      </form>
      {failed && (
        <p className="pkd-error" role="alert">
          {failed}
        </p>
      )}
    </section>
  );
}
