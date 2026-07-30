// Task 5: Record accepts pre-links. voice_captures gained account_id and
// planned_action_id (Task 1) so a debrief captured from a deep link
// (?visit=<nextActionId> or ?account=<id>&item=<nextActionId>) carries its
// context all the way through the outbox.

import { describe, expect, it } from "vitest";
import { voiceCaptureCreateSchema } from "@/lib/domain/schemas";

const ORG = "11111111-1111-1111-1111-111111111111";
const OWNER = "c0000000-0000-0000-0000-000000000003";
const ACCOUNT = "a0000000-0000-0000-0000-000000000001";
const PLANNED_ACTION = "b0000000-0000-0000-0000-000000000002";

const baseFixture = {
  id: crypto.randomUUID(),
  org_id: ORG,
  owner_id: OWNER,
  audio_path: null,
  duration_seconds: null,
  transcript: "spoke with Mike about decking, quote by Friday",
  status: "UPLOADED" as const,
  language: null,
};

describe("voiceCaptureCreateSchema — pre-linked debriefs (D46 deep links)", () => {
  it("accepts and preserves account_id and planned_action_id when both are set", () => {
    const parsed = voiceCaptureCreateSchema.parse({
      ...baseFixture,
      account_id: ACCOUNT,
      planned_action_id: PLANNED_ACTION,
    });
    expect(parsed.account_id).toBe(ACCOUNT);
    expect(parsed.planned_action_id).toBe(PLANNED_ACTION);
  });

  it("is fine with both fields missing", () => {
    const parsed = voiceCaptureCreateSchema.parse({ ...baseFixture });
    expect(parsed.account_id).toBeUndefined();
    expect(parsed.planned_action_id).toBeUndefined();
  });

  it("is fine with both fields explicitly null", () => {
    const parsed = voiceCaptureCreateSchema.parse({
      ...baseFixture,
      account_id: null,
      planned_action_id: null,
    });
    expect(parsed.account_id).toBeNull();
    expect(parsed.planned_action_id).toBeNull();
  });
});
