import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser } }),
}));

import { GET } from "../route";

describe("GET /api/agent-access", () => {
  beforeEach(() => {
    process.env.MCP_ALLOWED_EMAILS = "tj@gmxgroup.com, Bianca@gmxgroup.com";
    getUser.mockReset();
  });

  it("401 and false when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ allowed: false });
  });

  it("true for a listed email, false otherwise, never leaks the list", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "bianca@gmxgroup.com" } } });
    expect(await (await GET()).json()).toEqual({ allowed: true });
    getUser.mockResolvedValue({ data: { user: { email: "deon@gmxgroup.com" } } });
    const body = await (await GET()).json();
    expect(body).toEqual({ allowed: false });
    expect(JSON.stringify(body)).not.toContain("tj@");
  });
});
