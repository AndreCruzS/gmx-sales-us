import { describe, expect, it } from "vitest";
import { outboxPayloadSchemas } from "@/lib/domain/schemas";
import { debriefDraftSchema } from "@/lib/voice/draft";

const U = "11111111-1111-4111-8111-111111111111";

describe("PK by voice (2026-11-04)", () => {
  it("parses a PK follow-up with its fields, and an old one without them", () => {
    const base = {
      account_id: null,
      summary: "s",
      activity_type: "PK_TRAINING",
      what_happened: "w",
      key_information: null,
      commercial_potential: null,
      outcomes: [],
      follow_up_required: true,
      routine_dispositions: [],
      contacts: [],
    };
    const now = debriefDraftSchema.parse({
      ...base,
      next_actions: [
        {
          action: "Send the literature",
          due_date: "2026-11-04",
          objective: null,
          kind: null,
          priority: "DO_NOW",
          progress: "WAITING",
          subtasks: ["PDF"],
          note: "Urgent.",
        },
      ],
    });
    expect(now.next_actions[0].subtasks).toEqual(["PDF"]);
    const old = debriefDraftSchema.parse({
      ...base,
      next_actions: [{ action: "x", due_date: "2026-11-04", objective: null, kind: null }],
    });
    expect(old.next_actions[0]).toMatchObject({ priority: null, progress: null, subtasks: [], note: null });
  });

  it("never drafts Delegate, Stuck or Done", () => {
    const one = (p: Record<string, unknown>) =>
      debriefDraftSchema.shape.next_actions.element.safeParse({
        action: "x",
        due_date: "2026-11-04",
        objective: null,
        kind: null,
        ...p,
      }).success;
    expect(one({ priority: "DELEGATE" })).toBe(false);
    expect(one({ progress: "STUCK" })).toBe(false);
    expect(one({ progress: "DONE" })).toBe(false);
  });

  it("the outbox carries a checklist line and a note, and refuses an empty one", () => {
    const sub = outboxPayloadSchemas["next_action_subtask:create"];
    const note = outboxPayloadSchemas["next_action_note:create"];
    expect(sub.safeParse({ id: U, org_id: U, next_action_id: U, title: "PDF", position: 0 }).success).toBe(true);
    expect(sub.safeParse({ id: U, org_id: U, next_action_id: U, title: " ", position: 0 }).success).toBe(false);
    expect(note.safeParse({ id: U, org_id: U, next_action_id: U, body: "Urgent." }).success).toBe(true);
    expect(note.safeParse({ id: U, org_id: U, next_action_id: U, body: "" }).success).toBe(false);
  });
});
