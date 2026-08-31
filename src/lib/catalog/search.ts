// The one door to the external product catalog, shared by the typeahead
// route and the voice-quote agent's search tool — one fold, one ranking,
// one set of credentials, so the picker and the model can never disagree
// about what a search returns.
//
// See /api/catalog/search for the story: the view's grain is SKU × branch
// with no DISTINCT, so results are over-fetched ordered and folded by SKU,
// summing pieces_available per line (the handoff doc is explicit that
// on_hand − committed diverges).

export interface CatalogItem {
  sku: string;
  description: string;
  species: string | null;
  profile: string | null;
  nominal_size: string | null;
  base_uom: string | null;
  lf_per_piece: number | null;
  piecesAvailable: number;
  lfAvailable: number;
  branches: number;
  thermo: boolean;
}

interface CatalogRow {
  sku: string;
  description: string;
  species: string | null;
  profile: string | null;
  nominal_size: string | null;
  base_uom: string | null;
  lf_per_piece: number | null;
  branch_id: number;
  pieces_available: number | null;
  lf_available: number | null;
  stock_refreshed_at: string | null;
}

const SELECT =
  "sku,description,species,profile,nominal_size,base_uom,lf_per_piece," +
  "branch_id,pieces_available,lf_available,stock_refreshed_at";

export function catalogConfigured(): boolean {
  return Boolean(
    process.env.CATALOG_URL &&
      process.env.CATALOG_APIKEY &&
      process.env.CATALOG_READER_JWT,
  );
}

export async function searchCatalog(q: string): Promise<{
  items: CatalogItem[];
  refreshedAt: string | null;
}> {
  const url = process.env.CATALOG_URL!;
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
    headers: {
      apikey: process.env.CATALOG_APIKEY!,
      Authorization: `Bearer ${process.env.CATALOG_READER_JWT!}`,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
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

  const items = [...bySku.values()]
    .sort(
      (a, b) =>
        Number(b.thermo) - Number(a.thermo) ||
        Number(b.piecesAvailable > 0) - Number(a.piecesAvailable > 0) ||
        a.description.length - b.description.length ||
        a.description.localeCompare(b.description),
    )
    .slice(0, 25);

  return { items, refreshedAt };
}
