-- PK follow-up, one status (2026-11-03). Action required and Status answered
-- the same question twice — where the item stands and whose move it is — so
-- the board keeps one: To do · In progress · Waiting on dealer · Stuck · Done.
-- This file only adds the new value; Postgres will not use a new enum value
-- in the transaction that adds it, so the move and the drop come next
-- (20261103130000), applied after the app that stops reading the old column.
alter type public.next_action_progress add value if not exists 'WAITING' after 'WORKING_ON_IT';
