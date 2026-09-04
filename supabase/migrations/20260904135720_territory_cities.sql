-- THE SPLIT STATE, DECIDED CITY BY CITY (Andre, 2026-09-04): California is
-- deliberately absent from territory_states — Riverside is in Southern
-- California and Stockton is not, and no state code can decide it (the
-- branch_finds_its_region doctrine). But the buy-in now reads regions off a
-- PO's ship-to, and CA is where the SoCal book actually ships. Same answer
-- as the branches: hand-placed knowledge, held in a table — a city the map
-- covers resolves, a city it does not stays honestly unplaced until an
-- admin adds it. Only the cities the client's map decides beyond doubt are
-- seeded.
create table territory_cities (
  org_id uuid not null references organizations(id),
  state text not null,
  city text not null,
  territory_id uuid not null references territories(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, state, city)
);

create trigger set_updated_at
  before update on territory_cities
  for each row execute function private.set_updated_at();

alter table territory_cities enable row level security;
create policy territory_cities_read on territory_cities
  for select to authenticated
  using (org_id = (select private.jwt_org_id()));
create policy territory_cities_write on territory_cities
  for all to authenticated
  using (org_id = (select private.jwt_org_id())
         and (select private.is_admin()))
  with check (org_id = (select private.jwt_org_id())
              and (select private.is_admin()));
grant select, insert, update, delete on territory_cities to authenticated;

-- The ship-to cities on the invoiced book today, none of them arguable:
-- Riverside is the client's own example of Southern California; Perris and
-- Anaheim sit beside it; San Francisco and Healdsburg are Northern
-- California beyond doubt.
insert into territory_cities (org_id, state, city, territory_id) values
  ('11111111-1111-1111-1111-111111111111', 'CA', 'RIVERSIDE',
   'b0000000-0000-0000-0000-000000000002'),
  ('11111111-1111-1111-1111-111111111111', 'CA', 'PERRIS',
   'b0000000-0000-0000-0000-000000000002'),
  ('11111111-1111-1111-1111-111111111111', 'CA', 'ANAHEIM',
   'b0000000-0000-0000-0000-000000000002'),
  ('11111111-1111-1111-1111-111111111111', 'CA', 'SAN FRANCISCO',
   'b0000000-0000-0000-0000-000000000011'),
  ('11111111-1111-1111-1111-111111111111', 'CA', 'HEALDSBURG',
   'b0000000-0000-0000-0000-000000000011')
on conflict do nothing;
