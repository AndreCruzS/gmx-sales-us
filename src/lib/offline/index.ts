// Feature code imports the offline layer from HERE (D55) — never Dexie, never
// the implementation files. One singleton per browser session.

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { DexieBlobStore } from "./blob-store.dexie";
import { DexieLocalStore } from "./local-store.dexie";
import { OutboxSyncEngine } from "./sync-engine";
import { SupabaseSyncBackend } from "./supabase-backend";
import { WebPushChannel } from "./push-channel.web";
import type { BlobStore, LocalStore, PushChannel, SyncEngine } from "./types";

export * from "./types";

interface OfflineLayer {
  local: LocalStore;
  blobs: BlobStore;
  sync: SyncEngine;
  push: PushChannel;
}

let layer: OfflineLayer | null = null;

export function getOfflineLayer(): OfflineLayer {
  if (typeof window === "undefined") {
    throw new Error("offline layer is browser-only");
  }
  if (!layer) {
    const local = new DexieLocalStore();
    const blobs = new DexieBlobStore();
    const backend = new SupabaseSyncBackend(getSupabaseBrowserClient());
    layer = {
      local,
      blobs,
      sync: new OutboxSyncEngine(local, blobs, backend),
      push: new WebPushChannel(),
    };
    // Resist IndexedDB eviction under storage pressure (D60 / offline doc §6).
    void navigator.storage?.persist?.();
  }
  return layer;
}

/** D60: called on logout and org switch — the previous tenant's cache must
 *  not linger on the device. */
export async function wipeLocalData(): Promise<void> {
  if (!layer) return;
  layer.sync.stop();
  await layer.local.wipe();
  await layer.blobs.wipe();
  layer = null;
}
