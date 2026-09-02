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
    account_id: null,
    summary: "Visited the dealer, discussed samples.",
    activity_type: "DEALER_VISIT",
    what_happened: "Talked about display wall placement.",
    key_information: null,
    commercial_potential: null,
    outcomes: [],
    follow_up_required: false,
    next_actions: [],
    routine_dispositions: [],
    contacts: [],
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
  it("keeps only contact suggestions with a name and something worth keeping", () => {
    const draft = baseDraft({
      contacts: [
        // trimmed, e-mail lowercased — kept
        {
          name: " Robert Davis ",
          job_title: null,
          email: " RobertD@Big-Creek.com ",
          phone: null,
        },
        // a name with nothing to reach them by and no role — dropped
        { name: "Nobody Reachable", job_title: null, email: null, phone: null },
        // no name at all — dropped
        { name: "  ", job_title: "Manager", email: null, phone: null },
      ],
    });
    const out = sanitizeDraft(draft, [], []);
    expect(out.contacts).toEqual([
      {
        name: "Robert Davis",
        job_title: null,
        email: "robertd@big-creek.com",
        phone: null,
      },
    ]);
  });

  it("defends drafts extracted before the contacts field existed", () => {
    const legacy = baseDraft();
    // simulate a stored ai_draft from before the field
    delete (legacy as Partial<DebriefDraft>).contacts;
    expect(sanitizeDraft(legacy, [], []).contacts).toEqual([]);
  });

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

describe("the account the system proposes", () => {
  it("keeps an account it was actually offered", () => {
    const draft = baseDraft({ account_id: "acct-1" });
    expect(sanitizeDraft(draft, [], ["acct-1", "acct-2"]).account_id).toBe("acct-1");
  });

  it("drops one it invented", () => {
    // The sharp edge: an id nobody offered either fails a foreign key on Send or,
    // worse, lands on a real account that happens to match. Null costs the rep one
    // dropdown; a wrong account files a visit against a company they never visited.
    const draft = baseDraft({ account_id: "acct-99" });
    expect(sanitizeDraft(draft, [], ["acct-1"]).account_id).toBeNull();
  });

  it("drops it when the caller cannot say what was offered", () => {
    // A caller that does not pass the list cannot vouch for the answer, so the
    // default has to be refusal rather than trust.
    const draft = baseDraft({ account_id: "acct-1" });
    expect(sanitizeDraft(draft, []).account_id).toBeNull();
  });

  it("leaves a null alone", () => {
    expect(sanitizeDraft(baseDraft({ account_id: null }), [], ["acct-1"]).account_id).toBeNull();
  });
});

describe("the prompt that asks for it", () => {
  it("lists the rep's accounts and forbids anything else", () => {
    const p = extractionPrompt("2026-08-17T10:00:00Z", "en", undefined, [
      { account_id: "acct-1", name: "Ganahl Anaheim" },
      { account_id: "acct-2", name: "Buffalo Lumber Co" },
    ]);
    expect(p).toContain("acct-1 — Ganahl Anaheim");
    expect(p).toContain("acct-2 — Buffalo Lumber Co");
    expect(p).toContain("Never return an id that is not on this list");
    // Null has to be presented as the safe answer, or the model will always guess.
    expect(p).toContain("null is always the safer");
  });

  it("says nothing about accounts when there are none to offer", () => {
    const p = extractionPrompt("2026-08-17T10:00:00Z", "en");
    expect(p).not.toContain("account_id to the id");
  });

  it("carries both kinds of context at once", () => {
    const p = extractionPrompt(
      "2026-08-17T10:00:00Z", "en",
      [{ item_id: "r1", kind: "DISPLAY_CHECK", action: "Check the wall" }],
      [{ account_id: "acct-1", name: "Ganahl Anaheim" }],
    );
    expect(p).toContain("Ganahl Anaheim");
    expect(p).toContain("Check the wall");
  });
});
