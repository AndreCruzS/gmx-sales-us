"use client";

// The PK drawer's status and priority edits, through the outbox (D61): one at
// a time, each with the row's newest updated_at. The board moves at once
// (mirrorUpdate plays the database trigger); the saved row replaces it, with
// any edits still queued replayed on top so a quick second pick never snaps
// back while the first one lands.

import { useEffect, useRef, useState } from "react";
import { mirrorUpdate, type PkItem, type PkItemPatch } from "@/lib/domain/pk-follow-up";
import { getOfflineLayer } from "@/lib/offline";

const ON_DEVICE = "Saved on this device. It reaches the others when the connection is back.";

export function usePkItemWrites({
  item,
  me,
  onItem,
  onChanged,
}: {
  item: PkItem;
  me: string;
  onItem: (next: PkItem) => void;
  /** Re-reads the item; resolves with the saved row, or null when unreachable. */
  onChanged: () => Promise<PkItem | null>;
}) {
  // The newest item and the newest saved updated_at, for writes queued behind
  // one another.
  const itemRef = useRef(item);
  const baseRef = useRef(item.updated_at);
  const chain = useRef<Promise<void>>(Promise.resolve());
  // Edits picked but not yet written, oldest first: replayed over every
  // re-read so a quick second pick never snaps back while the first lands.
  const pending = useRef<PkItemPatch[]>([]);
  useEffect(() => {
    itemRef.current = item;
    if (pending.current.length === 0) baseRef.current = item.updated_at;
  }, [item]);
  const [writeNote, setWriteNote] = useState<string | null>(null);

  /** Runs after everything queued before it. */
  function queue(step: () => Promise<void>) {
    chain.current = chain.current.then(step).catch(() => undefined);
  }

  /** Re-read the item; show the saved row with the edits still queued on top. */
  async function settle(): Promise<PkItem | null> {
    const saved = await onChanged();
    if (!saved) return null;
    baseRef.current = saved.updated_at;
    const now = new Date().toISOString();
    const shown = pending.current.reduce<PkItem>((it, p) => mirrorUpdate(it, p, me, now), saved);
    itemRef.current = shown;
    if (pending.current.length > 0) onItem(shown);
    return saved;
  }

  function write(patch: PkItemPatch) {
    const next = mirrorUpdate(itemRef.current, patch, me, new Date().toISOString());
    itemRef.current = next;
    onItem(next);
    pending.current.push(patch);
    queue(async () => {
      try {
        const layer = getOfflineLayer();
        const seq = await layer.sync.enqueue({
          clientId: item.id,
          entityType: "next_action",
          op: "update",
          payload: { id: item.id, ...patch },
          baseVersion: baseRef.current, // D61
          blobRef: null,
        });
        await layer.sync.drain();
        const rejected = (await layer.local.listRejected()).some((r) => r.seq === seq);
        // The outbox drains in order and stops at the first failure: a head at
        // or before this edit means this edit is still waiting on the device.
        const head = await layer.local.nextPending();
        if (!rejected && head !== null && (head.seq ?? Infinity) <= seq) {
          // Still on the device: it stays in `pending`, replayed over every
          // re-read until it lands (replaying a landed edit changes nothing).
          setWriteNote(ON_DEVICE);
          return;
        }
        pending.current = pending.current.filter((p) => p !== patch);
        await settle();
        setWriteNote(rejected ? "That change was not saved — the item shows what is saved now." : null);
      } catch {
        pending.current = pending.current.filter((p) => p !== patch);
        setWriteNote("That change could not be saved on this device. Try again.");
        await settle();
      }
    });
  }

  /** A note was edited: read the item back in turn, behind any queued write. */
  function refreshInTurn() {
    queue(async () => {
      await settle();
    });
  }

  return { write, refreshInTurn, writeNote };
}
