// Phase 4: the voice debrief rides the same outbox — offline capture survives
// (gate), the blob uploads before the row lands (D59), and the draft schema
// rejects malformed AI output before it reaches the review gate.

import { beforeEach, describe, expect, it } from "vitest";
import { debriefDraftSchema } from "@/lib/voice/draft";
import { DexieBlobStore } from "../blob-store.dexie";
import { DexieLocalStore } from "../local-store.dexie";
import { OutboxSyncEngine } from "../sync-engine";
import { FakeBackend } from "./fake-backend";

const ORG = "11111111-1111-1111-1111-111111111111";
const OWNER = "c0000000-0000-0000-0000-000000000003";

let local: DexieLocalStore;
let blobs: DexieBlobStore;
let backend: FakeBackend;
let engine: OutboxSyncEngine;
let n = 100;

beforeEach(() => {
  n += 1;
  local = new DexieLocalStore(`test-voice-${n}`);
  blobs = new DexieBlobStore(`test-voice-blobs-${n}`);
  backend = new FakeBackend();
  engine = new OutboxSyncEngine(local, blobs, backend);
});

describe("voice capture through the outbox", () => {
  it("survives offline capture: blob + row land exactly once on reconnect", async () => {
    const id = crypto.randomUUID();
    const audioPath = `${ORG}/user/${id}.m4a`;
    await blobs.put(`voice::${audioPath}`, new Blob(["fake-audio"]));

    backend.offline = true;
    await engine.enqueue({
      clientId: id,
      entityType: "voice_capture",
      op: "create",
      payload: {
        id,
        org_id: ORG,
        owner_id: OWNER,
        audio_path: audioPath,
        duration_seconds: 42,
        transcript: null,
        status: "UPLOADED",
        language: null,
      },
      baseVersion: null,
      blobRef: `voice::${audioPath}`,
    });
    await engine.drain();
    expect((await local.countByStatus()).pending).toBe(1);
    expect(backend.uploads.size).toBe(0); // nothing uploaded offline

    backend.offline = false;
    await engine.drain();
    await engine.drain(); // double fire

    expect(backend.uploads.has(`voice::${audioPath}`)).toBe(true);
    expect(backend.tables.get("voice_captures")!.size).toBe(1);
    expect(await blobs.get(`voice::${audioPath}`)).toBeNull(); // purged (D59)
  });

  it("typed debriefs need no blob and land with their transcript", async () => {
    const id = crypto.randomUUID();
    await engine.enqueue({
      clientId: id,
      entityType: "voice_capture",
      op: "create",
      payload: {
        id,
        org_id: ORG,
        owner_id: OWNER,
        audio_path: null,
        duration_seconds: null,
        transcript: "spoke with Mike about decking, quote by Friday",
        status: "UPLOADED",
        language: null,
      },
      baseVersion: null,
      blobRef: null,
    });
    await engine.drain();
    const row = backend.tables.get("voice_captures")!.get(id)!;
    expect(row.transcript).toContain("quote by Friday");
    expect(backend.calls.signedUrls).toBe(0);
  });

  it("review outcome updates are LWW-guarded like any scalar edit", async () => {
    await expect(
      engine.enqueue({
        clientId: crypto.randomUUID(),
        entityType: "voice_capture",
        op: "update",
        payload: { id: crypto.randomUUID(), status: "SENT" },
        baseVersion: null, // missing guard must be rejected at the boundary
        blobRef: null,
      }),
    ).rejects.toThrow(/baseVersion/);
  });
});

describe("debrief draft schema (the shape the review gate trusts)", () => {
  it("accepts a well-formed draft", () => {
    const draft = debriefDraftSchema.parse({
      summary: "PK class went well; two quote leads.",
      activity_type: "PK_TRAINING",
      what_happened: "Delivered PK to 8 counter staff",
      key_information: "They stock a competitor's ash boards",
      commercial_potential: "Two contractors asked for quotes",
      outcomes: ["TRAINING_NEEDED", "OPPORTUNITY_IDENTIFIED"],
      follow_up_required: true,
      next_actions: [
        { action: "Send quote to Mike", due_date: "2026-07-24", objective: null },
      ],
    });
    expect(draft.next_actions).toHaveLength(1);
  });

  it("rejects hallucinated enum values and date-less actions", () => {
    expect(() =>
      debriefDraftSchema.parse({
        summary: "x",
        activity_type: "SALES_BLITZ", // not a real type
        what_happened: "x",
        key_information: null,
        commercial_potential: null,
        outcomes: [],
        follow_up_required: false,
        next_actions: [],
      }),
    ).toThrow();
    expect(() =>
      debriefDraftSchema.parse({
        summary: "x",
        activity_type: "PHONE_CALL",
        what_happened: "x",
        key_information: null,
        commercial_potential: null,
        outcomes: [],
        follow_up_required: true,
        next_actions: [{ action: "call back", due_date: "soon", objective: null }],
      }),
    ).toThrow();
  });
});
