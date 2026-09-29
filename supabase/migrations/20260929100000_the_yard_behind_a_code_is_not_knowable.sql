-- THE YARD BEHIND THESE CODES CANNOT BE KNOWN (Andre, 2026-09-29).
--
-- We were going to ask which 84 Lumber and which US LBM store each customer
-- code is. Andre's answer: nobody can tell us. Boise and Hardwoods send their
-- own customer number and the company's name, and neither the file nor the
-- people who send it carry the yard. So this is not a question waiting for an
-- answer — it is the end of the road, and it should read that way to whoever
-- opens these accounts next quarter.
--
-- What that changes: nothing structural. The banner IS the account, not a
-- placeholder for yards we will split later. What the files do know still
-- shows in the module — which house and which of their branches served it,
-- which is as close to a yard as this data reaches.
update accounts
set source_detail =
      'Bianca''s round-2 sheet, 2026-09-29: each distributor code is a store location, '
      'but the yard behind it is not in the file and cannot be found out (Andre, 2026-09-29). '
      'This account holds every code of the company; the module shows which house and branch served each one.'
where name in ('84 Lumber', 'US LBM Holdings')
  and source_detail like 'Bianca''s round-2 sheet%';
