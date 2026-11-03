"use client";

// PK FOLLOW-UP — the board itself, shared by two routes (spec 2026-11-02, and
// 2026-11-03 for reps): /dealers/pk for the desk, under the Dealers tabs, and
// /visits/pk for a rep, under the Agenda tabs. What each reader sees is RLS's
// call — every PK for the desk, a rep's own PKs in full plus the band of any
// item handed to him; this file only decides which controls to offer.
//
// Read top to bottom:
//   · the six figures — PKs with something open, follow-ups not done, alerts
//     passed, what is on us, what waits on them, what is new for the reader;
//   · the toolbar — search, owner, Action required, unread only, show done;
//   · one band per PK, newest first: the dealer, the PK date and place, how far
//     along it is, what is late and what is new; under it the follow-ups, and
//     at its foot "+ Add action" for something that came up after the visit.
//
// A PK is an activity of type PK_TRAINING; its follow-ups are the next_actions
// that point at it. The alert is written into due_date when the priority is
// picked (pk-follow-up.ts), so the home page and the agenda read the same day.
//
// A row opens the item in the drawer (pk-item-drawer.tsx), beside the board on
// the desk. The page keeps every list; the drawer edits them through the
// updaters below, and after a write it asks the page to read the one item
// back (refreshItem) so the board shows what the database saved.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useOffline } from "@/components/offline-provider";
import { PkBoard } from "@/components/pk-board";
import { PkExportButton } from "@/components/pk-export-button";
import { PkItemDrawer } from "@/components/pk-item-drawer";
import type { NoteVersion } from "@/components/pk-notes-log";
import {
  canEditItem,
  pkDateOf,
  type PkBand,
  type PkItem,
  type PkNote,
  type PkRead,
  type PkSubtask,
} from "@/lib/domain/pk-follow-up";
import { seesDealersBoard } from "@/lib/domain/roles";
import { nextActionCreateSchema } from "@/lib/domain/schemas";
import { displayAccountName } from "@/lib/format";
import { getOfflineLayer } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/page";

const ITEM_COLS =
  "id, action, owner_id, due_date, completed_at, priority, priority_days, progress, last_changed_by, last_changed_at, updated_at, account_id, activity_id";

/** Ids per `.in()` request — enough to be few trips, short enough for a URL. */
const CHUNK = 200;

interface PkVisit {
  id: string;
  owner_id: string;
  occurred_at: string;
  location: string | null;
  primary_account_id: string;
  account: { name: string } | null;
}

type ItemRow = PkItem & { account_id: string | null; activity_id: string };

interface MemberName {
  id: string;
  full_name: string | null;
  role: string;
  status: string;
}

const NOTE_COLS = "id, next_action_id, author_id, body, created_at, edited_at";
const SUB_COLS = "id, next_action_id, title, done_at, position";
const READ_COLS = "membership_id, next_action_id, last_read_at";

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function plusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Every row whose `next_action_id` (or `activity_id`) is in `ids`, CHUNK at a time. */
async function inChunks<T>(
  ids: string[],
  read: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await read(ids.slice(i, i + CHUNK))));
  return out;
}

/**
 * `title` is the page's heading and its tabs, which differ by route.
 */
export function PkFollowUpView({ title }: { title: ReactNode }) {

  const { profile } = useOffline();
  const desk = seesDealersBoard(profile?.role);
  const me = profile?.membershipId ?? "";

  const [visits, setVisits] = useState<PkVisit[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [notes, setNotes] = useState<PkNote[]>([]);
  const [subtasks, setSubtasks] = useState<PkSubtask[]>([]);
  const [reads, setReads] = useState<PkRead[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  // The desk's members: "Seen" lists them even before they open an item.
  const [deskIds, setDeskIds] = useState<string[]>([]);
  const [versions, setVersions] = useState<Map<string, NoteVersion[]>>(new Map());
  // Stamped when the data lands, never read from the clock during a render.
  const [todayIso, setTodayIso] = useState("");
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [addFailed, setAddFailed] = useState(false);

  // The open item: the drawer hangs on this.
  const [openId, setOpenId] = useState<string | null>(null);
  const onOpen = useCallback((id: string) => setOpenId(id), []);
  const onClose = useCallback(() => setOpenId(null), []);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [vs, ms] = await Promise.all([
      // Newest PK first: the board's order.
      fetchAllPages<PkVisit>((from, to) =>
        supabase
          .rpc("pk_board_visits")
          .select(
            "id, owner_id, occurred_at, location, primary_account_id, account:accounts!activities_primary_account_id_fkey(name)",
          )
          .eq("activity_type", "PK_TRAINING")
          .order("occurred_at", { ascending: false })
          .order("id")
          .range(from, to)
          .then((r) => ({ data: r.data as unknown as PkVisit[] | null, error: r.error })),
      ),
      // Owners and note authors. Through pk_member_names (20261103150000):
      // a rep reads no colleague's membership, but must see whose item it is.
      fetchAllPages<MemberName>((from, to) =>
        supabase
          .rpc("pk_member_names")
          .order("id")
          .range(from, to)
          .then((r) => ({ data: r.data as MemberName[] | null, error: r.error })),
      ),
    ]);

    // The dealer of a PK whose account the reader cannot open (a band handed
    // to a rep from a colleague's PK) comes by name only (pk_dealer_names).
    const nameless = vs.filter((v) => v.account === null).map((v) => v.id);
    if (nameless.length > 0) {
      const { data: dn } = await supabase.rpc("pk_dealer_names", { p_activity_ids: nameless });
      const rows = (dn ?? []) as { activity_id: string; dealer_name: string }[];
      const byId = new Map(rows.map((d) => [d.activity_id, d.dealer_name] as const));
      for (const v of vs) {
        const name = byId.get(v.id);
        if (v.account === null && name) v.account = { name };
      }
    }

    const na = await inChunks(
      vs.map((v) => v.id),
      (chunk) =>
        fetchAllPages<ItemRow>((from, to) =>
          supabase
            .rpc("pk_board_items")
            .select(ITEM_COLS)
            .in("activity_id", chunk)
            .order("due_date")
            .order("id")
            .range(from, to)
            .then((r) => ({ data: r.data as unknown as ItemRow[] | null, error: r.error })),
        ),
    );

    const ids = na.map((i) => i.id);
    const [nt, st, rd] = await Promise.all([
      inChunks(ids, (chunk) =>
        fetchAllPages<PkNote>((from, to) =>
          supabase
            .from("next_action_notes")
            .select(NOTE_COLS)
            .in("next_action_id", chunk)
            .order("created_at")
            .order("id")
            .range(from, to),
        ),
      ),
      inChunks(ids, (chunk) =>
        fetchAllPages<PkSubtask>((from, to) =>
          supabase
            .from("next_action_subtasks")
            .select(SUB_COLS)
            .in("next_action_id", chunk)
            .order("position")
            .order("id")
            .range(from, to),
        ),
      ),
      inChunks(ids, (chunk) =>
        fetchAllPages<PkRead>((from, to) =>
          supabase
            .from("next_action_reads")
            .select(READ_COLS)
            .in("next_action_id", chunk)
            .order("next_action_id")
            .order("membership_id")
            .range(from, to),
        ),
      ),
    ]);

    setVisits(vs);
    setItems(na);
    setNotes(nt);
    setSubtasks(st);
    setReads(rd);
    setNames(new Map(ms.map((m) => [m.id, m.full_name ?? "Someone"] as const)));
    setDeskIds(ms.filter((m) => m.status === "active" && seesDealersBoard(m.role)).map((m) => m.id));
    setTodayIso(isoOf(new Date()));
    setLoadedAt(Date.now());
  }, []);

  const attempt = useCallback(async () => {
    setLoadFailed(false);
    try {
      await load();
    } catch {
      setLoadFailed(true);
    }
  }, [load]);

  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => void attempt(), 0);
    return () => clearTimeout(timer);
  }, [profile, attempt]);

  const bands = useMemo<PkBand[]>(() => {
    const byVisit = new Map<string, PkItem[]>();
    for (const i of items) {
      const list = byVisit.get(i.activity_id);
      if (list) list.push(i);
      else byVisit.set(i.activity_id, [i]);
    }
    return visits.map((v) => ({
      activityId: v.id,
      accountId: v.primary_account_id,
      dealer: v.account ? displayAccountName(v.account.name) : "Dealer",
      pkDate: pkDateOf(v.occurred_at),
      location: v.location,
      items: byVisit.get(v.id) ?? [],
      ranBy: v.owner_id,
    }));
  }, [visits, items]);

  // ── THE OPEN ITEM ────────────────────────────────────────────────────────
  const openItem = openId ? (items.find((i) => i.id === openId) ?? null) : null;
  const openBand = openItem ? (bands.find((b) => b.activityId === openItem.activity_id) ?? null) : null;

  // The earlier texts of its edited notes, read when it opens (and after an edit).
  const editedNoteIds = useMemo(
    () =>
      openId
        ? notes
            .filter((n) => n.next_action_id === openId && n.edited_at !== null)
            .map((n) => `${n.id}@${n.edited_at}`)
            .sort()
            .join(",")
        : "",
    [notes, openId],
  );
  useEffect(() => {
    if (!editedNoteIds) return;
    const noteIds = editedNoteIds.split(",").map((k) => k.split("@")[0]);
    let stale = false;
    fetchAllPages<NoteVersion & { note_id: string }>((from, to) =>
      getSupabaseBrowserClient()
        .from("next_action_note_versions")
        .select("note_id, body, replaced_at")
        .in("note_id", noteIds)
        .order("replaced_at")
        .order("id")
        .range(from, to),
    )
      .then((rows) => {
        if (stale) return;
        setVersions((old) => {
          const next = new Map(old);
          for (const id of noteIds) next.delete(id);
          for (const r of rows) {
            const list = next.get(r.note_id) ?? [];
            list.push({ body: r.body, replaced_at: r.replaced_at });
            next.set(r.note_id, list);
          }
          return next;
        });
      })
      .catch(() => {
        // The "edited" mark still shows; the earlier text waits for the next open.
      });
    return () => {
      stale = true;
    };
  }, [editedNoteIds]);

  // One item read back after a write: its row, notes, subtasks and reads.
  // Resolves with the saved row, or null when the server cannot be reached.
  const refreshItem = useCallback(async (id: string): Promise<PkItem | null> => {
    const supabase = getSupabaseBrowserClient();
    try {
      const [row, nt, st, rd] = await Promise.all([
        supabase.rpc("pk_board_items").select(ITEM_COLS).eq("id", id).maybeSingle(),
        supabase.from("next_action_notes").select(NOTE_COLS).eq("next_action_id", id).order("created_at").order("id"),
        supabase.from("next_action_subtasks").select(SUB_COLS).eq("next_action_id", id).order("position").order("id"),
        supabase.from("next_action_reads").select(READ_COLS).eq("next_action_id", id).order("membership_id"),
      ]);
      if (row.error || nt.error || st.error || rd.error || !row.data) return null;
      const saved = row.data as unknown as ItemRow;
      setItems((list) => list.map((i) => (i.id === id ? saved : i)));
      setNotes((list) => [...list.filter((n) => n.next_action_id !== id), ...(nt.data as PkNote[])]);
      setSubtasks((list) => [...list.filter((x) => x.next_action_id !== id), ...(st.data as PkSubtask[])]);
      setReads((list) => [...list.filter((r) => r.next_action_id !== id), ...(rd.data as PkRead[])]);
      return saved;
    } catch {
      return null;
    }
  }, []);

  // The drawer edits one item's lists; the rest of each list stays as it is.
  function only<T extends { next_action_id: string }>(
    set: (fn: (list: T[]) => T[]) => void,
    id: string,
  ) {
    return (fn: (mine: T[]) => T[]) =>
      set((list) => [...list.filter((x) => x.next_action_id !== id), ...fn(list.filter((x) => x.next_action_id === id))]);
  }

  // "+ Add action": through the outbox like every other to-do, so a flaky
  // connection never loses it, and shown at once. Due a week out; no priority
  // until someone picks one.
  const onAdd = useCallback(
    async (activityId: string, action: string) => {
      if (!profile || !todayIso) return;
      const band = bands.find((b) => b.activityId === activityId);
      if (!band) return;
      const id = crypto.randomUUID();
      const payload = {
        id,
        org_id: profile.orgId,
        action,
        owner_id: profile.membershipId,
        due_date: plusDays(todayIso, 7),
        account_id: band.accountId,
        activity_id: activityId,
        item_type: "ACTION" as const,
        source: "MANUAL" as const,
        entered_by: profile.membershipId,
      };
      if (!nextActionCreateSchema.safeParse(payload).success) {
        setAddFailed(true);
        return;
      }
      try {
        const layer = getOfflineLayer();
        await layer.sync.enqueue({
          clientId: id,
          entityType: "next_action",
          op: "create",
          payload,
          baseVersion: null,
          blobRef: null,
        });
        void layer.sync.drain();
        setAddFailed(false);
        setItems((list) => [
          ...list,
          {
            id,
            action,
            owner_id: payload.owner_id,
            due_date: payload.due_date,
            completed_at: null,
            priority: null,
            priority_days: null,
            progress: "NOT_STARTED",
            last_changed_by: null,
            last_changed_at: null,
            updated_at: new Date().toISOString(),
            account_id: band.accountId,
            activity_id: activityId,
          },
        ]);
      } catch {
        setAddFailed(true);
      }
    },
    [profile, todayIso, bands],
  );

  // SHAPE WITHOUT VALUES — blocks where the figures will be, never a zero.
  if (loadedAt === null && !loadFailed) {
    return (
      <div className="stack pt-2" aria-busy="true">
        <section>
          {title}
        </section>
        <section className="pk-summary" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="pk-stat">
              <span className="skel" style={{ width: "50%", height: 10 }} />
              <span className="skel mt-2" style={{ width: "30%", height: 22 }} />
            </span>
          ))}
        </section>
        <section>
          <span className="skel" style={{ width: "100%", height: 320 }} />
        </section>
      </div>
    );
  }

  if (loadedAt === null) {
    return (
      <div className="stack pt-2">
        <section>
          {title}
          <p className="t-sub mt-2" style={{ maxWidth: "52ch" }}>
            The PK follow-ups live on the server and this device can&rsquo;t reach it right now.
            Nothing is lost &mdash; try again when you&rsquo;re back online.
          </p>
        </section>
        <button type="button" onClick={() => void attempt()} className="btn-secondary w-full">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="pk-layout">
    <div className="stack pt-2 pk-page" data-open-item={openId ?? undefined}>
      <section>
        {title}
        <p className="t-sub mt-2" style={{ maxWidth: "62ch" }}>
          {desk
            ? "What we still owe after each PK, newest first. Open a line to move it on; fold a PK to set it aside."
            : "What is still open after your PKs, newest first — yours and what the desk took on. Open a line to move yours on or leave a note."}
        </p>
      </section>

      {addFailed && (
        <p className="t-sub" role="alert" style={{ color: "var(--danger)" }}>
          That action could not be saved on this device. Try again.
        </p>
      )}

      <PkBoard
        bands={bands}
        notes={notes}
        subtasks={subtasks}
        reads={reads}
        names={names}
        me={me}
        desk={desk}
        todayIso={todayIso}
        onOpen={onOpen}
        onAdd={(activityId, action) => void onAdd(activityId, action)}
        actions={(visible) => (
          <PkExportButton
            visible={visible}
            all={bands}
            notes={notes}
            subtasks={subtasks}
            names={names}
            todayIso={todayIso}
          />
        )}
      />
    </div>
    {openItem && openBand && (
      <PkItemDrawer
        key={openItem.id}
        item={openItem}
        band={openBand}
        notes={notes
          .filter((n) => n.next_action_id === openItem.id)
          .sort((a, b) => a.created_at.localeCompare(b.created_at))}
        versionsByNote={versions}
        subtasks={subtasks
          .filter((x) => x.next_action_id === openItem.id)
          .sort((a, b) => a.position - b.position)}
        reads={reads.filter((r) => r.next_action_id === openItem.id)}
        names={names}
        desk={deskIds}
        me={me}
        todayIso={todayIso}
        readOnly={!canEditItem(openItem.owner_id, me, desk)}
        onItem={(next) => setItems((list) => list.map((i) => (i.id === next.id ? { ...i, ...next } : i)))}
        onNotes={only(setNotes, openItem.id)}
        onSubtasks={only(setSubtasks, openItem.id)}
        onReads={only(setReads, openItem.id)}
        onChanged={() => refreshItem(openItem.id)}
        onClose={onClose}
      />
    )}
    </div>
  );
}
