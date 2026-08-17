-- Exception snapshots that outlived what they were about.
--
-- 20260817000800 removed my development fixtures from the live project and bounded
-- every delete by created_at < 2026-08-13, so that anything genuine entered while
-- I was writing it would survive. That guard was right and it was also not
-- enough, because an exception snapshot is DERIVED: the fixtures were loaded on
-- the 12th, and the exception sweep kept generating fresh snapshots about them for
-- days afterwards. Six rows dated the 13th to the 17th therefore survived a
-- cutoff aimed at the 12th, and every one of them describes a task that no longer
-- exists:
--
--   OVERDUE_FOLLOW_UP      Store visit — verify display wall
--   OVERDUE_FOLLOW_UP      Follow up on the Thermo-Ash sample box
--   OVERDUE_FOLLOW_UP      Walk the yard with the purchasing manager
--   OVERDUE_FOLLOW_UP      Chase the cladding quote sent last week
--   OVERDUE_FOLLOW_UP      Collect the decking quote decision
--   OVERDUE_FOLLOW_UP      Intro visit — new counter manager
--
-- Those six would have kept sitting under "What's slipping" as overdue work,
-- pointing at next_actions rows that are gone. Worse than a stale number: a
-- prompt to chase something that never existed.
--
-- SO THE RULE IS NOT ANOTHER DATE, IT IS THE SUBJECT. A snapshot whose subject no
-- longer exists is a dangling claim, whatever its age, and that stays true long
-- after this migration — the next time somebody deletes a next action for a good
-- reason, its exceptions should go with it. Written that way on purpose rather
-- than as a second cutoff, which would have been the same guess made twice.
--
-- WHAT SURVIVES IS TRUE, and that is the test of whether this is right. Seven
-- snapshots remain, all about accounts and memberships that still exist:
-- Boise Cascade and Hardwoods Specialty have no activity, no champion and no next
-- action, and they genuinely do not. Those are real signals about real accounts,
-- which is exactly what that section is for.
--
-- Subject types are 'next_action', 'account' and 'membership'; all three are
-- checked, because the same reasoning applies to each and checking one would leave
-- the bug half fixed.

do $$
declare
  n integer;
begin
  delete from exception_snapshots e
   where (e.subject_type = 'next_action'
          and not exists (select 1 from next_actions x where x.id = e.subject_id))
      or (e.subject_type = 'account'
          and not exists (select 1 from accounts x where x.id = e.subject_id))
      or (e.subject_type = 'membership'
          and not exists (select 1 from memberships x where x.id = e.subject_id));
  get diagnostics n = row_count;
  raise notice 'orphaned exception snapshots removed: %', n;
end
$$;

-- One snapshot per subject is what the sweep intends, and an orphan is what it
-- cannot clean up on its own. This does not add a foreign key: subject_id is
-- polymorphic across three tables on purpose, so the check has to live in the
-- sweep rather than in the schema. Recorded here so the next person does not
-- reach for a constraint that cannot be written.
