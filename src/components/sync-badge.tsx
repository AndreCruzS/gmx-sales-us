"use client";

// D58: the sync state is ALWAYS visible — a rep must never believe a captured
// visit uploaded when it is still on the device. This chip is the app's
// signature element: the dot only pulses while work is genuinely queued.

import Link from "next/link";
import { useOffline } from "./offline-provider";

export function SyncBadge() {
  const { status } = useOffline();

  if (status.rejected > 0) {
    return (
      <Link href="/review" className="sync-chip" data-state="attention">
        <span className="sync-dot" />
        {status.rejected} need{status.rejected === 1 ? "s" : ""} you
      </Link>
    );
  }

  if (status.pending > 0) {
    return (
      <span className="sync-chip" data-state="pending">
        <span className="sync-dot" />
        {status.syncing ? "Syncing…" : `${status.pending} to sync`}
      </span>
    );
  }

  return (
    <span className="sync-chip" data-state="synced">
      <span className="sync-dot" />
      Saved
    </span>
  );
}
