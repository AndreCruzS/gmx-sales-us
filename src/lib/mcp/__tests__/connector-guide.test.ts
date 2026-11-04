import { describe, expect, it } from "vitest";
import { connectorAddress, originFromHeaders, shouldShowConnectorCard } from "../connector-guide";

describe("connectorAddress", () => {
  it("prefers the configured origin and trims slashes", () => {
    expect(connectorAddress("https://sales.gmxgroup.com//", "http://x")).toBe(
      "https://sales.gmxgroup.com/api/mcp",
    );
  });
  it("falls back to the request origin when unset or blank", () => {
    expect(connectorAddress(undefined, "https://a.b")).toBe("https://a.b/api/mcp");
    expect(connectorAddress("  ", "https://a.b/")).toBe("https://a.b/api/mcp");
  });
});

describe("originFromHeaders", () => {
  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  it("uses forwarded headers", () => {
    expect(
      originFromHeaders(h({ "x-forwarded-host": "s.gmx.com", "x-forwarded-proto": "https" })),
    ).toBe("https://s.gmx.com");
  });
  it("defaults to http for local hosts, https otherwise", () => {
    expect(originFromHeaders(h({ host: "127.0.0.1:3012" }))).toBe("http://127.0.0.1:3012");
    expect(originFromHeaders(h({ host: "app.example.com" }))).toBe("https://app.example.com");
  });
});

describe("shouldShowConnectorCard", () => {
  it("shows only for allowed, unconnected, undismissed", () => {
    expect(shouldShowConnectorCard({ allowed: true, hasAgentActions: false, dismissed: false })).toBe(true);
    expect(shouldShowConnectorCard({ allowed: false, hasAgentActions: false, dismissed: false })).toBe(false);
    expect(shouldShowConnectorCard({ allowed: true, hasAgentActions: true, dismissed: false })).toBe(false);
    expect(shouldShowConnectorCard({ allowed: true, hasAgentActions: false, dismissed: true })).toBe(false);
  });
});
