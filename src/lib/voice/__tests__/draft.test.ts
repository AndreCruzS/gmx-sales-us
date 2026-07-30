// Task 9 (D-routine): the debrief draft schema learns two new things from a
// voice capture — routine_dispositions (chores the rep addressed) and typed
// commitments (next_actions gain `kind`). sanitizeDraft is the hallucination
// guard: the model must never be trusted to invent item ids, so anything not
// in the caller's own openItemIds list gets dropped post-hoc.

import { describe, expect, it } from "vitest";
import {
  debriefDraftSchema,
  extractionPrompt,
  sanitizeDraft,
  type DebriefDraft,
} from "../draft";

function baseDraft(overrides: Partial<DebriefDraft> = {}): DebriefDraft {
  return {
    summary: "Visited the dealer, discussed samples.",
    activity_type: "DEALER_VISIT",
    what_happened: "Talked about display wall placement.",
    key_information: null,
    commercial_potential: null,
    outcomes: [],
    follow_up_required: false,
    next_actions: [],
    routine_dispositions: [],
    ...overrides,
  };
}

describe("debriefDraftSchema", () => {
  it("parses commitments (next_actions) without a kind (nullable)", () => {
    const draft = baseDraft({
      follow_up_required: true,
      next_actions: [
        {
          action: "Send follow-up email",
          due_date: "2026-08-01",
          objective: null,
          kind: null,
        },
      ],
    });
    const result = debriefDraftSchema.safeParse(draft);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.next_actions[0].kind).toBeNull();
    }
  });

  it("parses commitments with a typed kind", () => {
    const draft = baseDraft({
      follow_up_required: true,
      next_actions: [
        {
          action: "Send sample A",
          due_date: "2026-08-01",
          objective: null,
          kind: "SAMPLE_FOLLOW_UP",
        },
      ],
    });
    const result = debriefDraftSchema.safeParse(draft);
    expect(result.success).toBe(true);
  });
});

describe("sanitizeDraft", () => {
  it("drops any routine_disposition whose item_id is not in openItemIds", () => {
    const draft = baseDraft({
      routine_dispositions: [
        { item_id: "real-1", disposition: "DONE", note: null },
        { item_id: "hallucinated-99", disposition: "DISPLAY_VERIFIED", note: null },
      ],
    });
    const sanitized = sanitizeDraft(draft, ["real-1"]);
    expect(sanitized.routine_dispositions).toEqual([
      { item_id: "real-1", disposition: "DONE", note: null },
    ]);
  });

  it("does not mutate its input", () => {
    const draft = baseDraft({
      routine_dispositions: [
        { item_id: "real-1", disposition: "DONE", note: null },
        { item_id: "hallucinated-99", disposition: "DONE", note: null },
      ],
    });
    const original = JSON.parse(JSON.stringify(draft));
    sanitizeDraft(draft, ["real-1"]);
    expect(draft).toEqual(original);
  });
});

describe("extractionPrompt", () => {
  it("is byte-stable when routineContext is absent or empty", () => {
    const withoutArg = extractionPrompt("2026-07-30T10:00:00.000Z", "en");
    const withUndefined = extractionPrompt(
      "2026-07-30T10:00:00.000Z",
      "en",
      undefined,
    );
    const withEmpty = extractionPrompt("2026-07-30T10:00:00.000Z", "en", []);
    expect(withoutArg).toBe(withUndefined);
    expect(withoutArg).toBe(withEmpty);
    expect(withoutArg).not.toMatch(/routine/i);
  });

  it("appends the open items and the hallucination-guard instruction when context is present", () => {
    const prompt = extractionPrompt("2026-07-30T10:00:00.000Z", "en", [
      { item_id: "real-1", kind: "SAMPLE_FOLLOW_UP", action: "Follow up on samples" },
    ]);
    expect(prompt).toContain("real-1");
    expect(prompt).toContain("SAMPLE_FOLLOW_UP");
    expect(prompt).toContain("Follow up on samples");
    expect(prompt).toContain(
      "Propose a disposition ONLY for items the rep explicitly mentioned. Never invent item ids.",
    );
  });
});
