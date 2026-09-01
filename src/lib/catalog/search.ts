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
  /** Random Length: quotable with no stock figures — ordered in LF, always.
   *  Their quantity columns are NULL at the source, by design. */
  randomLength: boolean;
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
  is_random_length: boolean | null;
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
  "branch_id,pieces_available,lf_available,stock_refreshed_at,is_random_length";

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
    // The quotable universe, per the handoff: stocked lengths OR random
    // length. in_stock=eq.true alone silently drops RL — NULL never
    // matches eq — which is exactly the trap the connector doc warns about.
    or: "(in_stock.eq.true,is_random_length.eq.true)",
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
      randomLength: r.is_random_length === true,
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

  // RL leads (Andre, 2026-09-01): the random-length sku is the product's own
  // front door — the specific lengths queue up under it, shortest name first,
  // which in this catalog reads 10', 11', 12'...
  const items = [...bySku.values()]
    .sort(
      (a, b) =>
        Number(b.randomLength) - Number(a.randomLength) ||
        Number(b.thermo) - Number(a.thermo) ||
        Number(b.piecesAvailable > 0) - Number(a.piecesAvailable > 0) ||
        a.description.length - b.description.length ||
        a.description.localeCompare(b.description),
    )
    .slice(0, 25);

  return { items, refreshedAt };
}

// ── The catalog's own vocabulary ─────────────────────────────────────────────
// The words a rep actually says — species, profiles, the trade's shorthand —
// sampled LIVE from the view and cached for an hour. Two consumers: the
// transcriber (as a vocabulary prompt, so "ayous" does not come back "AOS")
// and the quote agent (so a mangled word still finds its product). A curated
// seed keeps both working when the catalog is unreachable.
const VOCAB_SEED = [
  "Ayous", "Thermo Ayous", "ThermoWood", "Ironthermo", "Thermowood Ash",
  "Accoya", "Cumaru", "Garapa", "Ipe", "Sablewood", "Massaranduba",
  "Angelim", "Sapele", "BurnBlock", "S4S", "E4E", "nickel gap", "V-joint",
  "fluted", "cladding", "decking", "siding", "linear feet",
];

let vocabCache: { words: string[]; at: number } | null = null;

export async function catalogVocabulary(): Promise<string[]> {
  if (vocabCache && Date.now() - vocabCache.at < 60 * 60 * 1000) {
    return vocabCache.words;
  }
  const words = new Set<string>(VOCAB_SEED);
  if (catalogConfigured()) {
    try {
      const params = new URLSearchParams({
        select: "species,profile",
        limit: "3000",
      });
      const res = await fetch(
        `${process.env.CATALOG_URL}/rest/v1/sales_catalog_view?${params}`,
        {
          headers: {
            apikey: process.env.CATALOG_APIKEY!,
            Authorization: `Bearer ${process.env.CATALOG_READER_JWT!}`,
          },
          cache: "no-store",
        },
      );
      if (res.ok) {
        const rows = (await res.json()) as {
          species: string | null;
          profile: string | null;
        }[];
        for (const r of rows) {
          for (const v of [r.species, r.profile]) {
            const t = (v ?? "").trim();
            if (t && t.length <= 40) words.add(t);
          }
        }
      }
    } catch {
      // the seed carries it
    }
  }
  const list = [...words];
  vocabCache = { words: list, at: Date.now() };
  return list;
}
