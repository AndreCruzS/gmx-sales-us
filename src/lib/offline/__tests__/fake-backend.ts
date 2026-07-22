// In-memory SyncBackend test double. `offline` simulates airplane mode:
// every call throws a (retryable) network error.

import {
  SyncRejectionError,
  type SyncBackend,
  type WorkingSet,
} from "../types";

interface Row extends Record<string, unknown> {
  id: string;
  updated_at: string;
}

export class FakeBackend implements SyncBackend {
  offline = false;
  rejectNextAs: "rls" | "constraint" | null = null;
  tables = new Map<string, Map<string, Row>>();
  uploads = new Map<string, Blob>();
  calls = { upserts: 0, updates: 0, signedUrls: 0 };
  private versionCounter = 0;

  /** Monotonic version stamps - Date.now() collides within a millisecond. */
  private nextVersion(): string {
    this.versionCounter += 1;
    return `2026-07-22T00:00:00.${String(this.versionCounter).padStart(6, "0")}Z`;
  }

  private table(name: string): Map<string, Row> {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  seed(tableName: string, row: Record<string, unknown> & { id: string }): Row {
    const stored: Row = { updated_at: this.nextVersion(), ...row } as Row;
    this.table(tableName).set(row.id, stored);
    return stored;
  }

  private guard() {
    if (this.offline) throw new Error("network unreachable (airplane mode)");
    if (this.rejectNextAs) {
      const reason = this.rejectNextAs;
      this.rejectNextAs = null;
      throw new SyncRejectionError(`replay rejected (${reason})`, reason);
    }
  }

  async upsertIgnoreDuplicates(
    tableName: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    this.guard();
    this.calls.upserts += 1;
    const table = this.table(tableName);
    const id = row.id as string;
    if (table.has(id)) return; // ignoreDuplicates - replay is a no-op (D57)
    table.set(id, { ...row, updated_at: this.nextVersion() } as Row);
  }

  async updateWithVersion(
    tableName: string,
    id: string,
    patch: Record<string, unknown>,
    baseVersion: string,
  ): Promise<number> {
    this.guard();
    this.calls.updates += 1;
    const row = this.table(tableName).get(id);
    if (!row || row.updated_at !== baseVersion) return 0; // stale (D61)
    Object.assign(row, patch, { updated_at: this.nextVersion() });
    return 1;
  }

  async createSignedUploadUrl(bucket: string, path: string) {
    this.guard();
    this.calls.signedUrls += 1;
    return { path, token: `token-${bucket}-${this.calls.signedUrls}` };
  }

  async uploadToSignedUrl(
    bucket: string,
    path: string,
    _token: string,
    blob: Blob,
  ): Promise<void> {
    this.guard();
    this.uploads.set(`${bucket}::${path}`, blob);
  }

  async pullWorkingSet(): Promise<WorkingSet> {
    this.guard();
    return {
      accounts: [],
      agenda: [],
      activities: [],
      pulledAt: new Date().toISOString(),
    };
  }
}
