-- BIANCA'S ROUND TWO, ANSWERED (sheet of 2026-09-28, returned 2026-09-29).
--
-- She read the ninety labels that had no account and said, one by one, whether
-- the name is a dealer. Eighty-four are. Nine of the ninety were already known
-- to be the distributor's own counter, samples, displays or staff — they live
-- in distributor_house_accounts and stay there, whatever a tired row of the
-- sheet says, because that is what the book already proves. One, Anawalt
-- Robertson, she marked both ways in two different cells; it waits for her
-- word rather than for our guess.
--
-- That leaves EIGHTY labels to give an owner, and they become SEVENTY-SEVEN
-- accounts:
--   * "84 Lumber" holds both of its labels and "US LBM Holdings" all three.
--     She answered that each code is a STORE LOCATION, and asked whether the
--     "<Company> <City>" rule we used for Interstate & Lakeland can be the
--     rule everywhere. It can — but a yard needs its city and she has not sent
--     them yet. Until she does the banner holds the labels: the volume gains
--     an owner today, and splitting a banner into its yards later moves an
--     alias, not a figure.
--   * Her other answers, in her words: Tague keeps Philadelphia, the Home
--     Depot in the Dallas file is a Texas account of its own, BMC is its own
--     yard and not a BFS one, LABL Holdings is Beyond Lumber (already done).
--
-- WHERE EACH ONE LANDS. Not from a list somebody typed: the region and the
-- house come from the rows themselves — the region that bought the most linear
-- feet under that label, and the house that sold them. A label that spans
-- three regions (Lowe's, Do It Best, the LMC buying group) sits with the
-- biggest, and every row goes on crediting its own region regardless.
--
-- STATE IS LEFT EMPTY on purpose. The files carry the distributor's branch,
-- not the dealer's address, and a guessed state is worse than a blank one. The
-- city is filled only where the label itself names the yard ("TAGUE -
-- PHILADELPHIA").
--
-- One statement, so that no account is left without the alias that gives it
-- its rows: the aliases read the accounts this same statement creates, through
-- what the insert returns.

with org as (
  select distinct org_id from sell_through
),
answered(label, name, city) as (values
    ('LUMMEWA - LUMBERMENS MERCHANDISING', 'Lumbermens Merchandising', null),
    ('84L8820 - 84 LUMBER COMPANY', '84 Lumber', null),
    ('CASJOLLO - CASSITY JONES LBR & BLDG MTLS', 'Cassity Jones Lumber & Building Materials', null),
    ('LEEROJDA - LEE ROY JORDAN REDWOOD LUMBER', 'Lee Roy Jordan Redwood Lumber', null),
    ('USLBHGB - US LBM HOLDINGS LLC', 'US LBM Holdings', null),
    ('PATHACO - PATES HARDWARE INC', 'Pates Hardware Inc', null),
    ('THRBUSCO - MAXIMUS BUILDING SUPPLY', 'Maximus Building Supply', null),
    ('EIGFOLEF - 84 LUMBER COMPANY', '84 Lumber', null),
    ('LKLASWJ - LKL ASSOCIATES INC', 'LKL Associates Inc', null),
    ('WHELUOG - WHEELWRIGHT LUMBER', 'Wheelwright Lumber', null),
    ('OPEN4553 - OPEN ENCLOSE, LLC', 'Open Enclose, LLC', null),
    ('DOITBFW - DO IT BEST CORPORATION', 'Do It Best Corporation', null),
    ('LANBUPRI - LANSING BUILDING PRODUCTS LLC', 'Lansing Building Products LLC', null),
    ('LOWCONW - LOWE''S COMPANIES INC', 'Lowe''s Companies Inc', null),
    ('OWEADCA - OWEN-ADAMS INC', 'Owen-Adams Inc', null),
    ('BIGDLURI - BIG D LUMBER CO LLC', 'Big D Lumber Co LLC', null),
    ('DESI6977 - DESIGNER REMODELING LLC', 'Designer Remodeling LLC', null),
    ('HELD3378 - HELDT LUMBER COMPANY, INC.', 'Heldt Lumber Company, Inc.', null),
    ('OAKLUNA - OAKLEY LUMBER COMPANY', 'Oakley Lumber Company', null),
    ('JONLULY - JONES LUMBER COMPANY', 'Jones Lumber Company', null),
    ('STRLUSL - STRINGHAM LUMBER', 'Stringham Lumber', null),
    ('BMC3181CH - BMC', 'BMC', null),
    ('FROHASA - FROST HARDWOOD LUMBER COMPANY', 'Frost Hardwood Lumber Company', null),
    ('HOMDEAT - HOME DEPOT', 'Home Depot Texas', null),
    ('NORSUNO - NORCROSS SUPPLY CO', 'Norcross Supply Co', null),
    ('BURLUSL - BURTON LUMBER', 'Burton Lumber', null),
    ('ALSSUAK - ALSIDE SUPPLY', 'Alside Supply', null),
    ('CHABUMCH - CUSTOM BLDG SPLY CHATTANOOGA', 'Custom Building Supply Chattanooga', null),
    ('BAT3394 - BORIS LOPEZ', 'Boris Lopez', null),
    ('NAMASTR - N A MANS & SONS INC', 'N A Mans & Sons Inc', null),
    ('LIBERTY CEDAR - W. KINGSTON', 'Liberty Cedar West Kingston', 'West Kingston'),
    ('LOEFALSE - LOEWEN FARM & LUMBER INC', 'Loewen Farm & Lumber Inc', null),
    ('CHEWOPUP - CHEROKEE WOOD PRODUCTS INC', 'Cherokee Wood Products Inc', null),
    ('ELEV4332 - ELEVATED DECK SYSTEMS, INC.', 'Elevated Deck Systems, Inc.', null),
    ('JWLCOES - J&W LUMBER COMPANY, INC.', 'J&W Lumber Company, Inc.', null),
    ('HARDWOOD REALTY LLC - PINE PLAINS', 'Hardwood Realty Pine Plains', 'Pine Plains'),
    ('LBMADNW - LBM ADVANTAGE', 'LBM Advantage', null),
    ('MASHAIR - MASTER-HALCO INC', 'Master-Halco Inc', null),
    ('ARIZ0000 - US LBM HOLDINGS, LLC', 'US LBM Holdings', null),
    ('SKYBUSEP - SKYLINE BUILDERS SUPPLY', 'Skyline Builders Supply', null),
    ('SUPE1415 - SUPERIOR MOULDING, INC.', 'Superior Moulding, Inc.', null),
    ('CAS3100 - CASTLE ROCK DOORS MOULDINGS &', 'Castle Rock Doors & Mouldings', null),
    ('ROYPLCE - ROYAL PLYWOOD COMPANY INC', 'Royal Plywood Company Inc', null),
    ('THOSUCU - THOMAS SUPPLY COMPANY INC', 'Thomas Supply Company Inc', null),
    ('GLASSBORO LUMBER - GLASSBORO', 'Glassboro Lumber', 'Glassboro'),
    ('ORGME - ORGILL INC', 'Orgill Inc', null),
    ('CONCORD/LITTLETON - LITTLETON', 'Concord/Littleton', 'Littleton'),
    ('DWA1540 - DW ACQUISITION, INC.', 'DW Acquisition, Inc.', null),
    ('FOXW4494 - US LBM HOLDINGS, LLC', 'US LBM Holdings', null),
    ('CHAM8739 - CHAMPION WOOD SPECIALTIES LLC', 'Champion Wood Specialties LLC', null),
    ('RANS0240 - G & L LUMBER, INC.', 'G & L Lumber, Inc.', null),
    ('MILL9400 - MILLER WHOLESALE LUMBER CO', 'Miller Wholesale Lumber Co', null),
    ('FABRIZIO WOOD PRODUCTS - MIDDLETON', 'Fabrizio Wood Products Middleton', 'Middleton'),
    ('FRIWHLFR - FRISCO WHOLESALE LUMBER', 'Frisco Wholesale Lumber', null),
    ('CRALUDA - CRADDOCK LUMBER CO', 'Craddock Lumber Co', null),
    ('TAGUE - PHILADELPHIA', 'Tague Lumber Philadelphia', 'Philadelphia'),
    ('CANA8176 - CANARY WORKSHOP LLC', 'Canary Workshop LLC', null),
    ('KTCUEMI - KT CUSTOM EXTERIOR SUPPLY LLC', 'KT Custom Exterior Supply LLC', null),
    ('ABCSUBE - ABC SUPPLY COMPANY INC', 'ABC Supply Company Inc', null),
    ('PAC3201 - JBI LLC', 'JBI LLC', null),
    ('BRO3000 - BROOKS MILLWORK, LLC', 'Brooks Millwork, LLC', null),
    ('C.A. NIECE CO INC - LAMBERTVILLE', 'C.A. Niece Lambertville', 'Lambertville'),
    ('FINE7963 - BW FINE CARPENTRY & DESIGN LLC', 'BW Fine Carpentry & Design LLC', null),
    ('WHELUGR - WHEAT LUMBER CO INC', 'Wheat Lumber Co Inc', null),
    ('WARRENS WOOD WORKS - EASTON', 'Warrens Wood Works Easton', 'Easton'),
    ('SARLUHP - SAROYAN LUMBER COMPANY', 'Saroyan Lumber Company', null),
    ('ECL9500 - ECLECTICS', 'Eclectics', null),
    ('XTR3111 - XTREME WOODWORKING, INC.', 'Xtreme Woodworking, Inc.', null),
    ('SERN4222 - SERNA CABINETS, INC.', 'Serna Cabinets, Inc.', null),
    ('INTE8391 - INTEGRO WINDOWS AND DOORS LLC', 'Integro Windows and Doors LLC', null),
    ('CLAR0233 - CLARITY GROUP LLC', 'Clarity Group LLC', null),
    ('LOZ3208 - LOZANO''S CREATIVE CABINETS', 'Lozano''s Creative Cabinets', null),
    ('TEALUFW - TEAGUE LUMBER COMPANY', 'Teague Lumber Company', null),
    ('HENLUCR - HENSON LUMBER LTD', 'Henson Lumber Ltd', null),
    ('SRSDIMC - SRS DISTRIBUTION INC', 'SRS Distribution Inc', null),
    ('HAYLUMO - HAYWARD LUMBER COMPANY', 'Hayward Lumber Company', null),
    ('CRDOMSP - C R DOORS & MOULDING LLC', 'C R Doors & Moulding LLC', null),
    ('COLBUSCE - COLONIAL BLDG SUPPLY INC', 'Colonial Building Supply Inc', null),
    ('CARLUSAT - CAROLINA LUMBER & SUPPLY', 'Carolina Lumber & Supply', null),
    ('NICLUHBA - NICHOLS LUMBER & HARDWARE', 'Nichols Lumber & Hardware', null)
),
-- The region and house each name actually buys through, by weight of volume.
weight as (
  select v.name, r.region_id, r.distributor_id, sum(r.quantity) as lf
  from answered v
  join sell_through_rows r on r.dealer_label = v.label
  group by v.name, r.region_id, r.distributor_id
),
placed as (
  select distinct on (name) name, region_id, distributor_id
  from weight
  order by name, lf desc, region_id
),
company as (
  select v.name, min(v.city) as city, p.region_id, p.distributor_id
  from answered v
  left join placed p on p.name = v.name
  group by v.name, p.region_id, p.distributor_id
),
made as (
  insert into accounts
    (org_id, name, account_type, city, state, territory_id, owner_id,
     lead_source, source_detail, referring_account_id)
  select o.org_id, c.name, 'DEALER', c.city, null, c.region_id,
         coalesce(
           (select m.id from memberships m
             where m.territory_id = c.region_id
               and m.role = 'rep' and m.status = 'active'
             order by m.id limit 1),
           -- A region with no rep of its own is held by an admin, as Mountain
           -- has been since Timberline.
           'c0000000-0000-0000-0000-000000000001'::uuid),
         'REFERRAL_DISTRIBUTOR',
         'Bianca''s round-2 sheet, answered 2026-09-29: yes, a dealer',
         c.distributor_id
  from company c cross join org o
  where not exists (
    select 1 from accounts x where x.org_id = o.org_id and x.name = c.name
  )
  returning id, org_id, name
),
resolved as (
  select o.org_id, v.label, coalesce(m.id, a.id) as dealer_id
  from answered v
  cross join org o
  left join made m on m.org_id = o.org_id and m.name = v.name
  left join accounts a on a.org_id = o.org_id and a.name = v.name
),
aliased as (
  -- Her word, one alias per spelling. The trigger links the rows already
  -- stored and records the PURCHASES_FROM the file proves.
  insert into dealer_aliases (org_id, label, dealer_id, created_by, note)
  select r.org_id, r.label, r.dealer_id,
         'c0000000-0000-0000-0000-000000000001'::uuid,
         'Bianca''s round-2 sheet, answered 2026-09-29'
  from resolved r
  where r.dealer_id is not null
  on conflict (org_id, label_key) do nothing
  returning 1
)
select (select count(*) from made) as accounts_created,
       (select count(*) from aliased) as aliases_written;

-- The yards we already had hang under the banner, so "84 Lumber" adds up.
update accounts y
set parent_account_id = b.id
from accounts b
where b.org_id = y.org_id
  and b.name = '84 Lumber'
  and y.parent_account_id is null
  and y.name in ('84 Lumber Patchogue', '84 Lumber Rochester', '84 Lumber West Mifflin');
