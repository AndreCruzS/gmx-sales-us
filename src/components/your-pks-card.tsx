"use client";

// "YOUR PKs" on a rep's Home (spec 2026-11-03 §4): one line on what is still
// open after his PKs — "3 PKs open · 7 follow-ups · 1 alert passed · 2 new" —
// that opens the board under his Agenda. It shows only when something is open,
// and only online: the follow-ups live on the server, and a card that might be
// stale is worse than none on a screen read on the way out of the truck.
//
// The figures are the board's own (summarize), counted over what RLS lets the
// rep read: his PKs in full, and the PK of any item handed to him.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import {
  isUnread,
  summarize,
  type PkItem,
  type PkNote,
  type PkRead,
  type PkSummary,
} from "@/lib/domain/pk-follow-up";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/page";

const ITEM_COLS =
  "id, action, owner_id, due_date, completed_at, priority, priority_days, progress, last_changed_by, last_changed_at, updated_at, activity_id";
const CHUNK = 200;

type Row = PkItem & { activity_id: string };

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function inChunks<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await read(ids.slice(i, i + CHUNK))));
  return out;
}

/** The card's sentence, or null when there is nothing open to show. */
export function yourPksLine(s: PkSummary): string | null {
  if (s.pksOpen === 0) return null;
  const parts = [
    `${s.pksOpen} ${s.pksOpen === 1 ? "PK" : "PKs"} open`,
    `${s.followUps} ${s.followUps === 1 ? "follow-up" : "follow-ups"}`,
  ];
  if (s.alertPassed > 0) parts.push(`${s.alertPassed} ${s.alertPassed === 1 ? "alert" : "alerts"} passed`);
  if (s.newForMe > 0) parts.push(`${s.newForMe} new`);
  return parts.join(" · ");
}

export function YourPksCard() {
  const { profile } = useOffline();
  const me = profile?.membershipId ?? "";
  const [summary, setSummary] = useState<PkSummary | null>(null);

  useEffect(() => {
    if (!me) return;
    let stale = false;
    const supabase = getSupabaseBrowserClient();
    (async () => {
      const pks = await fetchAllPages<{ id: string }>((from, to) =>
        supabase
          .from("activities")
          .select("id")
          .eq("activity_type", "PK_TRAINING")
          .order("id")
          .range(from, to),
      );
      const items = await inChunks(
        pks.map((p) => p.id),
        (chunk) =>
          fetchAllPages<Row>((from, to) =>
            supabase
              .from("next_actions")
              .select(ITEM_COLS)
              .in("activity_id", chunk)
              .is("completed_at", null)
              .order("id")
              .range(from, to)
              .then((r) => ({ data: r.data as unknown as Row[] | null, error: r.error })),
          ),
      );
      const ids = items.map((i) => i.id);
      const [notes, reads] = await Promise.all([
        inChunks(ids, (chunk) =>
          fetchAllPages<PkNote>((from, to) =>
            supabase
              .from("next_action_notes")
              .select("id, next_action_id, author_id, body, created_at, edited_at")
              .in("next_action_id", chunk)
              .order("id")
              .range(from, to),
          ),
        ),
        inChunks(ids, (chunk) =>
          fetchAllPages<PkRead>((from, to) =>
            supabase
              .from("next_action_reads")
              .select("membership_id, next_action_id, last_read_at")
              .eq("membership_id", me)
              .in("next_action_id", chunk)
              .order("next_action_id")
              .range(from, to),
          ),
        ),
      ]);
      const byPk = new Map<string, PkItem[]>();
      for (const i of items) byPk.set(i.activity_id, [...(byPk.get(i.activity_id) ?? []), i]);
      const myRead = new Map(reads.map((r) => [r.next_action_id, r] as const));
      const s = summarize(
        [...byPk.values()].map((list) => ({ items: list })),
        (i) => isUnread(i, notes, myRead.get(i.id), me),
        isoOf(new Date()),
      );
      if (!stale) setSummary(s);
    })().catch(() => {
      // Offline or refused: no card, never a wrong one.
    });
    return () => {
      stale = true;
    };
  }, [me]);

  const line = summary ? yourPksLine(summary) : null;
  if (!line || !summary) return null;

  return (
    <section>
      <Link href="/visits/pk" className="card card-pad flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span
            className="block text-[10px] font-bold uppercase tracking-wide"
            style={{ color: "var(--ink-muted)" }}
          >
            Your PKs
          </span>
          <span className="t-sub mt-0.5 block">{line}</span>
        </span>
        {summary.alertPassed > 0 && (
          <span className="tag" style={{ background: "var(--danger-tint)", color: "var(--danger)" }}>
            Late
          </span>
        )}
      </Link>
    </section>
  );
}
