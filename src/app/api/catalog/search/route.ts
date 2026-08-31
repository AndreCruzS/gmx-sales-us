// The product picker's only door to the external catalog.
//
// public.sales_catalog_view lives on the connector project and is read with a
// reader_sales JWT that must never reach a browser — so the browser asks US,
// and this route asks the catalog. Read-only by construction: one GET, no
// body, no write path to a system we do not own.
//
// THE GRAIN IS SKU × BRANCH — 20,650 SKUs across 31 branches, ~206k rows — and
// PostgREST has no DISTINCT, so a naive listing shows one product 31 times.
// This is a TYPEAHEAD, not a table: it over-fetches ordered rows, folds them
// to unique SKUs (summing pieces_available per line — the handoff doc is
// explicit that on_hand−committed diverges), and returns a short ranked list.
// A search box narrows; it does not paginate — which is what makes the fold
// safe where paginated dedupe would not be.

import { NextRequest, NextResponse } from "next/server";

interface CatalogRow {
  sku: string;
  description: string;
  species: string | null;
  profile: string | null;
  nominal_size: string | null;
  base_uom: string | null;
  lf_per_piece: number | null;
  lf_uom: string | null;
  branch_id: number;
  pieces_available: number | null;
  lf_available: number | null;
  in_stock: boolean | null;
  stock_refreshed_at: string | null;
}

export interface CatalogItem {
  sku: string;
  description: string;
  species: string | null;
  profile: string | null;
  nominal_size: string | null;
  base_uom: string | null;
  lf_per_piece: number | null;
  /** Summed pieces_available across the branches the fetch saw. */
  piecesAvailable: number;
  lfAvailable: number;
  branches: number;
  thermo: boolean;
}

const SELECT =
  "sku,description,species,profile,nominal_size,base_uom,lf_per_piece,lf_uom," +
  "branch_id,pieces_available,lf_available,in_stock,stock_refreshed_at";

export async function GET(req: NextRequest) {
  const url = process.env.CATALOG_URL;
  const apikey = process.env.CATALOG_APIKEY;
  const jwt = process.env.CATALOG_READER_JWT;
  if (!url || !apikey || !jwt) {
    // The honest state, not an error page: the screen says the catalog is not
    // wired up yet rather than pretending the search found nothing.
    return NextResponse.json({ connected: false, items: [] }, { status: 503 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ connected: true, items: [] });

  // "ipe 1x6" → *ipe*1x6* — the handoff doc's own indexed idiom, stars at
  // both ends. Characters PostgREST treats as pattern syntax are dropped.
  const pattern =
    "*" +
    q
      .split(/\s+/)
      .map((t) => t.replace(/[*,()]/g, ""))
      .filter(Boolean)
      .join("*") +
    "*";

  const params = new URLSearchParams({
    select: SELECT,
    description: `ilike.${pattern}`,
    order: "sku",
    limit: "150",
  });

  const res = await fetch(`${url}/rest/v1/sales_catalog_view?${params}`, {
    headers: { apikey, Authorization: `Bearer ${jwt}` },
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json(
      { connected: false, items: [], upstream: res.status },
      { status: 502 },
    );
  }
  const rows = (await res.json()) as CatalogRow[];

  const bySku = new Map<string, CatalogItem>();
  let refreshedAt: string | null = null;
  for (const r of rows) {
    if (r.stock_refreshed_at && (!refreshedAt || r.stock_refreshed_at > refreshedAt)) {
      refreshedAt = r.stock_refreshed_at;
    }
    const seen = bySku.get(r.sku);
    if (seen) {
      seen.piecesAvailable += Number(r.pieces_available ?? 0);
      seen.lfAvailable += Number(r.lf_available ?? 0);
      seen.branches += 1;
      continue;
    }
    const hay = `${r.species ?? ""} ${r.description}`.toUpperCase();
    bySku.set(r.sku, {
      sku: r.sku,
      description: r.description,
      species: r.species,
      profile: r.profile,
      nominal_size: r.nominal_size,
      base_uom: r.base_uom,
      lf_per_piece: r.lf_per_piece === null ? null : Number(r.lf_per_piece),
      piecesAvailable: Number(r.pieces_available ?? 0),
      lfAvailable: Number(r.lf_available ?? 0),
      branches: 1,
      thermo: hay.includes("THERMO"),
    });
  }

  // Thermo leads — the business quotes it first — then what is actually in
  // stock, then the shorter name, which in practice is the plainer product.
  const items = [...bySku.values()]
    .sort(
      (a, b) =>
        Number(b.thermo) - Number(a.thermo) ||
        Number(b.piecesAvailable > 0) - Number(a.piecesAvailable > 0) ||
        a.description.length - b.description.length ||
        a.description.localeCompare(b.description),
    )
    .slice(0, 25);

  // Stock is rebuilt hourly; older than two hours means the job died and the
  // availability numbers should be read with a raised eyebrow.
  const staleMs = refreshedAt ? Date.now() - Date.parse(refreshedAt) : null;
  return NextResponse.json({
    connected: true,
    items,
    refreshedAt,
    stockStale: staleMs !== null && staleMs > 2 * 60 * 60 * 1000,
  });
}
