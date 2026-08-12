// The company lens exists to make one fact visible: a banner worked by several
// reps with nobody holding the relationship. These tests pin the two rules that
// are easy to get subtly wrong — a banner heads its group rather than sitting
// inside it, and only its locations decide who works it.

import { describe, expect, it } from "vitest";
import { groupByCompany, type GroupableAccount } from "@/lib/domain/companies";

const acct = (
  id: string,
  name: string,
  parent: string | null = null,
  owner: string | null = null,
): GroupableAccount => ({
  id,
  name,
  parent_account_id: parent,
  owner_id: owner,
});

describe("groupByCompany", () => {
  it("puts branches under their banner and keeps the banner out of its own list", () => {
    const groups = groupByCompany([
      acct("ganahl", "Ganahl Lumber", null, "deon"),
      acct("anaheim", "Ganahl Anaheim", "ganahl", "deon"),
      acct("corona", "Ganahl Corona", "ganahl", "deon"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("ganahl");
    expect(groups[0].name).toBe("Ganahl Lumber");
    expect(groups[0].branches.map((b) => b.id)).toEqual(["anaheim", "corona"]);
    expect(groups[0].shared).toBe(false);
  });

  it("marks a banner shared when its locations are split across reps", () => {
    const groups = groupByCompany([
      acct("dixieline", "Dixieline", null, "alejandro"),
      acct("el-cajon", "Dixieline El Cajon", "dixieline", "alejandro"),
      acct("dana-point", "Dixieline Dana Point", "dixieline", "deon"),
    ]);

    expect(groups[0].shared).toBe(true);
    expect(groups[0].owners.sort()).toEqual(["alejandro", "deon"]);
  });

  it("does not count the banner's own owner as working the locations", () => {
    // The banner is held by a national account manager; every location is
    // Deon's. That is one rep on the ground, not two.
    const groups = groupByCompany([
      acct("84", "84 Lumber", null, "bianca"),
      acct("pittston", "84 Pittston", "84", "tj"),
      acct("lords-valley", "84 Lords Valley", "84", "tj"),
    ]);

    expect(groups[0].owners).toEqual(["tj"]);
    expect(groups[0].shared).toBe(false);
  });

  it("still groups a branch whose banner is outside the visible set", () => {
    // RLS or a search can hide the parent; the branches must not scatter.
    const groups = groupByCompany([
      acct("miramar", "Dixieline Miramar", "dixieline", "alejandro"),
      acct("la-mesa", "Dixieline La Mesa", "dixieline", "alejandro"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("dixieline");
    expect(groups[0].name).toBe("Other accounts");
    expect(groups[0].branches).toHaveLength(2);
  });

  it("treats a standalone account as its own single-location company", () => {
    const groups = groupByCompany([acct("valencia", "Valencia Lumber", null, "deon")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].branches.map((b) => b.id)).toEqual(["valencia"]);
  });

  it("sorts split relationships first, then by size", () => {
    const groups = groupByCompany([
      acct("solo", "Solo Yard", null, "deon"),
      acct("big", "Big Banner", null, null),
      acct("b1", "Big One", "big", "deon"),
      acct("b2", "Big Two", "big", "deon"),
      acct("b3", "Big Three", "big", "deon"),
      acct("split", "Split Banner", null, null),
      acct("s1", "Split One", "split", "deon"),
      acct("s2", "Split Two", "split", "tj"),
    ]);

    expect(groups.map((g) => g.name)).toEqual([
      "Split Banner", // shared — needs a decision
      "Big Banner", // three locations
      "Solo Yard",
    ]);
  });

  it("applies the display transform to the banner name", () => {
    const groups = groupByCompany(
      [
        acct("ganahl", "GANAHL LUMBER", null, null),
        acct("anaheim", "GANAHL LUMBER — Anaheim", "ganahl", "deon"),
      ],
      (n) => n.toLowerCase(),
    );
    expect(groups[0].name).toBe("ganahl lumber");
  });
});
