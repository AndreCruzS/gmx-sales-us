import { describe, expect, it } from "vitest";
import { sectionItems } from "@/lib/domain/visit-sections";

const base = {
  activityId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  ownerId: "33333333-3333-4333-8333-333333333333",
  accountId: "44444444-4444-4444-8444-444444444444",
  today: "2026-10-30",
  actions: "",
  coordinate: "",
  followUps: "",
};

describe("sectionItems", () => {
  it("one item per non-empty line, typed by section", () => {
    const items = sectionItems({
      ...base,
      actions: "Send the price list\n\n  Drop samples  \n",
      coordinate: "Truck with Boise",
      followUps: "Call Mike Friday",
    });
    expect(items.map((i) => [i.item_type, i.action])).toEqual([
      ["ACTION", "Send the price list"],
      ["ACTION", "Drop samples"],
      ["COORDINATE", "Truck with Boise"],
      ["FOLLOW_UP", "Call Mike Friday"],
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(4);
  });

  it("due in 7 days and linked to the visit", () => {
    const [a] = sectionItems({ ...base, actions: "x" });
    expect(a.due_date).toBe("2026-11-06");
    expect(a.activity_id).toBe(base.activityId);
    expect(a.source).toBe("VISIT_CAPTURE");
    expect(a.account_id).toBe(base.accountId);
    expect(a.owner_id).toBe(base.ownerId);
    expect(a.org_id).toBe(base.orgId);
    expect(sectionItems({ ...base, today: "2026-12-28", actions: "x" })[0].due_date).toBe("2027-01-04");
  });

  it("blank sections make nothing", () => {
    expect(sectionItems({ ...base, actions: "  \n \n", coordinate: "", followUps: "\n" })).toEqual([]);
  });
});
