// A US ZIP, resolved to its town, its state, and the region it lands in
// (2026-09-15). Called by the new-account form as the person types, so an
// account is created placed instead of arriving unplaced and waiting for
// somebody to notice.
//
// The lookup is Zippopotam (free, keyless, returns town + state + lat/long).
// It sits behind this route rather than being called from the browser so the
// provider can be swapped without touching the form, and so the answer is
// cached here: a ZIP's town does not change month to month.
//
// Placement is the session's own read of territory_states / territory_cities —
// the same tables the sales map places branches with — through placeAddress,
// which refuses to guess a California city that is not on the map.
//
// Offline, or if the provider is down, the form simply keeps its fields
// editable: this route is a convenience, never a gate on saving an account.

import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { placeAddress, type TerritoryCityRow, type TerritoryStateRow } from "@/lib/domain/placement";

interface ZippoPlace {
  "place name": string;
  "state abbreviation": string;
  latitude: string;
  longitude: string;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ zip: string }> },
) {
  const { zip } = await params;
  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "A US ZIP is five digits." }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let place: ZippoPlace | null = null;
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, {
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
    if (res.status === 404) {
      return NextResponse.json({ error: "No US town has that ZIP." }, { status: 404 });
    }
    if (!res.ok) throw new Error(`lookup ${res.status}`);
    const body = (await res.json()) as { places?: ZippoPlace[] };
    place = body.places?.[0] ?? null;
  } catch {
    return NextResponse.json(
      { error: "The ZIP lookup is not answering. Type the city and state by hand." },
      { status: 502 },
    );
  }
  if (!place) {
    return NextResponse.json({ error: "No US town has that ZIP." }, { status: 404 });
  }

  const city = place["place name"];
  const state = place["state abbreviation"];

  const [st, ct, tr] = await Promise.all([
    supabase.from("territory_states").select("state, territory_id").limit(200),
    supabase.from("territory_cities").select("state, city, territory_id").limit(1000),
    supabase.from("territories").select("id, name").limit(100),
  ]);
  const placement = placeAddress(
    { state, city },
    (st.data as TerritoryStateRow[] | null) ?? [],
    (ct.data as TerritoryCityRow[] | null) ?? [],
  );
  const territoryName = placement.territoryId
    ? ((tr.data as { id: string; name: string }[] | null) ?? []).find(
        (t) => t.id === placement.territoryId,
      )?.name ?? null
    : null;

  return NextResponse.json({
    zip,
    city,
    state,
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    territoryId: placement.territoryId,
    territoryName,
    how: placement.how,
  });
}
