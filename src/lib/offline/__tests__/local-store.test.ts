import { beforeEach, describe, expect, it } from "vitest";
import { DexieLocalStore } from "../local-store.dexie";
import type { OutboxRecord, WorkingSet } from "../types";

let store: DexieLocalStore;
let n = 0;

function outboxRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    clientId: crypto.randomUUID(),
    entityType: "activity",
    op: "create",
    payload: {},
    baseVersion: null,
    blobRef: null,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  n += 1;
  store = new DexieLocalStore(`test-localstore-${n}`);
});

describe("outbox durability", () => {
  it("drains FIFO by enqueue order (seq), so FK parents replay first", async () => {
    const first = outboxRecord();
    await store.enqueue(first);
    await store.enqueue(outboxRecord());
    const next = await store.nextPending();
    expect(next?.clientId).toBe(first.clientId);
  });

  it("allows multiple ops for the same entity (create then update)", async () => {
    const id = crypto.randomUUID();
    await store.enqueue(outboxRecord({ clientId: id, op: "create" }));
    await store.enqueue(
      outboxRecord({ clientId: id, op: "update", baseVersion: "v1" }),
    );
    const counts = await store.countByStatus();
    expect(counts.pending).toBe(2);
  });

  it("counts by status for the always-visible badge (D58)", async () => {
    await store.enqueue(outboxRecord());
    await store.enqueue(outboxRecord({ status: "rejected" }));
    const counts = await store.countByStatus();
    expect(counts.pending).toBe(1);
    expect(counts.rejected).toBe(1);
  });
});

describe("working set (D56)", () => {
  const accountId = crypto.randomUUID();
  const ws: WorkingSet = {
    accounts: [
      {
        id: accountId,
        name: "Ganahl Anaheim",
        account_type: "DEALER",
        city: "Anaheim",
        territory_id: crypto.randomUUID(),
        has_display_wall: true,
        display_last_verified_at: null,
        parent_account_id: null,
        updated_at: new Date().toISOString(),
      },
    ],
    contacts: [
      {
        id: crypto.randomUUID(),
        account_id: accountId,
        name: "Sam Lee",
        job_title: "Counter Sales",
        email: null,
        phone: "+17145550102",
        is_champion: false,
        updated_at: new Date().toISOString(),
      },
      {
        id: crypto.randomUUID(),
        account_id: accountId,
        name: "Mike Torres",
        job_title: "Store Manager",
        email: null,
        phone: "+17145550101",
        is_champion: true,
        updated_at: new Date().toISOString(),
      },
    ],
    agenda: [],
    activities: [],
    settings: { display_routine_months: 4, display_verify_months: 6 },
    pulledAt: new Date().toISOString(),
  };

  it("caches contacts per account, champion first (D50)", async () => {
    await store.putWorkingSet(ws);
    const contacts = await store.getContacts(accountId);
    expect(contacts.map((c) => c.name)).toEqual(["Mike Torres", "Sam Lee"]);
    expect(contacts[0].is_champion).toBe(true);
    expect(await store.getContacts(crypto.randomUUID())).toHaveLength(0);
  });

  it("replaces the cached read models on pull but keeps in-flight local writes", async () => {
    const inflightId = crypto.randomUUID();
    const syncedId = crypto.randomUUID();
    for (const [id, status] of [
      [inflightId, "pending"],
      [syncedId, "synced"],
    ] as const) {
      await store.enqueue(outboxRecord({ clientId: id, status }));
      await store.putLocalActivity({
        id,
        activity_type: "PHONE_CALL",
        primary_account_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        what_happened: "offline capture",
        follow_up_required: false,
        pendingSync: true,
      });
    }
    await store.putWorkingSet(ws);
    expect(await store.getAccounts()).toHaveLength(1);
    const activities = await store.getRecentActivities();
    // The in-flight write survived; the already-synced optimistic mirror was
    // dropped in favour of the server truth from the pull.
    expect(activities.map((a) => a.id)).toEqual([inflightId]);
    expect(activities[0].pendingSync).toBe(true);
  });
});

describe("wipe (D60)", () => {
  it("clears every store on logout/org switch", async () => {
    await store.enqueue(outboxRecord());
    await store.setMeta("last_pulled_at", new Date().toISOString());
    await store.wipe();
    const counts = await store.countByStatus();
    expect(counts.pending + counts.synced + counts.rejected).toBe(0);
    expect(await store.getMeta("last_pulled_at")).toBeNull();
    expect(await store.getAccounts()).toHaveLength(0);
  });
});
