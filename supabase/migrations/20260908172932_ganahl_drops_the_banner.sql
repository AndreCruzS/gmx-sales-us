-- "(Banner)" RETIRED (Bianca, 2026-09-08: "porque toda vez que aparece
-- Ganahl Lumber aparece essa porra desse banner aqui do lado"). The suffix
-- was OUR disambiguator for the chain against its stores — but the stores
-- carry their own city names (Ganahl Anaheim, Ganahl Buena Park), so the
-- suffix distinguished nothing and read as noise. The matching never
-- depended on it: the import normalizer strips bracketed labels before
-- comparing. Guarded to the exact row it means.
update accounts
   set name = 'Ganahl Lumber'
 where id = 'd0000000-0000-0000-0000-000000000000'
   and name = 'Ganahl Lumber (Banner)';
