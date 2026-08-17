"use client";

// D58: a rep must never believe a captured visit uploaded when it is still on the
// device. That promise is about the states where something IS wrong — and it does
// not need a permanent badge announcing the absence of a problem.
//
// The chip used to sit in the header saying "Saved" for the entire session, which
// is the state it is in almost always. A signal that is always present is not a
// signal: the eye learns that corner of the screen carries nothing, and then does
// not see it on the one afternoon it reads "2 need you".
//
// So it appears when it has something to say, and is otherwise absent. The one
// moment plain absence is not enough is the instant a queue DRAINS — that is when
// a rep is deciding whether it is safe to drive away — so "Saved" shows then, for
// a few seconds, and leaves. A confirmation is an event, not a state.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SyncStatus } from "@/lib/offline";
import { useOffline } from "./offline-provider";

/** How long the confirmation stays after the last item clears. */
const CONFIRM_MS = 4000;

/**
 * What the chip says, or NULL when the outbox is empty and quiet.
 *
 * Factored out so any other screen talking about sync state reads the same copy
 * instead of drifting into its own paraphrase — two different sentences about the
 * same outbox on the same screen is exactly the D58 promise this exists to keep.
 * Null means "nothing to report", and a caller should say nothing rather than
 * invent a cheerful word for it.
 */
export function syncStatusLabel(status: SyncStatus): string | null {
  if (status.rejected > 0) {
    return `${status.rejected} need${status.rejected === 1 ? "s" : ""} you`;
  }
  if (status.pending > 0) {
    return status.syncing ? "Syncing…" : `${status.pending} to sync`;
  }
  return null;
}

export function SyncBadge() {
  const { status } = useOffline();
  const [confirming, setConfirming] = useState(false);
  const wasQueued = useRef(status.pending > 0 || status.rejected > 0);

  useEffect(() => {
    const queued = status.pending > 0 || status.rejected > 0;
    const drained = wasQueued.current && !queued;
    wasQueued.current = queued;
    if (!drained) return;
    // Deferred by a tick rather than set in the effect body — the same rule every
    // other timer in this codebase follows.
    const show = setTimeout(() => setConfirming(true), 0);
    const hide = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [status.pending, status.rejected]);

  // Rejected work is the only state that is also a destination: it cannot be
  // fixed by waiting, so the chip is a link to the screen that fixes it.
  if (status.rejected > 0) {
    return (
      <Link href="/review" className="sync-chip" data-state="attention">
        <span className="sync-dot" />
        {syncStatusLabel(status)}
      </Link>
    );
  }

  if (status.pending > 0) {
    return (
      <span className="sync-chip" data-state="pending">
        <span className="sync-dot" />
        {syncStatusLabel(status)}
      </span>
    );
  }

  if (confirming) {
    return (
      <span className="sync-chip" data-state="synced" role="status">
        <span className="sync-dot" />
        Saved
      </span>
    );
  }

  return null;
}
