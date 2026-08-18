-- A new yard places itself, instead of arriving off the map.
--
-- 20260817000600 gave every state a region and backfilled the eight Boise
-- branches from theirs. That fixed the branches THAT ALREADY EXISTED and left
-- the door open behind it: the loader at /sell-through inserts a new branch with
-- a name and the distributor's own code and NOTHING ELSE — no city, no state, no
-- territory. So the first month Bianca loads a house we have not seen before,
-- every one of its yards lands outside the territory map.
--
-- AND OFF THE MAP IS NOT NEUTRAL. sell_through_rows reads
--
--   coalesce(owner.id, d.owner_id)
--
-- so a branch with no region falls back to whoever owns the DEALER's banner —
-- which is exactly the misattribution the map was built to end. Boise's Dallas
-- and Detroit volume sat on a southern-California rep for the same reason. Left
-- alone, the loader would quietly recreate that on every new file, and the only
-- symptom is a rep's number being too big.
--
-- ── Why a trigger and not a line in the loader ─────────────────────────────
--
-- The loader is being taught to collect the state in the same change as this, so
-- a rule here is not the only thing standing between us and the bug. It is the
-- thing that stays true afterwards: a branch edited by hand, a branch inserted by
-- the next importer, a branch created by whatever replaces that screen. The state
-- is the fact somebody has; the region is derived from it, and derived data that
-- depends on remembering to call a function eventually meets somebody who did not.
--
-- ── What it will not do ────────────────────────────────────────────────────
--
-- IT ONLY EVER FILLS A NULL. A territory somebody set by hand outranks the state
-- table, and it has to: Riverside is in Southern California and Stockton is not,
-- and California is deliberately absent from the map for that reason. A rule that
-- overwrote a hand-placed Californian branch would undo the one case the client
-- told us the codes cannot decide.
--
-- IT FIRES ON THE STATE, NOT ON EVERY UPDATE. `update of state` means renaming a
-- branch, or clearing its territory on purpose, does not silently refill it.
-- Saying where a yard is is the only event that should place it.
--
-- A state the map does not cover — CA, HI, or a typo — resolves to null and the
-- branch stays honestly unplaced, which is what the map is for.

create or replace function private.branch_territory_from_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.territory_id is null and new.state is not null then
    new.territory_id := public.territory_for_state(new.org_id, new.state);
  end if;
  return new;
end
$$;

comment on function private.branch_territory_from_state is
  'Places a branch in the region covering its state, and only when no region was '
  'given. A hand-set territory always wins — California is split by geography and '
  'no state code can decide it.';

create trigger set_territory_from_state
  before insert or update of state on distributor_branches
  for each row execute function private.branch_territory_from_state();

-- ── Anything that slipped through in between ────────────────────────────────
--
-- The same statement 20260817000600 ran, again, for branches created since. It
-- is idempotent by construction — the where clause excludes everything it has
-- already done — and on a local reset it matches nothing, because migrations run
-- against an empty database before seed.sql.

update distributor_branches b
   set territory_id = public.territory_for_state(b.org_id, b.state)
 where b.territory_id is null
   and b.state is not null
   and public.territory_for_state(b.org_id, b.state) is not null;
