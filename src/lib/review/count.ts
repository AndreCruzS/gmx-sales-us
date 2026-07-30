"use client";

// Task 7: the one number for "what waits on the rep" — rejected saves
// (D61/D62, always known locally) plus captures/candidates waiting for an
// OK (server-sourced; the review page caches them into `review_counts` meta
// on every load so the count survives offline, D56-style). Both the tab
// badge and Home's "Waiting your OK" tile read this same number through
// useReviewCount, so the two never disagree.

import { useEffect, useState } from "react";
import { getOfflineLayer, type LocalStore } from "@/lib/offline";

interface ReviewCounts {
  captures: number;
  candidates: number;
}

function parseReviewCounts(raw: string | null): ReviewCounts {
  if (!raw) return { captures: 0, candidates: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<ReviewCounts>;
    return {
      captures: parsed.captures ?? 0,
      candidates: parsed.candidates ?? 0,
    };
  } catch {
    // corrupt/older meta shape — treat as absent rather than throw.
    return { captures: 0, candidates: 0 };
  }
}

export async function reviewCount(local: LocalStore): Promise<number> {
  const [rejected, metaRaw] = await Promise.all([
    local.listRejected(),
    local.getMeta("review_counts"),
  ]);
  const { captures, candidates } = parseReviewCounts(metaRaw);
  return rejected.length + captures + candidates;
}

/** Subscribes to sync status changes plus a 30s interval so a badge that's
 *  merely sitting on screen (no navigation, no sync event) still catches up
 *  with what the review page has cached in the background. */
export function useReviewCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const layer = getOfflineLayer();

    async function refresh() {
      try {
        const next = await reviewCount(layer.local);
        if (!cancelled) setCount(next);
      } catch {
        // Local-store hiccup (Dexie error, stale layer post-wipe on
        // logout/org switch): keep the last-known count; the next tick
        // (sync event or 30s interval) retries.
      }
    }

    void refresh();
    const unsubscribe = layer.sync.subscribe(() => void refresh());
    const interval = setInterval(() => void refresh(), 30_000);

    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  return count;
}
