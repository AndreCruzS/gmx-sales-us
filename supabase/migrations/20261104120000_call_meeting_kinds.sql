-- Timed commitments (spec 2026-11-04-timed-commitments-design.md), part 1.
--
-- A call or a meeting said with a time ("call Truckee Monday at 2", "meet Bia
-- Friday at 9") is a commitment on the agenda, not a chore on the routine
-- list. Two kinds of their own. Alone in this file because a new enum value
-- cannot be used in the transaction that adds it.

alter type public.next_action_kind add value if not exists 'CALL' after 'VISIT';
alter type public.next_action_kind add value if not exists 'MEETING' after 'CALL';
