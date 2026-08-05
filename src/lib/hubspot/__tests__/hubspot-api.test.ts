// Locks in the two riskiest behaviors of the REST adapter: retry math stays
// bounded (never a runaway wait, never a silent thundering-herd on 429), and
// batch endpoints chunk/shape requests exactly the way HubSpot expects. The
// stub fetchFn captures every request so shape assertions don't need a real
// HubSpot sandbox.

import { describe, expect, it, vi } from "vitest";
import { backoffDelayMs, HubSpotApi, HubSpotApiError } from "../hubspot-api";

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("backoffDelayMs", () => {
  it("honors Retry-After (seconds) when present", () => {
    expect(backoffDelayMs(0, "2")).toBe(2000);
  });

  it("caps at 30s even when Retry-After asks for longer", () => {
    expect(backoffDelayMs(0, "120")).toBe(30_000);
  });

  it("falls back to exponential backoff capped at 30s with no header", () => {
    expect(backoffDelayMs(0, null)).toBe(1000);
    expect(backoffDelayMs(1, null)).toBe(2000);
    expect(backoffDelayMs(10, null)).toBe(30_000);
  });
});

describe("HubSpotApi retry behavior", () => {
  it("retries once on 429 then resolves on 200 without throwing", async () => {
    const calls: unknown[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return jsonRes(429, { message: "slow down" }, { "retry-after": "0" });
      }
      return jsonRes(200, { results: [{ id: "1", email: "a@b.com" }] });
    });
    const sleepFn = vi.fn(async () => {});
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, sleepFn);

    await expect(api.listOwners()).resolves.toEqual([{ id: "1", email: "a@b.com" }]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it("throws HubSpotApiError with the response body on a non-retryable 400", async () => {
    const fetchFn = vi.fn(async () => jsonRes(400, { message: "bad input" }));
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    await expect(
      api.batchCreate("contacts", [{ props: { email: "x@y.com" } }]),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.stringContaining("bad input"),
    });
    await expect(
      api.batchCreate("contacts", [{ props: { email: "x@y.com" } }]),
    ).rejects.toBeInstanceOf(HubSpotApiError);
  });
});

describe("HubSpotApi.batchCreate chunking", () => {
  it("splits 250 inputs into 3 requests of at most 100", async () => {
    const bodies: { inputs: unknown[] }[] = [];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { inputs: unknown[] };
      bodies.push(body);
      const results = body.inputs.map((input, i) => ({
        id: `${bodies.length}-${i}`,
        properties: (input as { properties: Record<string, string> }).properties,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }));
      return jsonRes(200, { results });
    });
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    const inputs = Array.from({ length: 250 }, (_, i) => ({
      props: { email: `user${i}@example.com` },
    }));
    const records = await api.batchCreate("contacts", inputs);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(bodies.map((b) => b.inputs.length)).toEqual([100, 100, 50]);
    expect(records).toHaveLength(250);
    for (const call of fetchFn.mock.calls) {
      expect(call[0]).toBe("https://api.hubapi.com/crm/v3/objects/contacts/batch/create");
    }
  });
});

describe("HubSpotApi.searchModifiedSince", () => {
  it("sends the exact body shape: filterGroups, sorts, properties, limit, after", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonRes(200, {
        results: [{ id: "42", properties: { hs_lastmodifieddate: "999" } }],
        paging: { next: { after: "cursor-1" } },
      });
    });
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    const extraFilters = [
      { propertyName: "lifecyclestage", operator: "EQ" as const, value: "customer" },
    ];
    const result = await api.searchModifiedSince(
      "deals",
      "1700000000000",
      extraFilters,
      ["dealname", "amount"],
      "cursor-0",
    );

    expect(capturedUrl).toBe("https://api.hubapi.com/crm/v3/objects/deals/search");
    const body = JSON.parse(String(capturedInit?.body));
    expect(body).toEqual({
      filterGroups: [
        {
          filters: [
            { propertyName: "hs_lastmodifieddate", operator: "GT", value: "1700000000000" },
            { propertyName: "lifecyclestage", operator: "EQ", value: "customer" },
          ],
        },
      ],
      sorts: ["hs_lastmodifieddate"],
      properties: ["dealname", "amount"],
      limit: 100,
      after: "cursor-0",
    });
    expect(result.after).toBe("cursor-1");
    expect(result.results).toEqual([
      { id: "42", props: { hs_lastmodifieddate: "999" }, lastModifiedAt: "999" },
    ]);
  });

  it("omits after from the body when not provided", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return jsonRes(200, { results: [] });
    });
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    const result = await api.searchModifiedSince("contacts", "0", [], ["email"]);

    const body = JSON.parse(String(capturedInit?.body));
    expect(body.after).toBeUndefined();
    expect(result.after).toBeNull();
  });
});

describe("HsRecord.lastModifiedAt normalization", () => {
  it("passes a numeric ms-epoch hs_lastmodifieddate through unchanged", async () => {
    const fetchFn = vi.fn(async () =>
      jsonRes(200, { results: [{ id: "1", properties: { hs_lastmodifieddate: "1754384400000" } }] }),
    );
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    const result = await api.searchModifiedSince("deals", "0", [], ["dealname"]);

    expect(result.results[0].lastModifiedAt).toBe("1754384400000");
  });

  it("converts an ISO-8601 hs_lastmodifieddate to a ms-epoch string (F8)", async () => {
    const fetchFn = vi.fn(async () =>
      jsonRes(200, {
        results: [{ id: "1", properties: { hs_lastmodifieddate: "2025-08-05T09:00:00.000Z" } }],
      }),
    );
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    const result = await api.searchModifiedSince("deals", "0", [], ["dealname"]);

    expect(result.results[0].lastModifiedAt).toBe("1754384400000");
    expect(Number.isNaN(Number(result.results[0].lastModifiedAt))).toBe(false);
  });

  it("falls back to an ISO-8601 updatedAt, also normalized to ms-epoch", async () => {
    const fetchFn = vi.fn(async () =>
      jsonRes(200, {
        results: [{ id: "1", properties: {}, updatedAt: "2025-08-05T09:00:00.000Z" }],
      }),
    );
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    const result = await api.searchModifiedSince("deals", "0", [], ["dealname"]);

    expect(result.results[0].lastModifiedAt).toBe("1754384400000");
  });
});

describe("HubSpotApi request headers", () => {
  it("sends bearer auth and json content-type", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return jsonRes(200, { results: [] });
    });
    const api = new HubSpotApi("secret-token", fetchFn as unknown as typeof fetch, async () => {});

    await api.listOwners();

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret-token");
    expect(headers["content-type"]).toBe("application/json");
  });
});

describe("HubSpotApi.associateDefault", () => {
  it("PUTs the v4 default association endpoint with no body", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonRes(200, {});
    });
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    await api.associateDefault("deals", "1", "contacts", "2");

    expect(capturedUrl).toBe(
      "https://api.hubapi.com/crm/v4/objects/deals/1/associations/default/contacts/2",
    );
    expect(capturedInit?.method).toBe("PUT");
    expect(capturedInit?.body).toBeUndefined();
  });
});

describe("HubSpotApi.ensureProperty", () => {
  it("does nothing when the property already exists", async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, { name: "maximo_managed" }));
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    await api.ensureProperty("contacts", {
      name: "maximo_managed",
      label: "Managed",
      type: "bool",
      fieldType: "booleancheckbox",
      groupName: "contactinformation",
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("creates the property when GET 404s", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) return jsonRes(404, { message: "not found" });
      return jsonRes(201, { name: "maximo_managed" });
    });
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    const def = {
      name: "maximo_managed",
      label: "Managed",
      type: "bool" as const,
      fieldType: "booleancheckbox" as const,
      groupName: "contactinformation",
    };
    await api.ensureProperty("contacts", def);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/properties/contacts/maximo_managed");
    expect(calls[1].url).toBe("https://api.hubapi.com/crm/v3/properties/contacts");
    expect(calls[1].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual(def);
  });
});

describe("HubSpotApi.ensureDealPipeline", () => {
  it("returns the existing pipeline's id and stage map when the label matches", async () => {
    const fetchFn = vi.fn(async () =>
      jsonRes(200, {
        results: [
          {
            id: "pipe-1",
            label: "MAXIMO Sales",
            stages: [
              { id: "s1", label: "New" },
              { id: "s2", label: "Won" },
            ],
          },
        ],
      }),
    );
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    const result = await api.ensureDealPipeline("MAXIMO Sales", ["New", "Won"]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      pipelineId: "pipe-1",
      stageIds: { New: "s1", Won: "s2" },
    });
  });

  it("creates the pipeline when no matching label exists", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) return jsonRes(200, { results: [] });
      return jsonRes(201, {
        id: "pipe-2",
        stages: [
          { id: "s1", label: "New" },
          { id: "s2", label: "Won" },
          { id: "s3", label: "Lost" },
        ],
      });
    });
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    const result = await api.ensureDealPipeline("MAXIMO Sales", ["New", "Won", "Lost"]);

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("https://api.hubapi.com/crm/v3/pipelines/deals");
    expect(calls[1].init?.method).toBe("POST");
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body).toEqual({
      label: "MAXIMO Sales",
      displayOrder: 10,
      stages: [
        { label: "New", displayOrder: 0, metadata: { probability: "0.5" } },
        { label: "Won", displayOrder: 1, metadata: { probability: "1.0" } },
        { label: "Lost", displayOrder: 2, metadata: { probability: "0.0" } },
      ],
    });
    expect(result).toEqual({
      pipelineId: "pipe-2",
      stageIds: { New: "s1", Won: "s2", Lost: "s3" },
    });
  });
});

describe("HubSpotApi.listOwners paging", () => {
  it("follows paging.next.after until exhausted", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (!url.includes("after=")) {
        return jsonRes(200, {
          results: [{ id: "1", email: "a@b.com" }],
          paging: { next: { after: "cur-2" } },
        });
      }
      return jsonRes(200, { results: [{ id: "2", email: "c@d.com" }] });
    });
    const api = new HubSpotApi("token", fetchFn as unknown as typeof fetch, async () => {});

    const owners = await api.listOwners();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(owners).toEqual([
      { id: "1", email: "a@b.com" },
      { id: "2", email: "c@d.com" },
    ]);
  });
});
