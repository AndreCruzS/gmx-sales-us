-- THE NINE HOUSE LABELS THE FILES CARRY, AND THE TWO LINES AUGUST LOST.
--
-- Named from the five files on hand. Every one of them was already counted in
-- the book — Andre's ruling is that they keep counting — so this adds no
-- volume; it adds the ability to say whose volume it is.
insert into distributor_house_accounts (org_id, distributor_id, dealer_label, kind, note)
select u.org_id, u.distributor_id, v.label, v.kind, v.note
from (values
  ('Boise Cascade',  'ZZSAM - SAMPLES',                      'SAMPLES',  'Boise sample stock'),
  ('Boise Cascade',  'ZZDIS - DISPLAYS',                     'DISPLAY',  'Boise showroom display material'),
  ('Boise Cascade',  'ZZZEMPDA - DALLAS EMPLOYEE ACCOUNT',   'STAFF',    'Boise Dallas staff purchases'),
  ('Boise Cascade',  'BCBMD - BOISE CASCADE BMDD',           'INTERNAL', 'Boise''s own building materials division'),
  ('Hardwoods Inc.', 'SAMPLG1 - HARDWOODS SP USLP - SAMPLES','SAMPLES',  'Hardwoods sample stock, Perris'),
  ('Hardwoods Inc.', 'SAMPLG3 - HARDWOODS SP USLP - SAMPLES','SAMPLES',  'Hardwoods sample stock, Phoenix'),
  ('Hardwoods Inc.', 'CAS0011 - CASH SALES - SO CAL',        'CASH',     'Hardwoods counter, Southern California'),
  ('Hardwoods Inc.', 'CAS0032 - CASH SALE WILL CALL PHOENIX','CASH',     'Hardwoods will-call counter, Phoenix'),
  ('Hardwoods Inc.', 'CASH993 - CASH CHATSWORTH - CABINET',  'CASH',     'Hardwoods counter, Chatsworth')
) as v(house, label, kind, note)
join accounts h on h.name = v.house
join (select distinct org_id, distributor_id from sell_through_uploads) u
  on u.distributor_id = h.id
on conflict (org_id, distributor_id, dealer_label) do nothing;

-- THE 336 LF AUGUST WAS MISSING. Two ZZSAM sample lines at Boise's Detroit
-- branch, 168 LF each, present in the spreadsheet and absent from the book.
--
-- This was found by reconciling the file against the database and then running
-- the loader itself over the same file: the loader KEEPS both lines, so their
-- absence was never a rule anybody wrote. Two independent recomputations of the
-- month agree on 73,720.50 LF where the book held 73,384.45.
--
-- Idempotent by the not-exists, so re-running cannot double the month.
insert into sell_through (org_id, upload_id, branch_id, dealer_id, dealer_label, period, product, quantity, unit, value)
select u.org_id, u.id, b.id, null, 'ZZSAM - SAMPLES', u.period, v.product, v.qty, 'LF', null
from sell_through_uploads u
join distributor_branches b on b.org_id = u.org_id and b.name = 'Detroit Branch'
                           and b.distributor_id = u.distributor_id
cross join (values
  ('083003120 1X6-RL THERMOWOOD CLADDING FLUTED AYOUS 7/BDL', 168::numeric),
  ('083003200 1X6-RL THERMOWOOD CLAD V-GRV/NCKL GAP AYOUS',   168::numeric)
) as v(product, qty)
where u.filename = 'a082ac1a7bcb43aeb8f895727c10af81.xlsx'
  and not exists (
    select 1 from sell_through s
    where s.upload_id = u.id and s.branch_id = b.id
      and s.dealer_label = 'ZZSAM - SAMPLES' and s.product = v.product
  );

update sell_through_uploads u
set row_count = (select count(*) from sell_through s where s.upload_id = u.id),
    unmatched_count = (select count(*) from sell_through s where s.upload_id = u.id and s.dealer_id is null)
where u.filename = 'a082ac1a7bcb43aeb8f895727c10af81.xlsx';
