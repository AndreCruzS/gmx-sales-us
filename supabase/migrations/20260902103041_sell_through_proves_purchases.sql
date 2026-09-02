-- A spreadsheet is evidence (Andre, 2026-09-02): "nem sempre sabemos de quem
-- a empresa compra — mas ao receber uma planilha que prove o vínculo…"
--
-- A sell-through row with a MATCHED dealer is exactly that proof: the
-- distributor's own file says this dealer bought from this house that month.
-- From now on the fact is recorded where the channel lens already reads it —
-- account_relationships — the moment the row lands:
--
--   dealer PURCHASES_FROM distributor
--
-- One canonical direction (the same one test 14 proves resolves identically
-- to SUPPLIES), created once per pair by the unique key, and RE-CONFIRMED on
-- every later file: last_confirmed_at is the column born for this, so a link
-- proven again in August stops being a claim from July.
--
-- Statement-level trigger with a transition table, not per-row: an upload is
-- hundreds of rows in one insert, and the distinct pairs in it are a handful.
--
-- security definer, owned by postgres: the uploader is an admin writing
-- sell_through under their own RLS; the relationship write is the SYSTEM
-- recording a derived fact, not the admin exercising a permission.

create or replace function private.link_proven_purchases()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_relationships
    (org_id, account_a_id, relationship_type, account_b_id,
     notes, last_confirmed_at)
  select distinct
    n.org_id,
    n.dealer_id,
    'PURCHASES_FROM'::public.relationship_type,
    b.distributor_id,
    'Proven by a sell-through file',
    now()
  from new_rows n
  join public.distributor_branches b on b.id = n.branch_id
  where n.dealer_id is not null
    and n.dealer_id <> b.distributor_id
  on conflict (org_id, account_a_id, relationship_type, account_b_id)
    do update set last_confirmed_at = excluded.last_confirmed_at;
  return null;
end
$$;

create trigger sell_through_links_purchases
  after insert on sell_through
  referencing new table as new_rows
  for each statement
  execute function private.link_proven_purchases();

-- And what the book already holds proves its links today: the same insert,
-- once, over the existing rows. Locally this is a no-op (empty table before
-- seed) and the trigger then does the work as the seed loads.
insert into account_relationships
  (org_id, account_a_id, relationship_type, account_b_id,
   notes, last_confirmed_at)
select distinct
  st.org_id,
  st.dealer_id,
  'PURCHASES_FROM'::relationship_type,
  b.distributor_id,
  'Proven by a sell-through file',
  now()
from sell_through st
join distributor_branches b on b.id = st.branch_id
where st.dealer_id is not null
  and st.dealer_id <> b.distributor_id
on conflict (org_id, account_a_id, relationship_type, account_b_id)
  do update set last_confirmed_at = excluded.last_confirmed_at;
