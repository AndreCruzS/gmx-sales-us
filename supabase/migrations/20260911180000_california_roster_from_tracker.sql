-- CALIFORNIA'S REAL ROSTER, FROM BIANCA'S OWN TRACKER (Andre, 2026-09-11).
--
-- `docs/territory/2026-09-california-rollout-tracker.xlsx` is the sheet the
-- team actually works from: every yard GMX is rolling out to in Southern
-- California, with its ZIP and the four gates. Until now the app held four
-- California dealers against the tracker's twenty-three, which is why 73% of the
-- sell-through had nobody to belong to.
--
-- WHAT IS TAKEN FROM THE DOCUMENT, AND WHAT IS NOT.
--   * the yard list, its ZIP, and the four gate readings — straight off the sheet
--   * the city — from the yard's own NAME, because that is what the sheet names
--     them by ("ANAHEIM", "TORRANCE"). Two are expanded: "SAN JUAN CAP" to San
--     Juan Capistrano and "N. HOLLYWOOD" to North Hollywood.
--   * NOT the city for Learned, Austin Hardwoods and Peterman: the sheet gives
--     them a ZIP and no town, and deriving a town from a ZIP is the kind of
--     guess that puts a yard on the wrong pin. They arrive with the ZIP and a
--     null city for somebody to finish.
--   * NOT Anawalt, Hudson or Strata Forest Products at all. The sheet itself
--     asks "Which one?" against their branch, so there is no yard to create yet.
--     Worth knowing: Hardwoods' August file answers it for one of them —
--     "ANAW9134 - ANAWALT LUMBER- ROBERTSON" — so Anawalt's Robertson yard is
--     the one buying.
--
-- THE FOURTH GATE. account_rollout carries three (pk, merchandiser, material);
-- the display wall lives on accounts.has_display_wall, which is a boolean and
-- cannot hold the sheet's "pending". So only "ok" sets it true, and all four
-- readings are written verbatim into the rollout note, where nothing is lost.
--
-- Owner is Deonn throughout, and territory Southern California, because
-- Master_Territory_Map_v2 names exactly one Market Owner for that ground.

-- ── A ZIP is a fact the sheet gives and the schema could not hold ───────────
alter table accounts add column if not exists postal_code text;
comment on column accounts.postal_code is
  'Postal code as the client''s own paper gives it. Kept even when the town is '
  'unknown: a ZIP is checkable, a town guessed from one is not.';

-- ── The two banners the tracker implies ────────────────────────────────────
with socal as (
  select t.id as territory_id, t.org_id, m.id as owner_id
  from territories t
  join memberships m on m.id = 'c0000000-0000-0000-0000-000000000004'::uuid
                    and m.org_id = t.org_id
  where t.name = 'Southern California'
)
insert into accounts (org_id, name, account_type, state, territory_id, owner_id,
                      lead_source, source_detail)
select s.org_id, v.name, 'DEALER', 'CA', s.territory_id, s.owner_id,
       'EXISTING_RELATIONSHIP',
       'California rollout tracker, 2026-09: banner over its yards'
from (values ('Builders FirstSource'), ('Dixie Line')) as v(name)
cross join socal s
on conflict (org_id, name) do nothing;

-- ── Every yard the sheet locates ───────────────────────────────────────────
with socal as (
  select t.id as territory_id, t.org_id, m.id as owner_id
  from territories t
  join memberships m on m.id = 'c0000000-0000-0000-0000-000000000004'::uuid
                    and m.org_id = t.org_id
  where t.name = 'Southern California'
),
yards(name, banner, city, zip, pk, merch, wall, material, product) as (values
  -- Ganahl: eleven yards, two of which we already held
  ('Ganahl Anaheim',              'Ganahl Lumber', 'Anaheim',             '92805','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Ganahl Buena Park',           'Ganahl Lumber', 'Buena Park',          '90621','OK','OK','no','NO',null),
  ('Ganahl Corona',               'Ganahl Lumber', 'Corona',              '92878','OK','OK','ok','PENDING','Ayous Fluted / Ayous V-joint'),
  ('Ganahl Costa Mesa',           'Ganahl Lumber', 'Costa Mesa',          '92626','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Ganahl San Juan Capistrano',  'Ganahl Lumber', 'San Juan Capistrano', '92675','OK','OK','no','OK','Ayous V-joint'),
  ('Ganahl Torrance',             'Ganahl Lumber', 'Torrance',            '90503','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Ganahl Northridge',           'Ganahl Lumber', 'Northridge',          '91324','OK','OK','no','NO',null),
  ('Ganahl Los Alamitos',         'Ganahl Lumber', 'Los Alamitos',        '90720','OK','OK','no','OK','Ayous Fluted / Ayous V-joint'),
  ('Ganahl Lake Forest',          'Ganahl Lumber', 'Lake Forest',         '92630','OK','NO','no','NO',null),
  ('Ganahl Laguna Beach',         'Ganahl Lumber', 'Laguna Beach',        '92651','OK','OK','pending','NO',null),
  ('Ganahl Pasadena',             'Ganahl Lumber', 'Pasadena',            '91107','OK','OK','ok','NO',null),
  -- Builders FirstSource: five California yards
  ('Builders FirstSource Mar Vista',       'Builders FirstSource','Mar Vista',       '90066','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Builders FirstSource Northridge',      'Builders FirstSource','Northridge',      '91324','OK','OK','no','NO',null),
  ('Builders FirstSource North Hollywood', 'Builders FirstSource','North Hollywood', '91605','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Builders FirstSource Hollywood',       'Builders FirstSource','Hollywood',       '90038','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Builders FirstSource Ventura',         'Builders FirstSource','Ventura',         '93003','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  -- Dixie Line: four San Diego-area yards, none of them merchandised yet
  ('Dixie Line Escondido', 'Dixie Line','Escondido','92025','OK','NO','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Dixie Line Miramar',   'Dixie Line','Miramar',  '92121','OK','NO','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Dixie Line El Cajon',  'Dixie Line','El Cajon', '92021','OK','NO','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Dixie Line La Mesa',   'Dixie Line','La Mesa',  '91941','OK','NO','ok','OK','Ayous Fluted / Ayous V-joint'),
  -- Standing on their own. The sheet gives a ZIP and no town for these three.
  ('Learned Lumber',   null, null, '90254','NO','NO',null,null,null),
  ('Austin Hardwoods', null, null, '92701','NO','PENDING','pending','OK','Ayous V-joint'),
  ('Peterman Lumber',  null, null, '92337','NO','NO','pending',null,null),
  -- Already ours, and the tracker finally gives it a place: ZIP 91406.
  ('Valencia Lumber',  null, null, '91406','OK','OK','ok','OK','Ayous V-joint')
)
insert into accounts (org_id, name, account_type, city, state, postal_code,
                      territory_id, owner_id, parent_account_id,
                      has_display_wall, lead_source, source_detail)
select s.org_id, y.name, 'DEALER', y.city, 'CA', y.zip,
       s.territory_id, s.owner_id,
       (select b.id from accounts b where b.org_id = s.org_id and b.name = y.banner),
       y.wall = 'ok',
       'EXISTING_RELATIONSHIP',
       'California rollout tracker, 2026-09'
from yards y cross join socal s
on conflict (org_id, name) do update
   set city             = coalesce(accounts.city, excluded.city),
       postal_code      = coalesce(accounts.postal_code, excluded.postal_code),
       parent_account_id= coalesce(accounts.parent_account_id, excluded.parent_account_id),
       has_display_wall = excluded.has_display_wall,
       source_detail    = excluded.source_detail;

-- The Northeast BFS yard joins its own banner. Its rep and region do not change:
-- groupByCompany will now show the banner as worked by two people with nobody
-- holding the whole, which is exactly what that flag is for.
update accounts a
set parent_account_id = (select b.id from accounts b
                          where b.org_id = a.org_id and b.name = 'Builders FirstSource')
where a.name = 'Builders FirstSource Middletown' and a.parent_account_id is null;

-- ── The gates, as the sheet reads them ─────────────────────────────────────
with rows(name, pk, merch, wall, material, product) as (values
  ('Ganahl Anaheim','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Ganahl Buena Park','OK','OK','no','NO',null),
  ('Ganahl Corona','OK','OK','ok','PENDING','Ayous Fluted / Ayous V-joint'),
  ('Ganahl Costa Mesa','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Ganahl San Juan Capistrano','OK','OK','no','OK','Ayous V-joint'),
  ('Ganahl Torrance','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Ganahl Northridge','OK','OK','no','NO',null),
  ('Ganahl Los Alamitos','OK','OK','no','OK','Ayous Fluted / Ayous V-joint'),
  ('Ganahl Lake Forest','OK','NO','no','NO',null),
  ('Ganahl Laguna Beach','OK','OK','pending','NO',null),
  ('Ganahl Pasadena','OK','OK','ok','NO',null),
  ('Builders FirstSource Mar Vista','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Builders FirstSource Northridge','OK','OK','no','NO',null),
  ('Builders FirstSource North Hollywood','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Builders FirstSource Hollywood','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Builders FirstSource Ventura','OK','OK','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Dixie Line Escondido','OK','NO','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Dixie Line Miramar','OK','NO','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Dixie Line El Cajon','OK','NO','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Dixie Line La Mesa','OK','NO','ok','OK','Ayous Fluted / Ayous V-joint'),
  ('Learned Lumber','NO','NO','—','NO',null),
  ('Austin Hardwoods','NO','PENDING','pending','OK','Ayous V-joint'),
  ('Peterman Lumber','NO','NO','pending','NO',null),
  ('Valencia Lumber','OK','OK','ok','OK','Ayous V-joint')
)
insert into account_rollout (account_id, org_id, pk_state, merchandiser_state,
                             material_state, product, notes)
select a.id, a.org_id,
       r.pk::rollout_gate_state, r.merch::rollout_gate_state, r.material::rollout_gate_state,
       r.product,
       format('California rollout tracker, 2026-09 — PK %s · merchandiser %s · display wall %s · material %s',
              lower(r.pk), lower(r.merch), r.wall, lower(r.material))
from rows r
join accounts a on a.name = r.name
on conflict (account_id) do update
   set pk_state           = excluded.pk_state,
       merchandiser_state = excluded.merchandiser_state,
       material_state     = excluded.material_state,
       product            = coalesce(excluded.product, account_rollout.product),
       notes              = excluded.notes;
