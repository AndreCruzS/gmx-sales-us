import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { load, resetAgentAccessForTests } from "../use-agent-access";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  resetAgentAccessForTests();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("agent access answer", () => {
  it("a signed-out 401 is not remembered: after signing in the next ask says yes", async () => {
    vi.stubGlobal("fetch", reply(401, { allowed: false }));
    expect(await load("bianca@gmxgroup.us")).toBe(false);
    expect(store.size).toBe(0);
    vi.stubGlobal("fetch", reply(200, { allowed: true }));
    expect(await load("bianca@gmxgroup.us")).toBe(true);
  });

  it("a network failure is not remembered", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await load("bianca@gmxgroup.us")).toBe(false);
    expect(store.size).toBe(0);
  });

  it("a signed-in answer is remembered for that email only", async () => {
    const f = reply(200, { allowed: true });
    vi.stubGlobal("fetch", f);
    expect(await load("bianca@gmxgroup.us")).toBe(true);
    expect(await load("bianca@gmxgroup.us")).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", reply(200, { allowed: false }));
    expect(await load("tj@gmxgroup.com")).toBe(false);
  });
});
