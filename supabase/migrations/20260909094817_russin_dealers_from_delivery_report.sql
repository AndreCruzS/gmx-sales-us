-- RUSSIN'S DEALERS, FROM THE ONLY PAPER THEY HAVE SENT (Andre, 2026-09-09).
-- Russin's delivery report of 2026-05-27 (docs/russin/2026-05-27-russin-
-- dealer-deliveries.csv) is dollars by delivery address — no SKU, no LF, no
-- period — so it cannot be a sell-through return and never goes through the
-- loader. What it does prove is WHO Russin delivers to: fourteen dealers
-- across NY, MA, NJ, PA, DE and VT, in a region the map showed as "no
-- coverage" with a single dealer account (Buffalo Lumber). Each becomes a
-- dealer account owned by the Northeast rep, referred by Russin, with the
-- paper as its PURCHASES_FROM proof — the same paper-proves / person-
-- confirms split the sell-through trigger writes. Named brand + city (D51).
--
-- Guarded like the caps link: a fresh local reset has no seed yet when
-- migrations run, so without Russin, the territory or the rep membership
-- this is a clean no-op.
with russin as (
  select a.id as russin_id, a.org_id,
         t.id as territory_id,
         m.id as owner_id
  from accounts a
  join territories t on t.org_id = a.org_id and t.name = 'Northeast'
  join memberships m on m.id = 'c0000000-0000-0000-0000-000000000011'::uuid
                    and m.org_id = a.org_id
  where a.id = 'd0000000-0000-0000-0000-000000000007'::uuid
),
dealers(name, address, city, state, orders, dollars, first_order, last_order) as (
  values
    ('Builders FirstSource Middletown', '87 Wisner Avenue, #272',          'Middletown',   'NY', 1,     0.00, date '2026-02-17', date '2026-02-17'),
    ('Messco Building Supply Walden',   '2400 State Route 208',            'Walden',       'NY', 3, 15349.49, date '2026-03-31', date '2026-05-07'),
    ('Walter & Jackson Christiana',     '44 E Gay Street',                 'Christiana',   'PA', 2,  3617.25, date '2026-04-20', date '2026-04-29'),
    ('84 Lumber Rochester',             '1505 Scottsville Rd',             'Rochester',    'NY', 2,  3332.00, date '2026-01-07', date '2026-01-07'),
    ('Curtis Cash & Carry Castleton',   '1657 Columbia Turnpike, Store #1904', 'Castleton', 'NY', 3,  4808.72, date '2026-02-05', date '2026-05-15'),
    ('Dukes Lumber Laurel',             '28504 Dukes Lumber Ave.',         'Laurel',       'DE', 1,  2728.32, date '2026-03-17', date '2026-03-17'),
    ('Dykes Lumber North Bergen',       '6001 Tonnelle Ave',               'North Bergen', 'NJ', 1,     0.00, date '2026-01-28', date '2026-01-28'),
    ('Home Depot Hyannis',              '65 Independence Drive, Store #2612', 'Hyannis',   'MA', 2, 10603.25, date '2025-12-15', date '2025-12-22'),
    ('National Lumber Berlin',          '25 Central Street',               'Berlin',       'MA', 3,  4519.41, date '2025-08-25', date '2026-04-17'),
    ('National Lumber Salem',           '33 Mason Street',                 'Salem',        'MA', 2,  5676.65, date '2025-09-19', date '2025-11-12'),
    ('RK Miles Morrisville',            '207 Portland Street, Member #199100', 'Morrisville', 'VT', 1, 1482.25, date '2026-03-27', date '2026-03-27'),
    ('Tague Lumber Pipersville',        '6100 Easton Road, Member #273500', 'Pipersville',  'PA', 3,   878.08, date '2025-11-19', date '2025-12-29'),
    ('Timberline Enterprises Braintree','110 Hancock Street',              'Braintree',    'MA', 2,  1898.19, date '2026-05-14', date '2026-05-27'),
    ('Tuckerton Lumber',                '13 Railroad Ave',                 'Tuckerton',    'NJ', 1,  9299.78, date '2026-05-26', date '2026-05-26')
),
inserted as (
  insert into accounts
    (org_id, name, account_type, address, city, state, territory_id, owner_id,
     lead_source, source_detail, referring_account_id)
  select r.org_id, d.name, 'DEALER', d.address, d.city, d.state,
         r.territory_id, r.owner_id,
         'REFERRAL_DISTRIBUTOR',
         'Russin delivery report of 2026-05-27',
         r.russin_id
  from dealers d cross join russin r
  on conflict (org_id, name) do nothing
  returning id, name, org_id
)
insert into account_relationships
  (org_id, account_a_id, relationship_type, account_b_id, notes, last_confirmed_at)
select i.org_id, i.id, 'PURCHASES_FROM', r.russin_id,
       format('Russin delivery report of 2026-05-27: %s order%s, $%s, %s to %s',
              d.orders, case when d.orders = 1 then '' else 's' end,
              to_char(d.dollars, 'FM999,999,990.00'),
              to_char(d.first_order, 'YYYY-MM-DD'), to_char(d.last_order, 'YYYY-MM-DD')),
       timestamptz '2026-05-27'
from inserted i
join dealers d on d.name = i.name
cross join russin r
on conflict (org_id, account_a_id, relationship_type, account_b_id)
  do update set last_confirmed_at = excluded.last_confirmed_at,
                notes = excluded.notes;
