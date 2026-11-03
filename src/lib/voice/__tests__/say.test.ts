import { describe, expect, it } from "vitest";
import { hasVisit, sanitizeSayDraft, sayDraftSchema, sayPrompt, type SayDraftRaw } from "@/lib/voice/say";

const accounts = [
  { id: "a-buffalo", name: "Buffalo Lumber Co", city: "Buffalo" },
  { id: "a-truckee", name: "Truckee Tahoe Lumber", city: "Truckee" },
];
const team = [
  { membershipId: "m-tj", name: "TJ Rep", role: "rep, the speaker" },
  { membershipId: "m-bia", name: "Bianca Admin", role: "admin" },
];

function raw(over: Partial<SayDraftRaw> = {}): SayDraftRaw {
  return {
    account_id: "a-buffalo",
    summary: "PK at Buffalo.",
    activity_type: "PK_TRAINING",
    what_happened: "Trained eight of the counter staff.",
    key_information: null,
    commercial_potential: null,
    outcomes: [],
    follow_up_required: true,
    next_actions: [{ action: "Send the Maximo literature", due_date: "2026-11-05", objective: null, kind: null }],
    routine_dispositions: [],
    contacts: [],
    has_visit: true,
    bookings: [
      {
        kind: "FOLLOW_UP",
        account_id: "a-buffalo",
        account_heard: "Buffalo",
        due_date: "2026-11-09",
        time: "14:00",
        follow_up_type: "CALL",
        action: "Call their buyer about the samples",
        objective: null,
        owner_membership_id: null,
        teammate_membership_id: null,
      },
    ],
    ...over,
  };
}

const ctx = { openItemIds: [], accounts, reps: [], team, speakerId: "m-tj" };

describe("one microphone: one reading of what was said", () => {
  it("keeps the visit, its follow-ups, and the booking as Say it reads it", () => {
    const d = sanitizeSayDraft(raw(), ctx);
    expect(d.has_visit).toBe(true);
    expect(d.account_id).toBe("a-buffalo");
    expect(d.next_actions).toHaveLength(1);
    expect(d.commands).toHaveLength(1);
    expect(d.commands![0]).toMatchObject({ kind: "FOLLOW_UP", followUpType: "CALL", time: "14:00" });
    expect(d.team).toEqual(team);
  });

  it("drops follow-ups when no visit happened, and holds ids to what was shown", () => {
    const d = sanitizeSayDraft(
      raw({
        has_visit: false,
        account_id: "a-invented",
        bookings: [{ ...raw().bookings[0], account_id: "a-invented" }],
      }),
      ctx,
    );
    expect(d.next_actions).toEqual([]);
    expect(d.account_id).toBeNull();
    expect(d.commands![0].accountId).toBeNull();
  });

  it("reads a draft stored before one-mic as a visit", () => {
    expect(hasVisit({})).toBe(true);
    expect(hasVisit({ has_visit: false })).toBe(false);
  });

  it("parses with the new fields and asks for both halves", () => {
    expect(sayDraftSchema.safeParse(raw()).success).toBe(true);
    const p = sayPrompt({
      capturedAtIso: "2026-11-04T15:00:00Z",
      language: "en",
      today: "2026-11-04",
      accounts,
      reps: [],
      team,
    });
    expect(p).toContain("has_visit");
    expect(p).toContain("a-buffalo — Buffalo Lumber Co · Buffalo");
    expect(p).toContain("Bia is Bianca");
  });
});
