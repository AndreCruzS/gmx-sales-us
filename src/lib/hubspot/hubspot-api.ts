// HubSpotPort over the raw CRM v3/v4 REST API (spec Task 10): every call
// funnels through `request()` so batching, auth, and 429/5xx backoff live in
// one place. No HubSpot SDK — a handful of endpoints don't justify the
// dependency (see src/lib/email/google-gmail.ts for the same call).

import type {
  HsFilter,
  HsObjectType,
  HsProps,
  HsPropertyDef,
  HsRecord,
  HubSpotPort,
} from "./port";

const API = "https://api.hubapi.com";
const BATCH_SIZE = 100; // HubSpot's batch/create and batch/update cap
const MAX_ATTEMPTS = 5; // includes the first try — 4 retries on 429/5xx
const MAX_BACKOFF_MS = 30_000;

export class HubSpotApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`HubSpot API ${status}: ${body}`);
    this.name = "HubSpotApiError";
  }
}

/** Pure so the retry loop is testable without waiting on real timers. */
export function backoffDelayMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader !== null) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs) && secs >= 0) {
      return Math.min(secs * 1000, MAX_BACKOFF_MS);
    }
  }
  return Math.min(2 ** attempt * 1000, MAX_BACKOFF_MS);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface HsApiRecord {
  id: string;
  properties: Record<string, string | null>;
  updatedAt?: string;
}

// hs_lastmodifieddate is documented as a ms-epoch string, but HubSpot has
// been observed returning ISO-8601 instead in some responses (and the
// `updatedAt` fallback is ISO-8601 outright). Number("2026-08-05T...") is
// NaN, which would silently corrupt cursor max-tracking (run-sync.ts),
// LWW timestamp comparisons (sync-core.ts's toMs), and mapping.ts's
// msToDateString — normalize defensively so every HsRecord.lastModifiedAt
// downstream code sees is always a ms-epoch string.
function normalizeLastModified(raw: string): string {
  if (/^\d+$/.test(raw)) return raw;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? raw : String(parsed);
}

function toHsRecord(r: HsApiRecord): HsRecord {
  return {
    id: r.id,
    props: r.properties,
    lastModifiedAt: normalizeLastModified(r.properties.hs_lastmodifieddate ?? r.updatedAt ?? ""),
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class HubSpotApi implements HubSpotPort {
  constructor(
    private token: string,
    private fetchFn: typeof fetch = fetch,
    private sleepFn: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  // Retries 429/5xx up to MAX_ATTEMPTS total tries; anything else non-2xx
  // throws immediately since retrying won't fix a 4xx shape/auth problem.
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const res = await this.fetchFn(`${API}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          ...init.headers,
        },
      });
      if (res.status === 429 || res.status >= 500) {
        const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
        if (isLastAttempt) throw new HubSpotApiError(res.status, await res.text());
        await this.sleepFn(backoffDelayMs(attempt, res.headers.get("retry-after")));
        continue;
      }
      if (!res.ok) throw new HubSpotApiError(res.status, await res.text());
      return res;
    }
    // MAX_ATTEMPTS >= 1 guarantees the loop above always returns or throws.
    throw new HubSpotApiError(0, "unreachable: retry loop exited without a response");
  }

  // I-1: HubSpot's batch endpoints can return 207 Multi-Status (body.status
  // "COMPLETE_WITH_ERRORS") when some inputs in a batch succeeded and others
  // didn't — `results` then omits the failed entries, which shortens or
  // reorders the array relative to the request. batchCreate/batchUpdate's
  // callers pair `results[i]` with their own input list by INDEX (run-sync.ts
  // syncOutboundEntities), so a partial batch would silently link the wrong
  // hubspot_id to the wrong local row. `request()` alone won't catch this —
  // 207 is inside the 200-299 "ok" range — so batch calls check explicitly
  // and throw, turning a silent cross-link into a caught batch-level failure
  // (the stream's try/catch records it and F1's cursor floor keeps every row
  // in the batch safe to retry next pass). Simplest correct v1; a caller
  // that needs partial-success handling can fall back to per-record calls
  // (see run-sync.ts's contacts adopt-on-failure path, I-2).
  private async requestBatch(path: string, body: unknown): Promise<HsRecord[]> {
    const res = await this.request(path, { method: "POST", body: JSON.stringify(body) });
    const text = await res.text();
    const parsed = JSON.parse(text) as { results: HsApiRecord[]; status?: string };
    if (res.status === 207 || parsed.status === "COMPLETE_WITH_ERRORS") {
      throw new HubSpotApiError(res.status, text);
    }
    return parsed.results.map(toHsRecord);
  }

  async batchCreate(type: HsObjectType, inputs: { props: HsProps }[]): Promise<HsRecord[]> {
    const out: HsRecord[] = [];
    for (const batch of chunk(inputs, BATCH_SIZE)) {
      out.push(
        ...(await this.requestBatch(`/crm/v3/objects/${type}/batch/create`, {
          inputs: batch.map((i) => ({ properties: i.props })),
        })),
      );
    }
    return out;
  }

  async batchUpdate(
    type: HsObjectType,
    inputs: { id: string; props: HsProps }[],
  ): Promise<HsRecord[]> {
    const out: HsRecord[] = [];
    for (const batch of chunk(inputs, BATCH_SIZE)) {
      out.push(
        ...(await this.requestBatch(`/crm/v3/objects/${type}/batch/update`, {
          inputs: batch.map((i) => ({ id: i.id, properties: i.props })),
        })),
      );
    }
    return out;
  }

  async searchModifiedSince(
    type: HsObjectType,
    sinceMs: string,
    extraFilters: HsFilter[],
    properties: string[],
    after?: string,
  ): Promise<{ results: HsRecord[]; after: string | null }> {
    const res = await this.request(`/crm/v3/objects/${type}/search`, {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: "hs_lastmodifieddate", operator: "GT", value: sinceMs },
              ...extraFilters,
            ],
          },
        ],
        sorts: ["hs_lastmodifieddate"],
        properties,
        limit: 100,
        ...(after !== undefined ? { after } : {}),
      }),
    });
    const body = (await res.json()) as {
      results: HsApiRecord[];
      paging?: { next?: { after?: string } };
    };
    return {
      results: body.results.map(toHsRecord),
      after: body.paging?.next?.after ?? null,
    };
  }

  async searchByProperty(
    type: HsObjectType,
    propertyName: string,
    value: string,
    properties: string[],
  ): Promise<HsRecord[]> {
    const res = await this.request(`/crm/v3/objects/${type}/search`, {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName, operator: "EQ", value }] }],
        properties,
        limit: 10,
      }),
    });
    const body = (await res.json()) as { results: HsApiRecord[] };
    return body.results.map(toHsRecord);
  }

  async associateDefault(
    fromType: HsObjectType,
    fromId: string,
    toType: HsObjectType,
    toId: string,
  ): Promise<void> {
    await this.request(
      `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`,
      { method: "PUT" },
    );
  }

  async listOwners(): Promise<{ id: string; email: string }[]> {
    const out: { id: string; email: string }[] = [];
    let after: string | undefined;
    do {
      const path = after
        ? `/crm/v3/owners?limit=100&after=${after}`
        : `/crm/v3/owners?limit=100`;
      const res = await this.request(path);
      const body = (await res.json()) as {
        results: { id: string; email: string }[];
        paging?: { next?: { after?: string } };
      };
      out.push(...body.results);
      after = body.paging?.next?.after;
    } while (after);
    return out;
  }

  async ensureProperty(
    objectType: "companies" | "contacts" | "deals",
    def: HsPropertyDef,
  ): Promise<void> {
    try {
      await this.request(`/crm/v3/properties/${objectType}/${def.name}`);
      return;
    } catch (err) {
      if (!(err instanceof HubSpotApiError) || err.status !== 404) throw err;
    }
    await this.request(`/crm/v3/properties/${objectType}`, {
      method: "POST",
      body: JSON.stringify(def),
    });
  }

  async ensureDealPipeline(
    label: string,
    stageLabels: string[],
  ): Promise<{ pipelineId: string; stageIds: Record<string, string> }> {
    const listRes = await this.request(`/crm/v3/pipelines/deals`);
    const listBody = (await listRes.json()) as {
      results: { id: string; label: string; stages: { id: string; label: string }[] }[];
    };
    const existing = listBody.results.find((p) => p.label === label);
    if (existing) {
      return { pipelineId: existing.id, stageIds: stageMap(existing.stages) };
    }

    const createRes = await this.request(`/crm/v3/pipelines/deals`, {
      method: "POST",
      body: JSON.stringify({
        label,
        displayOrder: 10,
        stages: stageLabels.map((l, i) => ({
          label: l,
          displayOrder: i,
          metadata: { probability: l === "Won" ? "1.0" : l === "Lost" ? "0.0" : "0.5" },
        })),
      }),
    });
    const created = (await createRes.json()) as {
      id: string;
      stages: { id: string; label: string }[];
    };
    return { pipelineId: created.id, stageIds: stageMap(created.stages) };
  }
}

function stageMap(stages: { id: string; label: string }[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of stages) map[s.label] = s.id;
  return map;
}
