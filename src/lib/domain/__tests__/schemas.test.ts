// Task 5: Record accepts pre-links. voice_captures gained account_id and
// planned_action_id (Task 1) so a debrief captured from a deep link
// (?visit=<nextActionId> or ?account=<id>&item=<nextActionId>) carries its
// context all the way through the outbox.

import { describe, expect, it } from "vitest";
import {
  accountCreateSchema,
  accountRelationshipCreateSchema,
  outboxPayloadSchemas,
  voiceCaptureCreateSchema,
} from "@/lib/domain/schemas";

const ORG = "11111111-1111-1111-1111-111111111111";
const OWNER = "c0000000-0000-0000-0000-000000000003";
const ACCOUNT = "a0000000-0000-0000-0000-000000000001";
const PLANNED_ACTION = "b0000000-0000-0000-0000-000000000002";
const TERRITORY = "d0000000-0000-0000-0000-000000000004";
const REFERRING_ACCOUNT = "e0000000-0000-0000-0000-000000000005";

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

// Task 11: the standalone /accounts/new form is allowed to write a referral
// (unlike the card quick-create, which routes referral sources here instead).
const accountFixture = {
  id: crypto.randomUUID(),
  org_id: ORG,
  name: "Ganahl Anaheim",
  account_type: "DEALER" as const,
  city: "Anaheim",
  territory_id: TERRITORY,
  owner_id: OWNER,
};

describe("accountCreateSchema — D7/D8 lead-source rules", () => {
  it("accepts a non-referral, non-OTHER source with no extra fields", () => {
    expect(() =>
      accountCreateSchema.parse({ ...accountFixture, lead_source: "JOBSITE" }),
    ).not.toThrow();
  });

  it("rejects OTHER with no source_detail (D8)", () => {
    expect(() =>
      accountCreateSchema.parse({ ...accountFixture, lead_source: "OTHER" }),
    ).toThrow();
  });

  it("accepts OTHER once source_detail is set (D8)", () => {
    expect(() =>
      accountCreateSchema.parse({
        ...accountFixture,
        lead_source: "OTHER",
        source_detail: "trade magazine ad",
      }),
    ).not.toThrow();
  });

  it("rejects a referral source with no referring_account_id (D7)", () => {
    expect(() =>
      accountCreateSchema.parse({
        ...accountFixture,
        lead_source: "REFERRAL_DEALER",
      }),
    ).toThrow();
  });

  it("accepts a referral source once referring_account_id is set (D7)", () => {
    const parsed = accountCreateSchema.parse({
      ...accountFixture,
      lead_source: "REFERRAL_DEALER",
      referring_account_id: REFERRING_ACCOUNT,
    });
    expect(parsed.referring_account_id).toBe(REFERRING_ACCOUNT);
  });
});

describe("accountRelationshipCreateSchema — the referral fan-out row (D4/D7)", () => {
  it("parses the REFERRED_BY row the account form writes", () => {
    const parsed = accountRelationshipCreateSchema.parse({
      id: crypto.randomUUID(),
      org_id: ORG,
      account_a_id: ACCOUNT,
      relationship_type: "REFERRED_BY",
      account_b_id: REFERRING_ACCOUNT,
      created_by: OWNER,
    });
    expect(parsed.relationship_type).toBe("REFERRED_BY");
  });

  it("rejects a relationship_type outside the DB enum", () => {
    expect(() =>
      accountRelationshipCreateSchema.parse({
        id: crypto.randomUUID(),
        org_id: ORG,
        account_a_id: ACCOUNT,
        relationship_type: "NOT_A_REAL_TYPE",
        account_b_id: REFERRING_ACCOUNT,
      }),
    ).toThrow();
  });

  it("is registered on the outbox boundary as account_relationship:create", () => {
    expect(outboxPayloadSchemas["account_relationship:create"]).toBe(
      accountRelationshipCreateSchema,
    );
  });
});
