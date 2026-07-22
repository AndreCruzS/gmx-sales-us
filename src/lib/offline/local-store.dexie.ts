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
  outbox!: Table<OutboxRecord, number>;

  constructor(name: string) {
    super(name);
    // v2: outbox keyed by auto-increment seq (FIFO order; multiple ops per
    // entity). Dexie cannot change a store's primary key across versions, so
    // the store is dropped and recreated (v1 existed only on dev machines).
    this.version(1).stores({
      accounts: "id, name, territory_id",
      agenda: "id, due_date, account_id",
      activities: "id, occurred_at, primary_account_id",
      meta: "key",
      outbox: "clientId, status, createdAt",
    });
    this.version(2)
      .stores({ outbox: null })
      .upgrade(() => undefined);
    this.version(3).stores({
      outbox: "++seq, clientId, status, createdAt",
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
      [
        this.db.accounts,
        this.db.agenda,
        this.db.activities,
        this.db.meta,
        this.db.outbox,
      ],
      async () => {
        // Pull replaces the bounded working set (D56 — working set, not the
        // territory). Locally-captured activities are preserved ONLY while
        // their outbox record is still in flight (pending/syncing/rejected) —
        // once synced, the server copy is the truth and the optimistic mirror
        // must not shadow it.
        const inflight = new Set(
          (await this.db.outbox.toArray())
            .filter((o) => o.status !== "synced")
            .map((o) => o.clientId),
        );
        await this.db.accounts.clear();
        await this.db.accounts.bulkPut(ws.accounts);
        await this.db.agenda.clear();
        await this.db.agenda.bulkPut(ws.agenda);
        const pendingLocal = await this.db.activities
          .filter((a) => a.pendingSync === true && inflight.has(a.id))
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

  async enqueue(rec: OutboxRecord): Promise<number> {
    return this.db.outbox.add(rec);
  }

  async nextPending(): Promise<OutboxRecord | null> {
    // FIFO drain (D58): seq is monotonic, so FK parents (activity) always
    // replay before their children (next actions referencing it).
    const pending = await this.db.outbox
      .where("status")
      .equals("pending")
      .sortBy("seq");
    return pending[0] ?? null;
  }

  async updateOutbox(seq: number, patch: Partial<OutboxRecord>): Promise<void> {
    await this.db.outbox.update(seq, patch);
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
    return this.db.outbox.where("status").equals("rejected").sortBy("seq");
  }

  async deleteOutbox(seq: number): Promise<void> {
    await this.db.outbox.delete(seq);
  }

  async wipe(): Promise<void> {
    // D60: logout and org switch wipe the whole database — the previous
    // tenant's cache must not linger on the device.
    await this.db.delete();
    await this.db.open();
  }
}
