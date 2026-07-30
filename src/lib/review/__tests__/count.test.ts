// Task 7: the review count is what the tab badge and Home's "Waiting your
// OK" tile both read — rejected saves (always known locally, D61/D62) plus
// captures/candidates waiting on the rep (server-sourced, cached by the
// review page into `review_counts` meta so the count survives offline).

import { describe, expect, it } from "vitest";
import type { LocalStore, OutboxRecord } from "../../offline/types";
import { reviewCount } from "../count";

function outboxRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    seq: 1,
    clientId: crypto.randomUUID(),
    entityType: "activity",
    op: "create",
    payload: {},
    baseVersion: null,
    blobRef: null,
    status: "rejected",
    attempts: 1,
    lastError: "conflict",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// Minimal fake — reviewCount only touches listRejected/getMeta, so the rest
// throw if ever called, catching an accidental widening of the contract.
function fakeStore(overrides: Partial<LocalStore> = {}): LocalStore {
  const notImplemented = () => {
    throw new Error("not implemented in fake");
  };
  return {
    putWorkingSet: notImplemented,
    getAccounts: notImplemented,
    getContacts: notImplemented,
    getAgenda: notImplemented,
    getRecentActivities: notImplemented,
    putLocalActivity: notImplemented,
    putLocalAccount: notImplemented,
    getMeta: async () => null,
    setMeta: notImplemented,
    enqueue: notImplemented,
    nextPending: notImplemented,
    updateOutbox: notImplemented,
    countByStatus: notImplemented,
    listRejected: async () => [],
    deleteOutbox: notImplemented,
    wipe: notImplemented,
    ...overrides,
  };
}

describe("reviewCount", () => {
  it("sums rejected outbox records with captures + candidates waiting", async () => {
    const store = fakeStore({
      listRejected: async () => [outboxRecord(), outboxRecord({ seq: 2 })],
      getMeta: async (key) =>
        key === "review_counts"
          ? JSON.stringify({ captures: 1, candidates: 3 })
          : null,
    });

    await expect(reviewCount(store)).resolves.toBe(6);
  });

  it("counts only rejected saves when review_counts meta is absent", async () => {
    const store = fakeStore({
      listRejected: async () => [outboxRecord(), outboxRecord({ seq: 2 })],
      getMeta: async () => null,
    });

    await expect(reviewCount(store)).resolves.toBe(2);
  });
});
