import { describe, expect, it } from "vitest";
import { describeRpc } from "../request-log";

describe("describeRpc", () => {
  it("names the method and, for a tool call, the tool — never the arguments", () => {
    const d = describeRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "find", arguments: { q: "Russin" } } });
    expect(d).toBe("tools/call find");
    expect(d).not.toContain("Russin");
  });
  it("joins a batch and tolerates junk", () => {
    expect(describeRpc([{ method: "initialize" }, { method: "notifications/initialized" }])).toBe(
      "initialize + notifications/initialized",
    );
    expect(describeRpc({ id: 3, result: {} })).toBe("response");
    expect(describeRpc(null)).toBe("empty");
    expect(describeRpc([])).toBe("empty");
  });
});
