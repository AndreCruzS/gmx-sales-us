-- THE PK GATE SAID 21 AND ITS OWN LIST SAID 20 (Andre, 2026-10-02).
--
-- Two readings of one fact. The headline counted `pk_state = 'OK'`; the unfold
-- underneath it counted `pk_count > 0`. One dealer — Ganahl Anaheim — carried
-- OK with a count of zero, so the book claimed a class that the list of names
-- could not show. A number nobody can follow to a name is worse than a smaller
-- number, and "21 of 136" over a list of 20 is exactly that.
--
-- HOW THE ROW GOT THERE. 20260828000100 added pk_count, backfilled every OK row
-- to 1, and hung a trigger that keeps the two in step — but on
-- `update of pk_count`. A writer that touches pk_state and NOT pk_count never
-- fires it, and on 2026-09-11 something did exactly that (updated_by null, so a
-- script rather than a person). The trigger was guarding one door of two.
--
-- THE MODEL, restated: the COUNT is the fact — how many times that counter has
-- actually been taught — and the state is derived from it. So:
--   · a state-only writer saying OK with no count implies the first class,
--     on UPDATE for the same reason it already did on INSERT;
--   · any count above zero means the gate is done, whatever the state says;
--   · the count going back to zero un-does it, and PENDING is left alone
--     (a class being scheduled is not a class taught).

-- The one row, repaired by the same statement 20260828000100 ran once.
update account_rollout
   set pk_count = 1
 where pk_state = 'OK' and pk_count = 0;

create or replace function private.account_rollout_sync_pk()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pk_count = 0
     and new.pk_state = 'OK'
     and (tg_op = 'INSERT' or old.pk_state is distinct from 'OK')
  then
    -- A state-only writer (the tracker import) says done without a count: the
    -- state is the truth on the way IN, so it implies the first class. Now on
    -- update too — an upsert that lands on a conflict is an update, which is
    -- how the one bad row was written.
    new.pk_count := 1;
  elsif new.pk_count > 0 then
    new.pk_state := 'OK';
  elsif new.pk_state = 'OK' then
    -- The count is zero and was already OK before this write: the class was
    -- taken back, so the gate is no longer done.
    new.pk_state := 'NO';
  end if;
  return new;
end;
$$;

-- BOTH DOORS. `update of pk_count` left pk_state writable behind the trigger's
-- back. On every update instead: for any row where the two already agree the
-- function is a no-op, so the only writes it changes are the ones that would
-- have put the table into a state the screen cannot explain.
drop trigger if exists sync_pk_state on account_rollout;
create trigger sync_pk_state
  before insert or update on account_rollout
  for each row execute function private.account_rollout_sync_pk();

comment on function private.account_rollout_sync_pk() is
  'Keeps account_rollout.pk_state derived from pk_count: the count is the fact, '
  'the state follows it. Fires on every write — a pk_state-only update used to '
  'slip past it and leave the book disagreeing with its own list of names.';
