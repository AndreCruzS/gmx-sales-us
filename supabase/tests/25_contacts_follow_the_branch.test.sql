-- Contacts follow the branch · tests 25 (20261020120000_contacts_follow_the_branch.sql).
--
-- 1. A person in a branch is seen by the branch's region, not the house's.
-- 2. A house person, in no branch, is seen by every rep.
-- 3. A dealer's person is still seen only through the dealer.
-- 4. The distributor reads for everyone; it does not become everyone's to edit.
--
-- deon    = SoCal       jason = NorCal       anthony = Northeast
-- boise   = d…0005, filed under SoCal       russin = d…0007

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

update distributor_branches set territory_id = 'b0000000-0000-0000-0000-000000000002'
 where distributor_id = 'd0000000-0000-0000-0000-000000000005' and name = 'Riverside Branch';
update distributor_branches set territory_id = 'b0000000-0000-0000-0000-000000000014'
 where distributor_id = 'd0000000-0000-0000-0000-000000000005' and name = 'Dallas Branch';

insert into distributor_branches (id, org_id, distributor_id, name, city, state)
values ('e2500000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'd0000000-0000-0000-0000-000000000007', 'Russin Montgomery', 'Montgomery', 'NY');
update distributor_branches set territory_id = 'b0000000-0000-0000-0000-000000000001'
 where id = 'e2500000-0000-0000-0000-000000000001';

insert into contacts (org_id, account_id, branch_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005',
   (select id from distributor_branches where name = 'Riverside Branch'
      and distributor_id = 'd0000000-0000-0000-0000-000000000005'), 'T25 Riverside Person'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005',
   (select id from distributor_branches where name = 'Dallas Branch'
      and distributor_id = 'd0000000-0000-0000-0000-000000000005'), 'T25 Dallas Person'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005',
   null, 'T25 House Person'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000007',
   'e2500000-0000-0000-0000-000000000001', 'T25 Montgomery Person'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001',
   null, 'T25 Anaheim Buyer');

-- ── Deonn, SoCal ────────────────────────────────────────────────────────────
select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;

select is((select count(*) from contacts where name = 'T25 Riverside Person'), 1::bigint,
  'a SoCal rep sees the Riverside branch''s person');
select is((select count(*) from contacts where name = 'T25 Dallas Person'), 0::bigint,
  'but not Dallas''s, though Boise is filed under SoCal');
select is((select count(*) from contacts where name = 'T25 House Person'), 1::bigint,
  'and sees the house''s head-office people');

reset role;

-- ── Anthony, Northeast ──────────────────────────────────────────────────────
select tests.set_claims('anthony@gmxgroup.com', 'gmx-us');
set local role authenticated;

select is((select count(*) from contacts where name = 'T25 Montgomery Person'), 1::bigint,
  'a Northeast rep sees the Montgomery yard''s person');
select is((select count(*) from contacts where name = 'T25 House Person'), 1::bigint,
  'and the house people, whatever region he holds');
select is((select count(*) from contacts where name = 'T25 Anaheim Buyer'), 0::bigint,
  'a dealer''s person is still seen only through the dealer');
select is((select name from accounts where id = 'd0000000-0000-0000-0000-000000000005'),
  'Boise Cascade', 'the distributor prints beside its people for every rep');

update accounts set name = 'Boise Renamed' where id = 'd0000000-0000-0000-0000-000000000005';
reset role;
select is((select name from accounts where id = 'd0000000-0000-0000-0000-000000000005'),
  'Boise Cascade', 'reading the distributor does not make it his to edit');

-- ── Jason, NorCal ───────────────────────────────────────────────────────────
select tests.set_claims('jason@gmxgroup.com', 'gmx-us');
set local role authenticated;

select is((select count(*) from contacts where name in ('T25 Riverside Person', 'T25 Dallas Person')),
  0::bigint, 'a NorCal rep sees neither SoCal''s nor Texas''s branch people');

reset role;

-- ── Bianca, admin ───────────────────────────────────────────────────────────
select tests.set_claims('bianca@gmxgroup.com', 'gmx-us');
set local role authenticated;

select is((select count(*) from contacts where name like 'T25 %'), 5::bigint,
  'an admin sees everyone');

reset role;
select tests.clear_auth();
select * from finish();
rollback;
