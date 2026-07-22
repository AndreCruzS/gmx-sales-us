// SyncEngine (D58): pull the working set + drain the outbox, triggered on
// foreground / `online` / manual / foreground interval — never the Background
// Sync API. Replays go through Supabase directly (D3/D62), so RLS and
// constraints re-check at replay; failures classify as retryable (network)
// or rejected (RLS/constraint/stale-LWW → error tray, never dropped).

import { ENTITY_TABLES, outboxPayloadSchemas } from "@/lib/domain/schemas";
import {
  SyncRejectionError,
  type BlobStore,
  type LocalStore,
  type NewOutboxRecord,
  type OutboxRecord,
  type SyncBackend,
  type SyncEngine,
  type SyncStatus,
} from "./types";

const MAX_DRAIN_PER_RUN = 200; // safety bound per drain pass
const FOREGROUND_INTERVAL_MS = 60_000;

export class OutboxSyncEngine implements SyncEngine {
  private draining: Promise<void> | null = null;
  private listeners = new Set<(s: SyncStatus) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private teardown: (() => void) | null = null;
  private syncing = false;

  constructor(
    private local: LocalStore,
    private blobs: BlobStore,
    private backend: SyncBackend,
  ) {}

  async enqueue(rec: NewOutboxRecord): Promise<void> {
    // Zod at the outbox boundary — a payload that can't validate must fail at
    // capture time (fixable), not at replay time (stranded).
    const schema = outboxPayloadSchemas[`${rec.entityType}:${rec.op}`];
    if (schema) schema.parse(rec.payload);
    if (rec.op === "update" && !rec.baseVersion) {
      throw new Error("update ops require baseVersion (D61 LWW guard)");
    }

    await this.local.enqueue({
      ...rec,
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
    });
    await this.notify();
  }

  drain(): Promise<void> {
    // Single-flight: a drain fired twice (visibility + online racing) joins
    // the in-progress pass; idempotent replay (D57) covers the rest.
    if (!this.draining) {
      this.draining = this.drainOnce().finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  private async drainOnce(): Promise<void> {
    this.syncing = true;
    await this.notify();
    try {
      for (let i = 0; i < MAX_DRAIN_PER_RUN; i++) {
        const rec = await this.local.nextPending();
        if (!rec) break;
        const done = await this.pushOne(rec);
        if (!done) break; // network failure — stop, stay pending, retry later
      }
    } finally {
      this.syncing = false;
      await this.notify();
    }
  }

  /** @returns false when the record stays pending (retryable failure). */
  private async pushOne(rec: OutboxRecord): Promise<boolean> {
    await this.local.updateOutbox(rec.clientId, {
      status: "syncing",
      attempts: rec.attempts + 1,
    });
    try {
      if (rec.blobRef) await this.uploadBlob(rec);

      const table = ENTITY_TABLES[rec.entityType];
      if (rec.op === "create") {
        await this.backend.upsertIgnoreDuplicates(table, rec.payload);
      } else {
        const { id, ...patch } = rec.payload as { id: string };
        const affected = await this.backend.updateWithVersion(
          table,
          id,
          patch,
          rec.baseVersion as string,
        );
        if (affected === 0) {
          // D61: stale write — the server row moved since we read it. Reject
          // to the tray; never clobber the newer server state.
          throw new SyncRejectionError(
            "stale write: the record changed on the server after this edit was captured",
            "validation",
          );
        }
      }

      await this.local.updateOutbox(rec.clientId, {
        status: "synced",
        lastError: null,
      });
      return true;
    } catch (err) {
      if (err instanceof SyncRejectionError) {
        // D62: invalid at replay (RLS, constraint, stale) → error tray,
        // never silently dropped.
        await this.local.updateOutbox(rec.clientId, {
          status: "rejected",
          lastError: err.message,
        });
        return true; // continue draining the rest of the queue
      }
      // Network/5xx: keep pending for the next trigger.
      await this.local.updateOutbox(rec.clientId, {
        status: "pending",
        lastError: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private async uploadBlob(rec: OutboxRecord): Promise<void> {
    const blob = await this.blobs.get(rec.blobRef as string);
    if (!blob) return; // already uploaded + purged on a prior attempt
    const [bucket, ...rest] = (rec.blobRef as string).split("::");
    const path = rest.join("::");
    // D59: mint the signed URL NOW, at sync time — a capture that sat offline
    // for hours must never upload against an expired URL.
    const signed = await this.backend.createSignedUploadUrl(bucket, path);
    await this.backend.uploadToSignedUrl(bucket, path, signed.token, blob);
    await this.blobs.delete(rec.blobRef as string); // purge after confirmed upload
  }

  async pull(): Promise<void> {
    const ws = await this.backend.pullWorkingSet();
    await this.local.putWorkingSet(ws);
    await this.notify();
  }

  start(): void {
    if (typeof window === "undefined" || this.teardown) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void this.sync();
    };
    const onOnline = () => void this.sync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    this.timer = setInterval(() => {
      if (document.visibilityState === "visible") void this.sync();
    }, FOREGROUND_INTERVAL_MS);
    this.teardown = () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (this.timer) clearInterval(this.timer);
    };
    void this.sync();
  }

  stop(): void {
    this.teardown?.();
    this.teardown = null;
  }

  private async sync(): Promise<void> {
    try {
      await this.drain();
      await this.pull();
    } catch {
      // Offline: the always-visible pending badge is the signal (D58);
      // the next trigger retries.
    }
  }

  subscribe(cb: (s: SyncStatus) => void): () => void {
    this.listeners.add(cb);
    void this.notify();
    return () => this.listeners.delete(cb);
  }

  private async notify(): Promise<void> {
    if (this.listeners.size === 0) return;
    const counts = await this.local.countByStatus();
    const status: SyncStatus = {
      pending: counts.pending + counts.syncing,
      rejected: counts.rejected,
      syncing: this.syncing,
      lastPulledAt: await this.local.getMeta("last_pulled_at"),
    };
    this.listeners.forEach((cb) => cb(status));
  }
}
