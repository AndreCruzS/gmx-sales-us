// The ONLY file (with blob-store.dexie.ts) allowed to import Dexie (D55).
// LocalStore = IndexedDB via Dexie (D57): cached read models + durable outbox.

import Dexie, { type Table } from "dexie";
import type {
  CachedAccount,
  CachedActivity,
  CachedAgendaItem,
  LocalStore,
  OutboxRecord,
  OutboxStatus,
  WorkingSet,
} from "./types";

class OfflineDb extends Dexie {
  accounts!: Table<CachedAccount, string>;
  agenda!: Table<CachedAgendaItem, string>;
  activities!: Table<CachedActivity, string>;
  meta!: Table<{ key: string; value: string }, string>;
  outbox!: Table<OutboxRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      accounts: "id, name, territory_id",
      agenda: "id, due_date, account_id",
      activities: "id, occurred_at, primary_account_id",
      meta: "key",
      outbox: "clientId, status, createdAt",
    });
  }
}

export class DexieLocalStore implements LocalStore {
  private db: OfflineDb;

  constructor(dbName = "cos-offline") {
    this.db = new OfflineDb(dbName);
  }

  async putWorkingSet(ws: WorkingSet): Promise<void> {
    await this.db.transaction(
      "rw",
      [this.db.accounts, this.db.agenda, this.db.activities, this.db.meta],
      async () => {
        // Pull replaces the bounded working set (D56 — working set, not the
        // territory); locally-captured pending activities are preserved.
        await this.db.accounts.clear();
        await this.db.accounts.bulkPut(ws.accounts);
        await this.db.agenda.clear();
        await this.db.agenda.bulkPut(ws.agenda);
        const pendingLocal = await this.db.activities
          .filter((a) => a.pendingSync === true)
          .toArray();
        await this.db.activities.clear();
        await this.db.activities.bulkPut([...ws.activities, ...pendingLocal]);
        await this.db.meta.put({ key: "last_pulled_at", value: ws.pulledAt });
      },
    );
  }

  getAccounts(): Promise<CachedAccount[]> {
    return this.db.accounts.orderBy("name").toArray();
  }

  getAgenda(): Promise<CachedAgendaItem[]> {
    return this.db.agenda.orderBy("due_date").toArray();
  }

  getRecentActivities(): Promise<CachedActivity[]> {
    return this.db.activities.orderBy("occurred_at").reverse().toArray();
  }

  putLocalActivity(a: CachedActivity): Promise<void> {
    return this.db.activities.put(a).then(() => undefined);
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.meta.get(key);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  async enqueue(rec: OutboxRecord): Promise<void> {
    await this.db.outbox.add(rec);
  }

  async nextPending(): Promise<OutboxRecord | null> {
    // FIFO drain (D58).
    const pending = await this.db.outbox
      .where("status")
      .equals("pending")
      .sortBy("createdAt");
    return pending[0] ?? null;
  }

  async updateOutbox(
    clientId: string,
    patch: Partial<OutboxRecord>,
  ): Promise<void> {
    await this.db.outbox.update(clientId, patch);
  }

  async countByStatus(): Promise<Record<OutboxStatus, number>> {
    const counts: Record<OutboxStatus, number> = {
      pending: 0,
      syncing: 0,
      synced: 0,
      rejected: 0,
    };
    await this.db.outbox.each((r) => {
      counts[r.status] += 1;
    });
    return counts;
  }

  listRejected(): Promise<OutboxRecord[]> {
    return this.db.outbox.where("status").equals("rejected").sortBy("createdAt");
  }

  async deleteOutbox(clientId: string): Promise<void> {
    await this.db.outbox.delete(clientId);
  }

  async wipe(): Promise<void> {
    // D60: logout and org switch wipe the whole database — the previous
    // tenant's cache must not linger on the device.
    await this.db.delete();
    await this.db.open();
  }
}
