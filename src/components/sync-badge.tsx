"use client";

// D58: the "N unsynced" state is ALWAYS visible — a rep must never believe a
// captured visit uploaded when it is still on the device.

import Link from "next/link";
import { useOffline } from "./offline-provider";

export function SyncBadge() {
  const { status } = useOffline();

  return (
    <div className="flex items-center gap-2 text-sm">
      {status.rejected > 0 && (
        <Link
          href="/tray"
          className="rounded-full bg-red-600 px-3 py-1 font-medium text-white"
        >
          {status.rejected} need attention
        </Link>
      )}
      {status.pending > 0 ? (
        <span className="rounded-full bg-amber-500 px-3 py-1 font-medium text-white">
          {status.syncing ? "Syncing… " : ""}
          {status.pending} unsynced
        </span>
      ) : (
        <span className="rounded-full bg-emerald-600/15 px-3 py-1 font-medium text-emerald-700 dark:text-emerald-400">
          All synced
        </span>
      )}
    </div>
  );
}
