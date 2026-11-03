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

  it("lists GMX's own people once, and lets only a desk role hand work out", () => {
    const team = [
      { membershipId: "m-bia", name: "Bianca Souza", role: "admin" },
      { membershipId: "m-joao", name: "João Lima", role: "admin" },
      { membershipId: "m-jason", name: "Jason Benford", role: "rep" },
    ];
    expect(commandPrompt("2026-10-20", [], [])).toContain("always null");
    const desk = commandPrompt("2026-10-20", [], [{ membershipId: "m-jason", name: "Jason Benford" }], team);
    expect(desk).toContain("m-joao: João Lima · admin");
    expect(desk).toContain("Bia is Bianca, John is João");
    expect(desk).toContain("owner_membership_id = them");
    const rep = commandPrompt("2026-10-20", [], [], team);
    expect(rep).toContain("cannot hand work to others");
  });
});

describe("a follow-up with a teammate", () => {
  const team = [{ membershipId: "m-bia", name: "Bianca Souza", role: "admin" }];
  const raw = (over: Record<string, unknown>) => ({
    commands: [
      {
        kind: "FOLLOW_UP" as const,
        account_id: null,
        account_heard: "Bia",
        due_date: "2026-11-04",
        time: null,
        follow_up_type: null,
        action: "Call Bianca Souza at 9",
        objective: null,
        owner_membership_id: null,
        teammate_membership_id: "m-bia",
        ...over,
      },
    ],
  });
  it("keeps the teammate and drops the name heard as a business", () => {
    const [c] = sanitizeCommands(raw({}), [], [], team);
    expect(c.teammateId).toBe("m-bia");
    expect(c.accountHeard).toBeNull();
  });
  it("refuses a teammate it was not shown, and one on a visit", () => {
    expect(sanitizeCommands(raw({ teammate_membership_id: "m-x" }), [], [], team)[0].teammateId).toBeNull();
    expect(sanitizeCommands(raw({ kind: "VISIT" }), [], [], team)[0].teammateId).toBeNull();
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
            time: null,
            follow_up_type: null,
            action: "Collect the decking quote",
            objective: "COLLECT_QUOTE",
            owner_membership_id: "m-jason",
            teammate_membership_id: null,
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
      time: null,
      followUpType: null,
      action: "Collect the decking quote",
      objective: "COLLECT_QUOTE",
      ownerId: "m-jason",
      teammateId: null,
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
            time: null,
            follow_up_type: null,
            action: "Call the buyer",
            objective: "COLLECT_QUOTE",
            owner_membership_id: "m-nobody",
            teammate_membership_id: null,
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
      time: null,
      follow_up_type: null,
      action: "x",
      objective: null,
      owner_membership_id: null,
      teammate_membership_id: null,
    };
    expect(sanitizeCommands({ commands: [one, one, one, one] }, shown, reps)).toHaveLength(3);
    expect(sanitizeCommands({ commands: [{ ...one, action: "  " }] }, shown, reps)).toEqual([]);
  });
});

describe("times and follow-up types (2026-11-04)", () => {
  const base = {
    account_id: null,
    account_heard: null,
    due_date: "2026-11-09",
    objective: null,
    owner_membership_id: null,
    teammate_membership_id: null,
  };

  it("keeps a call's time and type", () => {
    const [c] = sanitizeCommands(
      { commands: [{ ...base, kind: "FOLLOW_UP", time: "14:00", follow_up_type: "CALL", action: "Call Truckee" }] },
      [],
      [],
    );
    expect(c.time).toBe("14:00");
    expect(c.followUpType).toBe("CALL");
  });

  it("drops a time that is not one, and any time on a quote", () => {
    const [bad, quote] = sanitizeCommands(
      {
        commands: [
          { ...base, kind: "VISIT", time: "25:00", follow_up_type: null, action: "Visit" },
          { ...base, kind: "QUOTE", time: "10:00", follow_up_type: null, action: "Ipe 1x6" },
        ],
      },
      [],
      [],
    );
    expect(bad.time).toBeNull();
    expect(quote.time).toBeNull();
  });

  it("reads a follow-up with no type as a to-do, and a visit as having none", () => {
    const [f, v] = sanitizeCommands(
      {
        commands: [
          { ...base, kind: "FOLLOW_UP", time: null, follow_up_type: null, action: "Send the samples" },
          { ...base, kind: "VISIT", time: "9:30", follow_up_type: "CALL", action: "Visit" },
        ],
      },
      [],
      [],
    );
    expect(f.followUpType).toBe("TASK");
    expect(v.followUpType).toBeNull();
    expect(v.time).toBe("09:30");
  });
});
