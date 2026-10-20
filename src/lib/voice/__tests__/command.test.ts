// Say it: the model's answer is held to what it was shown — an account it
// was not offered, a rep who is not on the list, a day that does not exist
// all come back empty for the card to ask, never as a wrong record.

import { describe, expect, it } from "vitest";
import { candidateAccounts, commandPrompt, sanitizeCommands, type CommandAccount } from "../command";

const ACCOUNTS: CommandAccount[] = [
  { id: "a-ganahl-ana", name: "Ganahl Lumber Anaheim", city: "Anaheim" },
  { id: "a-ganahl-cm", name: "Ganahl Lumber Costa Mesa", city: "Costa Mesa" },
  { id: "a-truckee", name: "Truckee Tahoe Lumber", city: "Truckee" },
  { id: "a-boise", name: "Boise Cascade", city: "Riverside" },
];

describe("which accounts the model is shown", () => {
  it("those sharing a word with what was said, best first", () => {
    const c = candidateAccounts("book me Ganahl Anaheim on Thursday", ACCOUNTS);
    expect(c[0].id).toBe("a-ganahl-ana");
    expect(c.map((a) => a.id)).toContain("a-ganahl-cm");
    expect(c.map((a) => a.id)).not.toContain("a-truckee");
  });

  it("ignores accents and the words every lumber yard shares", () => {
    expect(candidateAccounts("ligar à Truckée amanhã", ACCOUNTS).map((a) => a.id)).toEqual(["a-truckee"]);
    expect(candidateAccounts("call the lumber company", ACCOUNTS)).toEqual([]);
  });
});

describe("the prompt", () => {
  it("names today's weekday so 'Thursday' can be resolved", () => {
    expect(commandPrompt("2026-10-20", [], [])).toContain("Today is Tuesday 2026-10-20");
  });

  it("offers reps only to someone who books for them", () => {
    expect(commandPrompt("2026-10-20", [], [])).toContain("always null");
    expect(commandPrompt("2026-10-20", [], [{ membershipId: "m-jason", name: "Jason Benford" }])).toContain(
      "m-jason: Jason Benford",
    );
  });
});

describe("what comes back", () => {
  const shown = ACCOUNTS.slice(0, 2);
  const reps = [{ membershipId: "m-jason", name: "Jason Benford" }];

  it("keeps a clean visit", () => {
    const [c] = sanitizeCommands(
      {
        commands: [
          {
            kind: "VISIT",
            account_id: "a-ganahl-ana",
            account_heard: "Ganahl Anaheim",
            due_date: "2026-10-22",
            action: "Collect the decking quote",
            objective: "COLLECT_QUOTE",
            owner_membership_id: "m-jason",
          },
        ],
      },
      shown,
      reps,
    );
    expect(c).toEqual({
      kind: "VISIT",
      accountId: "a-ganahl-ana",
      accountHeard: "Ganahl Anaheim",
      dueDate: "2026-10-22",
      action: "Collect the decking quote",
      objective: "COLLECT_QUOTE",
      ownerId: "m-jason",
    });
  });

  it("drops an account it was not shown, a stranger as owner, and a day that is not one", () => {
    const [c] = sanitizeCommands(
      {
        commands: [
          {
            kind: "FOLLOW_UP",
            account_id: "a-truckee",
            account_heard: "Truckee",
            due_date: "2026-02-30",
            action: "Call the buyer",
            objective: "COLLECT_QUOTE",
            owner_membership_id: "m-nobody",
          },
        ],
      },
      shown,
      reps,
    );
    expect(c.accountId).toBeNull();
    expect(c.accountHeard).toBe("Truckee");
    expect(c.dueDate).toBeNull();
    expect(c.ownerId).toBeNull();
    expect(c.objective).toBeNull(); // only a visit has a purpose
  });

  it("never more than three, and nothing without an action", () => {
    const one = {
      kind: "FOLLOW_UP" as const,
      account_id: null,
      account_heard: null,
      due_date: null,
      action: "x",
      objective: null,
      owner_membership_id: null,
    };
    expect(sanitizeCommands({ commands: [one, one, one, one] }, shown, reps)).toHaveLength(3);
    expect(sanitizeCommands({ commands: [{ ...one, action: "  " }] }, shown, reps)).toEqual([]);
  });
});
