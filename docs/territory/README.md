# The territory map, and the California ground

- `Master_Territory_Map_v2.xlsx` — the client's own Region / States Covered /
  Market Owner / Distributors table. This is the authority the app's
  `territories` and `territory_states` are built from.
- `2026-09-california-rollout-tracker.xlsx` — Bianca's California sheet: every
  yard GMX is rolling out to, with its ZIP and the four gates (PK, merchandiser,
  display wall, material in stock), plus contacts and open quotes.

## What the map says, checked against the database 2026-09-11

Every state line matches, region for region — Midwest, Mountain, Northeast,
Pacific Northwest, South Central, Southeast, Southwest and Texas all agree with
what `territory_states` holds. The two California regions carry no states on
purpose: California is placed CITY by city (`territory_cities`), never by state,
because one state holds two markets.

**Market Owner, as the map writes it:** Northern California — Jason. Southern
California — Deonn Deford. Northeast — Anthony Peca. Every other region: TBD.

**THE MAP DOES NOT SPLIT CALIFORNIA.** Southern California has one owner in it.
The database nevertheless carries a second active rep membership there
(alejandro.nunez@), who appears in no version of this map. The sell-through view
picks a region's rep with `ORDER BY created_at LIMIT 1`, so every LF in Southern
California is credited to Deonn — which agrees with this document, and hides the
fact that a second person holds a membership on the same ground. That is a
question about Alejandro's membership, not about where to draw a line.
