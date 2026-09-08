-- THE CARD IS FOR THE FIELD, NOT THE PARTNERS (Bianca, 2026-09-08): "New
-- account, nothing booked" was listing DISTRIBUTORS — Boise, Russin — as
-- accounts owing a first visit. The system's north star, in her words: "dar
-- um norte para o time de vendas nos Estados Unidos" — and the field works
-- DEALERS. A distributor gets set up once and lives by orders and returns,
-- not first-visit follow-ups. The exception now speaks only of dealers.
--
-- security_invoker is RESTATED because CREATE OR REPLACE VIEW drops
-- reloptions it is not told about — the first push of this migration
-- shipped without it and the leakage suite caught a rep reading peers'
-- exceptions (fixed in 20260908170521, kept here so a fresh reset builds
-- the view right the first time).
create or replace view public.exception_new_account_no_follow_up
with (security_invoker = true) as
select 'NEW_ACCOUNT_NO_FOLLOW_UP'::text as exception_type,
    a.org_id,
    'account'::text as subject_type,
    a.id as subject_id,
    a.owner_id as owner_membership_id,
    a.name as title,
    ('created '::text || a.created_at::date) || ' with no next action scheduled'::text as detail,
    a.created_at as since
from accounts a
join organizations org on org.id = a.org_id
where a.account_type = 'DEALER'::account_type
  and a.created_at > (now() - make_interval(days => coalesce((org.settings ->> 'new_account_days'::text)::integer, 30)))
  and not exists (select 1 from next_actions na where na.account_id = a.id);
