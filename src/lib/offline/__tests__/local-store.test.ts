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
  it("drains FIFO by createdAt", async () => {
    await store.enqueue(outboxRecord({ createdAt: "2026-07-22T10:00:00Z" }));
    const first = outboxRecord({ createdAt: "2026-07-22T09:00:00Z" });
    await store.enqueue(first);
    const next = await store.nextPending();
    expect(next?.clientId).toBe(first.clientId);
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
  const ws: WorkingSet = {
    accounts: [
      {
        id: crypto.randomUUID(),
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
    agenda: [],
    activities: [],
    pulledAt: new Date().toISOString(),
  };

  it("replaces the cached read models on pull but keeps pending local writes", async () => {
    await store.putLocalActivity({
      id: crypto.randomUUID(),
      activity_type: "PHONE_CALL",
      primary_account_id: crypto.randomUUID(),
      occurred_at: new Date().toISOString(),
      what_happened: "offline capture",
      follow_up_required: false,
      pendingSync: true,
    });
    await store.putWorkingSet(ws);
    expect(await store.getAccounts()).toHaveLength(1);
    const activities = await store.getRecentActivities();
    expect(activities).toHaveLength(1); // the pending local write survived
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
