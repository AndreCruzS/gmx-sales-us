-- EVERY LABEL WE HAVE SEEN NOW HAS AN ANSWER, NOT A GUESS (Andre, 2026-09-29).
--
-- The names we changed this week are for the screen. The files keep arriving
-- exactly as before, so the thing that has to be certain is the other
-- direction: that next month's identical row lands on the SAME dealer and does
-- not turn up as a new name.
--
-- Two mechanisms do that. dealer_aliases is an answer — a label, verbatim, and
-- the account it means — and it wins on insert. matchDealer is a guess: it
-- matches when every word of OUR name sits inside THEIRS. Of the 116 labels the
-- files have sent, 95 had an answer and 9 are the house's own counter. The
-- remaining TWELVE were riding on the guess alone — among them the two biggest
-- dealers in the book, Builders FirstSource (129,944 LF) and Ganahl (120,462).
--
-- One of them proves why that is not good enough: "BUIL4061 - BUILDERS FIRST
-- SOURCE" is matched in the stored rows, but the guess cannot reproduce it —
-- our name is "FirstSource", one word, and theirs is "FIRST SOURCE", two. It
-- was fixed by hand once. Next month it would have arrived unmatched and BFS's
-- page would have quietly lost that volume. The same fragility sits under
-- "84 LUMBER CO - WEST MIFFLIN" and the rest: a guess re-decided every month is
-- a decision nobody is making.
--
-- So: freeze what is already true. Every label whose rows all point at one
-- account becomes an alias saying so. Nothing moves today — this only makes
-- tomorrow's file land where this month's did. After it, matchDealer is what it
-- should be: the thing that greets a name we have never seen, and nothing else.
insert into dealer_aliases (org_id, label, dealer_id, created_by, note)
select distinct s.org_id, s.dealer_label, s.dealer_id,
       'c0000000-0000-0000-0000-000000000001'::uuid,
       'Frozen 2026-09-29 from the match already standing on every row of this label'
from sell_through s
where s.dealer_id is not null
  and not exists (
    select 1 from dealer_aliases al
    where al.org_id = s.org_id
      and al.label_key = lower(btrim(regexp_replace(s.dealer_label, '\s+', ' ', 'g'))))
  and not exists (
    select 1 from distributor_house_accounts h where h.dealer_label = s.dealer_label)
  -- Only where the label is unambiguous: every row of it on the same account.
  and not exists (
    select 1 from sell_through s2
    where s2.org_id = s.org_id and s2.dealer_label = s.dealer_label
      and (s2.dealer_id is null or s2.dealer_id <> s.dealer_id))
on conflict (org_id, label_key) do nothing;
