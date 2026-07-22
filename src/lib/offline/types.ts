// D55: the four interfaces feature code is allowed to know about. The PWA
// implementations (Dexie/IndexedDB, Web Push) live behind them; a Capacitor
// escalation swaps implementations, not callers.

import type { EntityType } from "@/lib/domain/schemas";

export type OutboxStatus = "pending" | "syncing" | "synced" | "rejected";

// D57 outbox record. clientId == payload.id: the client-minted UUID the server
// upserts on (the idempotency key). The outbox's own key is `seq` — an
// auto-increment that guarantees FIFO drain order (FK parents before children)
// and allows multiple ops (create then update) for the same entity.
export interface OutboxRecord {
  seq?: number; // assigned by the store on enqueue
  clientId: string;
  entityType: EntityType;
  op: "create" | "update";
  payload: Record<string, unknown>;
  /** Server updated_at last read for this row — the D61 LWW guard. Null for creates. */
  baseVersion: string | null;
  /** Reference into BlobStore for audio/card payloads (D59). */
  blobRef: string | null;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export type NewOutboxRecord = Pick<
  OutboxRecord,
  "clientId" | "entityType" | "op" | "payload" | "baseVersion" | "blobRef"
>;

// D56 visit-ready working set — the bounded read cache.
export interface CachedAccount {
  id: string;
  name: string;
  account_type: string;
  city: string | null;
  territory_id: string;
  has_display_wall: boolean;
  display_last_verified_at: string | null;
  parent_account_id: string | null;
  updated_at: string;
}

export interface CachedAgendaItem {
  id: string;
  action: string;
  due_date: string;
  completed_at: string | null;
  account_id: string | null;
  opportunity_id: string | null;
  objective: string | null;
  updated_at: string; // baseVersion source for edits
}

export interface CachedActivity {
  id: string;
  activity_type: string;
  primary_account_id: string;
  occurred_at: string;
  what_happened: string | null;
  follow_up_required: boolean;
  pendingSync?: boolean; // optimistic local write not yet confirmed
}

export interface WorkingSet {
  accounts: CachedAccount[];
  agenda: CachedAgendaItem[];
  activities: CachedActivity[];
  pulledAt: string;
}

export interface LocalStore {
  // read models
  putWorkingSet(ws: WorkingSet): Promise<void>;
  getAccounts(): Promise<CachedAccount[]>;
  getAgenda(): Promise<CachedAgendaItem[]>;
  getRecentActivities(): Promise<CachedActivity[]>;
  putLocalActivity(a: CachedActivity): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  // outbox
  enqueue(rec: OutboxRecord): Promise<number>; // returns seq
  nextPending(): Promise<OutboxRecord | null>;
  updateOutbox(seq: number, patch: Partial<OutboxRecord>): Promise<void>;
  countByStatus(): Promise<Record<OutboxStatus, number>>;
  listRejected(): Promise<OutboxRecord[]>;
  deleteOutbox(seq: number): Promise<void>;
  /** D60: full wipe on logout and org switch. */
  wipe(): Promise<void>;
}

export interface BlobStore {
  put(ref: string, blob: Blob): Promise<void>;
  get(ref: string): Promise<Blob | null>;
  /** D59: purge after confirmed upload. */
  delete(ref: string): Promise<void>;
  wipe(): Promise<void>;
}

export interface PushChannel {
  /** Web Push is enhancement only (iOS reality); mail stays the guarantee. */
  requestPermission(): Promise<"granted" | "denied" | "unsupported">;
  subscribe(): Promise<PushSubscription | null>;
}

// Thin port over supabase-js so the SyncEngine is testable hermetically.
// The real implementation talks to Supabase DIRECTLY (D3/D62) — never Vercel.
export interface SyncBackend {
  /** Idempotent create: PK conflict = already replayed = success (D57). */
  upsertIgnoreDuplicates(table: string, row: Record<string, unknown>): Promise<void>;
  /** LWW-guarded update; returns affected row count (0 = stale, D61). */
  updateWithVersion(
    table: string,
    id: string,
    patch: Record<string, unknown>,
    baseVersion: string,
  ): Promise<number>;
  /** Signed URL minted at sync time, not capture time (D59). */
  createSignedUploadUrl(
    bucket: string,
    path: string,
  ): Promise<{ path: string; token: string }>;
  uploadToSignedUrl(
    bucket: string,
    path: string,
    token: string,
    blob: Blob,
  ): Promise<void>;
  pullWorkingSet(): Promise<WorkingSet>;
}

/** Thrown/classified by the backend so drain() can route the failure. */
export class SyncRejectionError extends Error {
  constructor(
    message: string,
    public readonly reason: "rls" | "constraint" | "validation",
  ) {
    super(message);
    this.name = "SyncRejectionError";
  }
}

export interface SyncStatus {
  pending: number;
  rejected: number;
  syncing: boolean;
  lastPulledAt: string | null;
}

export interface SyncEngine {
  /** Returns the outbox seq (for compensation on multi-op flows). */
  enqueue(rec: NewOutboxRecord): Promise<number>;
  drain(): Promise<void>;
  pull(): Promise<void>;
  /** Wires foreground/online/interval triggers (D58 — never Background Sync). */
  start(): void;
  stop(): void;
  subscribe(cb: (s: SyncStatus) => void): () => void;
}
