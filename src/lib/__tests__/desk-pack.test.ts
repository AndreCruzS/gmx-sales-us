import { describe, expect, it } from "vitest";
import { packDesk, spanner } from "../desk-pack";

// The packing is a RULE two boards now obey, so it gets pinned here rather
// than re-read off the page it was first written on.
describe("packDesk", () => {
  it("gives a lone block the whole line, whatever it asked for", () => {
    expect(packDesk([{ k: "a", w: "narrow" }]).get("a")).toBe("full");
    expect(packDesk([{ k: "a", w: "wide" }]).get("a")).toBe("full");
  });

  it("pairs a wide with a narrow and keeps both widths", () => {
    const out = packDesk([
      { k: "recurrence", w: "wide" },
      { k: "goalmonths", w: "narrow" },
    ]);
    expect(out.get("recurrence")).toBe("wide");
    expect(out.get("goalmonths")).toBe("narrow");
  });

  it("splits two narrows evenly — neither is the other's appendix", () => {
    const out = packDesk([
      { k: "months", w: "narrow" },
      { k: "slipping", w: "narrow" },
    ]);
    expect(out.get("months")).toBe("half");
    expect(out.get("slipping")).toBe("half");
  });

  it("never pairs two wides: squeezed to six each, both read worse", () => {
    const out = packDesk([
      { k: "a", w: "wide" },
      { k: "b", w: "wide" },
    ]);
    expect(out.get("a")).toBe("full");
    expect(out.get("b")).toBe("full");
  });

  it("lets a full block break a line that would otherwise have paired", () => {
    const out = packDesk([
      { k: "sales", w: "full" },
      { k: "recurrence", w: "wide" },
      { k: "goalmonths", w: "narrow" },
    ]);
    expect(out.get("sales")).toBe("full");
    expect(out.get("recurrence")).toBe("wide");
    expect(out.get("goalmonths")).toBe("narrow");
  });

  it("closes the hole Year to date used to leave", () => {
    // No recurrence (one month on file cannot be compared), so the goal chart
    // is alone on its line — and takes the width instead of sitting in a
    // right-hand column with 826px of empty page beside it.
    const out = packDesk([
      { k: "sales", w: "full" },
      { k: "goalmonths", w: "narrow" },
    ]);
    expect(out.get("goalmonths")).toBe("full");
  });

  it("the orphan of an odd run grows, and only the orphan", () => {
    const out = packDesk([
      { k: "a", w: "narrow" },
      { k: "b", w: "narrow" },
      { k: "c", w: "narrow" },
    ]);
    expect(out.get("a")).toBe("half");
    expect(out.get("b")).toBe("half");
    expect(out.get("c")).toBe("full");
  });

  it("reads anything unplaced as owning its line", () => {
    const span = spanner(packDesk([{ k: "a", w: "wide" }]));
    expect(span("a")).toBe("full");
    expect(span("never-rendered")).toBe("full");
  });
});
