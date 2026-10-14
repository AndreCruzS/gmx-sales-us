import { describe, expect, it } from "vitest";
import {
  contactGroup,
  contactKind,
  contactRegion,
  contextSentence,
  countBy,
  narrowContacts,
  nextStage,
  sortContacts,
  withGroupHeads,
  type ContactListRow,
  type ContactStep,
} from "@/lib/domain/contact-list";

const REG = { socal: "t-socal", texas: "t-texas", se: "t-se" };

function row(over: Partial<ContactListRow> & { id: string; name: string }): ContactListRow {
  return {
    job_title: null,
    email: null,
    phone: null,
    is_champion: false,
    account_id: "acc-boise",
    accountName: "Boise Cascade",
    accountType: "DISTRIBUTOR",
    accountTerritoryId: REG.socal,
    branchName: null,
    branchTerritoryId: null,
    ...over,
  };
}

// The directory as it stands on 2026-10-14: Boise's people sit in branches,
// Rugby's and Capital's do not, dealers' people sit at the dealer.
const ROWS: ContactListRow[] = [
  row({ id: "c1", name: "Zed Riverside", branchName: "Riverside Branch", branchTerritoryId: REG.socal }),
  row({ id: "c2", name: "Amy Riverside", branchName: "Riverside Branch", branchTerritoryId: REG.socal, is_champion: true }),
  row({ id: "c3", name: "Bob Dallas", branchName: "Dallas Branch", branchTerritoryId: REG.texas }),
  row({ id: "c4", name: "Cy Nowhere", branchName: "Nashville Branch", branchTerritoryId: null }),
  row({ id: "c5", name: "Dee Rugby", account_id: "acc-rugby", accountName: "Rugby Architectural Building Products", accountTerritoryId: REG.se, email: "dee@rugby.com" }),
  row({ id: "c6", name: "Eve Ganahl", account_id: "acc-ganahl", accountName: "GANAHL LUMBER ANAHEIM", accountType: "DEALER", accountTerritoryId: REG.socal, job_title: "Buyer" }),
  row({ id: "c7", name: "Fay Lonely", account_id: "acc-x", accountName: null, accountType: null, accountTerritoryId: null }),
];

const byId = (rows: readonly ContactListRow[]) => rows.map((r) => r.id);

describe("where a contact sits (Andre, 2026-10-14: the contacts page gets the sales page's filters)", () => {
  it("a branch's person takes the branch's region; everyone else takes the account's", () => {
    expect(contactRegion(ROWS[2])).toBe(REG.texas);
    expect(contactRegion(ROWS[4])).toBe(REG.se);
    expect(contactRegion(ROWS[5])).toBe(REG.socal);
  });

  it("a branch nobody has placed yet does not fall back to the house's region", () => {
    // Boise is filed under SoCal; its Nashville branch is not SoCal.
    expect(contactRegion(ROWS[3])).toBeNull();
    expect(contactRegion(ROWS[6])).toBeNull();
  });

  it("the kind is the account's type", () => {
    expect(contactKind(ROWS[0])).toBe("distributor");
    expect(contactKind(ROWS[5])).toBe("dealer");
    expect(contactKind(ROWS[6])).toBe("other");
  });
});

const DIST: ContactStep = { dim: "kind", key: "distributor", name: "Distributors" };
const DEAL: ContactStep = { dim: "kind", key: "dealer", name: "Dealers" };
const BOISE: ContactStep = { dim: "house", key: "acc-boise", name: "Boise Cascade" };
const RIV: ContactStep = { dim: "branch", key: "Riverside Branch", name: "Riverside Branch" };

describe("narrowing the directory", () => {
  const all = { path: [] as ContactStep[], regionId: "", query: "" };

  it("no narrowing hands back the same array", () => {
    expect(narrowContacts(ROWS, all)).toBe(ROWS);
  });

  it("by kind", () => {
    expect(byId(narrowContacts(ROWS, { ...all, path: [DIST] }))).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(byId(narrowContacts(ROWS, { ...all, path: [DEAL] }))).toEqual(["c6"]);
  });

  it("down the walk: house, then branch", () => {
    expect(byId(narrowContacts(ROWS, { ...all, path: [DIST, BOISE] }))).toEqual(["c1", "c2", "c3", "c4"]);
    expect(byId(narrowContacts(ROWS, { ...all, path: [DIST, BOISE, RIV] }))).toEqual(["c1", "c2"]);
    expect(byId(narrowContacts(ROWS, { ...all, path: [DEAL, { dim: "dealer", key: "acc-ganahl", name: "Ganahl" }] }))).toEqual(["c6"]);
  });

  it("by region, which keeps both the branch people and the dealer people of that region", () => {
    expect(byId(narrowContacts(ROWS, { ...all, regionId: REG.socal }))).toEqual(["c1", "c2", "c6"]);
    expect(byId(narrowContacts(ROWS, { ...all, regionId: REG.texas }))).toEqual(["c3"]);
  });

  it("an unplaced person shows only under all regions", () => {
    expect(byId(narrowContacts(ROWS, { ...all, regionId: REG.se }))).toEqual(["c5"]);
    expect(byId(narrowContacts(ROWS, all))).toContain("c4");
  });

  it("by house", () => {
    expect(byId(narrowContacts(ROWS, { ...all, path: [DIST, { dim: "house", key: "acc-rugby", name: "Rugby" }] }))).toEqual(["c5"]);
  });

  it("the search reads the name, the company, the branch, the e-mail and the title", () => {
    expect(byId(narrowContacts(ROWS, { ...all, query: "dallas" }))).toEqual(["c3"]);
    expect(byId(narrowContacts(ROWS, { ...all, query: "rugby.com" }))).toEqual(["c5"]);
    expect(byId(narrowContacts(ROWS, { ...all, query: "buyer" }))).toEqual(["c6"]);
    expect(byId(narrowContacts(ROWS, { ...all, query: "  GANAHL " }))).toEqual(["c6"]);
  });

  it("the narrowings stack", () => {
    expect(byId(narrowContacts(ROWS, { ...all, path: [DIST], regionId: REG.socal, query: "amy" }))).toEqual(["c2"]);
  });
});

describe("the next stage of the walk (Andre, 2026-10-14: a breadcrumb, the first stage collapsed)", () => {
  it("at the top, the kinds with their counts", () => {
    expect(nextStage(ROWS, [])).toEqual({
      dim: "kind",
      options: [
        { key: "distributor", name: "Distributors", count: 5 },
        { key: "dealer", name: "Dealers", count: 1 },
      ],
    });
  });

  it("under Distributors, the houses that have people, most people first", () => {
    expect(nextStage(ROWS, [DIST])).toEqual({
      dim: "house",
      options: [
        { key: "acc-boise", name: "Boise Cascade", count: 4 },
        { key: "acc-rugby", name: "Rugby Architectural Building Products", count: 1 },
      ],
    });
  });

  it("under a house, its branches by name; people with no branch are not a chip", () => {
    expect(nextStage(ROWS, [DIST, BOISE])).toEqual({
      dim: "branch",
      options: [
        { key: "Dallas Branch", name: "Dallas Branch", count: 1 },
        { key: "Nashville Branch", name: "Nashville Branch", count: 1 },
        { key: "Riverside Branch", name: "Riverside Branch", count: 2 },
      ],
    });
  });

  it("a house with no branches has no further stage, and neither has a branch", () => {
    expect(nextStage(ROWS, [DIST, { dim: "house", key: "acc-rugby", name: "Rugby" }])).toBeNull();
    expect(nextStage(ROWS, [DIST, BOISE, RIV])).toBeNull();
  });

  it("under Dealers, the dealers with people, in display names", () => {
    expect(nextStage(ROWS, [DEAL])).toEqual({
      dim: "dealer",
      options: [{ key: "acc-ganahl", name: "Ganahl Lumber Anaheim", count: 1 }],
    });
    expect(nextStage(ROWS, [DEAL, { dim: "dealer", key: "acc-ganahl", name: "Ganahl" }])).toBeNull();
  });

  it("the sentence names where you are and how many", () => {
    expect(contextSentence([], 65)).toEqual(["Everyone", "65 people"]);
    expect(contextSentence([DIST], 57)).toEqual(["Distributors", "57 people"]);
    expect(contextSentence([DIST, BOISE, RIV], 1)).toEqual(["Riverside Branch", "Boise Cascade", "1 person"]);
    expect(contextSentence([DEAL, { dim: "dealer", key: "x", name: "Big Creek Lumber" }], 0)).toEqual(["Big Creek Lumber", "nobody"]);
  });
});

describe("the order the directory reads in", () => {
  it("company, then branch, then the champion, then the name", () => {
    expect(byId(sortContacts(ROWS))).toEqual([
      // Boise: Dallas, Nashville, Riverside (champion first inside Riverside)
      "c3", "c4", "c2", "c1",
      // Ganahl (display name sorts as "Ganahl Lumber Anaheim")
      "c6",
      // Rugby
      "c5",
      // nobody's company last
      "c7",
    ]);
  });

  it("does not touch the input", () => {
    const copy = [...ROWS];
    sortContacts(ROWS);
    expect(ROWS).toEqual(copy);
  });
});

describe("group heads", () => {
  it("name the company, and the branch when there is one", () => {
    expect(contactGroup(ROWS[0])).toBe("Boise Cascade · Riverside Branch");
    expect(contactGroup(ROWS[4])).toBe("Rugby Architectural Building Products");
    expect(contactGroup(ROWS[5])).toBe("Ganahl Lumber Anaheim");
    expect(contactGroup(ROWS[6])).toBe("No company");
  });

  it("a head is printed where the group changes, including at the top of a page", () => {
    const page = sortContacts(ROWS).slice(1, 5); // c4 c2 c1 c6
    expect(withGroupHeads(page, contactGroup).map((x) => [x.row.id, x.head])).toEqual([
      ["c4", "Boise Cascade · Nashville Branch"],
      ["c2", "Boise Cascade · Riverside Branch"],
      ["c1", null],
      ["c6", "Ganahl Lumber Anaheim"],
    ]);
  });

  it("an empty page has no heads", () => {
    expect(withGroupHeads([], contactGroup)).toEqual([]);
  });
});

describe("counts for the chips", () => {
  it("count by any key and skip the ones without one", () => {
    const n = countBy(ROWS, contactRegion);
    expect(n.get(REG.socal)).toBe(3);
    expect(n.get(REG.texas)).toBe(1);
    expect(n.get(REG.se)).toBe(1);
    expect(n.has("")).toBe(false);
    expect([...n.values()].reduce((a, b) => a + b, 0)).toBe(5);
  });
});
