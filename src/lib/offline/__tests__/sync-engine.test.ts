// Phase 2 gate tests (build brief §3):
//   1. airplane-mode capture → reconnect → exactly-once record
//   2. double-fired sync produces no duplicates
//   3. stale edit lands in the error tray (never clobbered, never dropped)
// plus D59 blob timing and D62 RLS-rejection-at-replay.

import { beforeEach, describe, expect, it } from "vitest";
import { DexieBlobStore } from "../blob-store.dexie";
import { DexieLocalStore } from "../local-store.dexie";
import { OutboxSyncEngine } from "../sync-engine";
import { FakeBackend } from "./fake-backend";

const ORG = "11111111-1111-1111-1111-111111111111";
const OWNER = "c0000000-0000-0000-0000-000000000003";
const ACCOUNT = "d0000000-0000-0000-0000-000000000003";

let local: DexieLocalStore;
let blobs: DexieBlobStore;
let backend: FakeBackend;
let engine: OutboxSyncEngine;
let dbCounter = 0;

function activityPayload(id: string) {
  return {
    id,
    org_id: ORG,
    activity_type: "DEALER_VISIT",
    primary_account_id: ACCOUNT,
    owner_id: OWNER,
    occurred_at: new Date().toISOString(),
    was_planned: false,
    outcomes: [],
    what_happened: "quick note from the truck",
    follow_up_required: true,
  };
}

beforeEach(() => {
  dbCounter += 1;
  local = new DexieLocalStore(`test-offline-${dbCounter}`);
  blobs = new DexieBlobStore(`test-blobs-${dbCounter}`);
  backend = new FakeBackend();
  engine = new OutboxSyncEngine(local, blobs, backend);
});

describe("gate 1 — airplane-mode capture, exactly-once on reconnect", () => {
  it("keeps the record pending offline, lands it exactly once when back", async () => {
    const id = crypto.randomUUID();
    backend.offline = true;

    await engine.enqueue({
      clientId: id,
      entityType: "activity",
      op: "create",
      payload: activityPayload(id),
      baseVersion: null,
      blobRef: null,
    });

    await engine.drain(); // airplane mode: must not throw, must not lose
    expect((await local.countByStatus()).pending).toBe(1);
    expect(backend.tables.get("activities")?.size ?? 0).toBe(0);

    backend.offline = false; // reconnect
    await engine.drain();

    expect(backend.tables.get("activities")!.size).toBe(1);
    expect((await local.countByStatus()).synced).toBe(1);
    expect((await local.countByStatus()).pending).toBe(0);
  });
});

describe("gate 2 — double-fired sync produces no duplicates", () => {
  it("concurrent drains land one record", async () => {
    const id = crypto.randomUUID();
    await engine.enqueue({
      clientId: id,
      entityType: "activity",
      op: "create",
      payload: activityPayload(id),
      baseVersion: null,
      blobRef: null,
    });

    await Promise.all([engine.drain(), engine.drain(), engine.drain()]);
    expect(backend.tables.get("activities")!.size).toBe(1);
  });

  it("a replay after partial failure is idempotent server-side", async () => {
    // The server already has the row (first attempt landed but the ack was
    // lost), the outbox record is still pending — replay must be a no-op.
    const id = crypto.randomUUID();
    const payload = activityPayload(id);
    backend.seed("activities", payload);

    await engine.enqueue({
      clientId: id,
      entityType: "activity",
      op: "create",
      payload,
      baseVersion: null,
      blobRef: null,
    });
    await engine.drain();

    expect(backend.tables.get("activities")!.size).toBe(1);
    expect((await local.countByStatus()).synced).toBe(1);
  });
});

describe("gate 3 — stale edit lands in the error tray", () => {
  it("rejects an LWW-stale update into the tray, preserving the payload", async () => {
    const id = crypto.randomUUID();
    const serverRow = backend.seed("next_actions", {
      id,
      action: "Visit Ganahl",
      due_date: "2026-07-25",
    });
    const staleVersion = serverRow.updated_at;

    // Manager reschedules while the rep is offline → server version moves on.
    await backend.updateWithVersion(
      "next_actions",
      id,
      { due_date: "2026-07-28" },
      serverRow.updated_at,
    );

    // The rep's offline edit replays against the stale base version.
    await engine.enqueue({
      clientId: id,
      entityType: "next_action",
      op: "update",
      payload: { id, completed_at: new Date().toISOString() },
      baseVersion: staleVersion,
      blobRef: null,
    });
    await engine.drain();

    const tray = await local.listRejected();
    expect(tray).toHaveLength(1);
    expect(tray[0].clientId).toBe(id);
    expect(tray[0].lastError).toMatch(/stale/i);
    expect(tray[0].payload).toHaveProperty("completed_at"); // preserved, not dropped
    // The manager's reschedule was NOT clobbered.
    expect(backend.tables.get("next_actions")!.get(id)!.due_date).toBe("2026-07-28");
    // A rejected record is never retried by later drains.
    await engine.drain();
    expect((await local.countByStatus()).rejected).toBe(1);
  });

  it("routes an RLS rejection at replay to the tray (D62), then keeps draining", async () => {
    const idRejected = crypto.randomUUID();
    const idOk = crypto.randomUUID();
    await engine.enqueue({
      clientId: idRejected,
      entityType: "activity",
      op: "create",
      payload: activityPayload(idRejected),
      baseVersion: null,
      blobRef: null,
    });
    await engine.enqueue({
      clientId: idOk,
      entityType: "activity",
      op: "create",
      payload: activityPayload(idOk),
      baseVersion: null,
      blobRef: null,
    });

    backend.rejectNextAs = "rls"; // e.g. territory reassigned before replay
    await engine.drain();

    const counts = await local.countByStatus();
    expect(counts.rejected).toBe(1);
    expect(counts.synced).toBe(1); // the queue kept draining past the rejection
    expect(backend.tables.get("activities")!.has(idOk)).toBe(true);
  });
});

describe("blob timing (D59)", () => {
  it("mints the signed URL at drain time and purges the blob after upload", async () => {
    const id = crypto.randomUUID();
    const blobRef = "voice::org/user/capture.m4a";
    await blobs.put(blobRef, new Blob(["audio-bytes"]));

    backend.offline = true;
    await engine.enqueue({
      clientId: id,
      entityType: "activity",
      op: "create",
      payload: activityPayload(id),
      baseVersion: null,
      blobRef,
    });
    await engine.drain();
    expect(backend.calls.signedUrls).toBe(0); // captured offline: NO URL minted yet

    backend.offline = false;
    await engine.drain();

    expect(backend.calls.signedUrls).toBe(1); // minted at sync time
    expect(backend.uploads.has("voice::org/user/capture.m4a")).toBe(true);
    expect(await blobs.get(blobRef)).toBeNull(); // purged after confirmed upload
  });
});

describe("outbox boundary validation", () => {
  it("refuses an update without a baseVersion (D61 guard)", async () => {
    await expect(
      engine.enqueue({
        clientId: crypto.randomUUID(),
        entityType: "next_action",
        op: "update",
        payload: { id: crypto.randomUUID() },
        baseVersion: null,
        blobRef: null,
      }),
    ).rejects.toThrow(/baseVersion/);
  });

  it("refuses a payload that fails schema validation at capture time", async () => {
    const id = crypto.randomUUID();
    await expect(
      engine.enqueue({
        clientId: id,
        entityType: "activity",
        op: "create",
        payload: { id, org_id: "not-a-uuid" },
        baseVersion: null,
        blobRef: null,
      }),
    ).rejects.toThrow();
  });
});
