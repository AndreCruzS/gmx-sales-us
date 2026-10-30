import { describe, expect, it } from "vitest";
import { seesDealersBoard } from "../roles";

describe("seesDealersBoard", () => {
  it("is offered to the desk and to assistants", () => {
    expect(seesDealersBoard("admin")).toBe(true);
    expect(seesDealersBoard("manager")).toBe(true);
    expect(seesDealersBoard("support")).toBe(true);
  });
  it("is not offered to reps or to an unknown role", () => {
    expect(seesDealersBoard("rep")).toBe(false);
    expect(seesDealersBoard(null)).toBe(false);
    expect(seesDealersBoard(undefined)).toBe(false);
  });
});
