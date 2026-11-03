import { describe, expect, it } from "vitest";
import { sayHref } from "@/lib/voice/say-href";

describe("old Log a visit links", () => {
  it("land on Say it with their context", () => {
    expect(sayHref(new URLSearchParams("visit=v1"))).toBe("/say?visit=v1");
    expect(sayHref(new URLSearchParams("account=a1&item=i1"))).toBe("/say?visit=i1&account=a1");
    expect(sayHref(new URLSearchParams(""))).toBe("/say");
  });
});
