"use client";

// The error tray (D58/D61/D62): a FIRST-CLASS surface, not a console log.
// Rejected writes — stale LWW edits, RLS/constraint failures at replay —
// land here and are never silently dropped.

import { useEffect, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { getOfflineLayer, type OutboxRecord } from "@/lib/offline";

export default function TrayPage() {
  const { status } = useOffline();
  const [rejected, setRejected] = useState<OutboxRecord[]>([]);

  useEffect(() => {
    void getOfflineLayer().local.listRejected().then(setRejected);
  }, [status.rejected]);

  async function discard(clientId: string) {
    await getOfflineLayer().local.deleteOutbox(clientId);
    setRejected((prev) => prev.filter((r) => r.clientId !== clientId));
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Needs attention</h1>

      {rejected.length === 0 ? (
        <p className="text-sm opacity-60">
          Nothing here. Rejected syncs — edits that clashed with a newer change,
          or records no longer in your scope — will appear here so nothing is
          ever lost silently.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rejected.map((r) => (
            <li
              key={r.clientId}
              className="rounded-xl border border-red-500/40 p-4 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {r.entityType.replaceAll("_", " ")} · {r.op}
                </span>
                <span className="text-xs opacity-50">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-red-600">{r.lastError}</p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs opacity-60">
                  What you captured
                </summary>
                <pre className="mt-1 overflow-x-auto rounded bg-black/5 p-2 text-xs dark:bg-white/10">
                  {JSON.stringify(r.payload, null, 2)}
                </pre>
              </details>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => discard(r.clientId)}
                  className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium dark:border-white/20"
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
