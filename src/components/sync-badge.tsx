"use client";

// D58: the sync state is ALWAYS visible — a rep must never believe a captured
// visit uploaded when it is still on the device. This chip is the app's
// signature element: the dot only pulses while work is genuinely queued.

import Link from "next/link";
import type { SyncStatus } from "@/lib/offline";
import { useOffline } from "./offline-provider";

// The exact wording this chip shows, factored out so any other screen that
// wants to talk about sync state (Home's greeting subline) reads the same
// copy instead of drifting into its own paraphrase — two different sentences
// about the same outbox on the same screen is exactly the D58 promise this
// chip exists to keep.
export function syncStatusLabel(status: SyncStatus): string {
  if (status.rejected > 0) {
    return `${status.rejected} need${status.rejected === 1 ? "s" : ""} you`;
  }
  if (status.pending > 0) {
    return status.syncing ? "Syncing…" : `${status.pending} to sync`;
  }
  return "Saved";
}

export function SyncBadge() {
  const { status } = useOffline();
  const label = syncStatusLabel(status);

  if (status.rejected > 0) {
    return (
      <Link href="/review" className="sync-chip" data-state="attention">
        <span className="sync-dot" />
        {label}
      </Link>
    );
  }

  if (status.pending > 0) {
    return (
      <span className="sync-chip" data-state="pending">
        <span className="sync-dot" />
        {label}
      </span>
    );
  }

  return (
    <span className="sync-chip" data-state="synced">
      <span className="sync-dot" />
      {label}
    </span>
  );
}
