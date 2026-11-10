import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const memberships = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    auth: { getUser },
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        limit: () => memberships(),
      };
      return q;
    },
  }),
}));

import { GET } from "../route";

describe("GET /api/agent-access", () => {
  beforeEach(() => {
    getUser.mockReset();
    memberships.mockReset();
  });

  it("401 and false when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ allowed: false });
  });

  it("true for anyone with an active membership, whatever the role", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "deonn.deford@gmxgroup.com" } } });
    memberships.mockResolvedValue({ data: [{ id: "m1" }], error: null });
    expect(await (await GET()).json()).toEqual({ allowed: true });
  });

  it("false without an active membership (a Google login nobody added)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u2", email: "someone@gmail.com" } } });
    memberships.mockResolvedValue({ data: [], error: null });
    expect(await (await GET()).json()).toEqual({ allowed: false });
  });

  it("false when the lookup fails", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u3", email: "x@gmxgroup.com" } } });
    memberships.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await (await GET()).json()).toEqual({ allowed: false });
  });
});
