// The product picker's only door to the external catalog.
//
// public.sales_catalog_view lives on the connector project and is read with a
// reader_sales JWT that must never reach a browser — so the browser asks US,
// and this route asks the catalog. Read-only by construction: one GET, no
// body, no write path to a system we do not own. The fold itself lives in
// src/lib/catalog/search.ts, shared with the voice-quote agent's search tool
// so the picker and the model can never disagree about what a search returns.

import { NextRequest, NextResponse } from "next/server";
import { catalogConfigured, searchCatalog } from "@/lib/catalog/search";

export async function GET(req: NextRequest) {
  if (!catalogConfigured()) {
    // The honest state, not an error page: the screen says the catalog is not
    // wired up yet rather than pretending the search found nothing.
    return NextResponse.json({ connected: false, items: [] }, { status: 503 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ connected: true, items: [] });

  try {
    const { items, refreshedAt } = await searchCatalog(q);
    // Stock is rebuilt hourly; older than two hours means the job died and
    // the availability numbers should be read with a raised eyebrow.
    const staleMs = refreshedAt ? Date.now() - Date.parse(refreshedAt) : null;
    return NextResponse.json({
      connected: true,
      items,
      refreshedAt,
      stockStale: staleMs !== null && staleMs > 2 * 60 * 60 * 1000,
    });
  } catch {
    return NextResponse.json({ connected: false, items: [] }, { status: 502 });
  }
}
