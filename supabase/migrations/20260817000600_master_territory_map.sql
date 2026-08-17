-- Bianca's Master Territory Map, as the client actually drew it.
--
-- Until now this app had two territories, "SoCal" and "Buffalo", both invented
-- by me to have something to seed. The client's real map has ten regions, names
-- for three of the ten owners, and — the part that matters most — A LIST OF
-- STATES PER REGION. That last column is the answer to the question the whole
-- branch-to-region migration was left blocked on: it is a rule, so it can be a
-- table, so a branch can find its own region instead of waiting for somebody to
-- file it by hand.
--
-- WHAT THE MAP SAYS
--
--   Pacific Northwest   WA OR AK                              TBD
--   Northern California northern & central CA                 Jason
--   Southern California southern CA                           Deonn Deford
--   Mountain            ID UT CO MT WY                        TBD
--   Southwest           AZ NV NM                              TBD
--   Texas               TX                                    TBD
--   Midwest             ND SD NE KS MN IA MO WI OH IL IN MI    TBD
--   South Central       OK AR LA                              TBD
--   Southeast           FL GA SC NC KY AL MS TN               TBD
--   Northeast           ME NH VT MA RI CT NY NJ PA DE MD VA WV Anthony Peca
--
-- CALIFORNIA IS DELIBERATELY NOT IN THE STATE TABLE. It is the one region pair
-- the client splits by geography rather than by postal code — "Northern &
-- Central" against "Southern" — and no two-letter code can tell Stockton from
-- Riverside. A rule that mapped CA to either one would silently hand five
-- hundred miles of somebody else's volume to a rep, which is the exact mistake
-- this file exists to stop. Californian branches are named one at a time, and
-- Riverside already was.
--
-- HAWAII IS ABSENT because it is absent from her map. Recording that as unknown
-- is the truth; guessing it into Pacific Northwest would be me inventing a
-- client decision.

-- ── The states table ────────────────────────────────────────────────────────
--
-- A table and not a CASE in a migration, because this is a business rule the
-- client owns and will change: a region gets split, a rep takes Nevada off the
-- Southwest. That has to be an edit, not a deploy.

create table territory_states (
  org_id       uuid not null references organizations (id) on delete cascade,
  state        text not null,
  territory_id uuid not null references territories (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (org_id, state)
);

comment on table territory_states is
  'Which region a US state belongs to, from the client''s Master Territory Map. '
  'One region per state, so a branch can resolve its own region from its address. '
  'California is intentionally absent: the client splits it north/south by '
  'geography and a state code cannot express that.';

create index territory_states_territory_idx on territory_states (territory_id);

create trigger set_updated_at
  before update on territory_states
  for each row execute function private.set_updated_at();

alter table territory_states enable row level security;

-- Readable by everyone in the org — a rep seeing which region covers Nevada is
-- not a leak, and the account pages want it. Written by admins only, same as
-- every other piece of reference data.
create policy territory_states_read on territory_states
  for select to authenticated
  using (org_id = (select private.jwt_org_id()));

create policy territory_states_write on territory_states
  for all to authenticated
  using (org_id = (select private.jwt_org_id()) and (select private.is_admin()))
  with check (org_id = (select private.jwt_org_id()) and (select private.is_admin()));

-- ── Resolving a branch's region from where it is ────────────────────────────

create or replace function public.territory_for_state(p_org uuid, p_state text)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select ts.territory_id
    from territory_states ts
   where ts.org_id = p_org
     and ts.state = upper(btrim(p_state))
$$;

comment on function public.territory_for_state is
  'The region covering a state, or null when the map does not say — which is a '
  'question for an admin, never a reason to guess.';

-- ── The regions themselves ──────────────────────────────────────────────────
--
-- The two that already exist are RENAMED rather than replaced. Riverside points
-- at SoCal, a membership points at Buffalo, and July''s sell-through is already
-- attributed through both; replacing them would orphan all of that to fix a
-- label. "SoCal" and "Southern California" are the same place, and the client''s
-- name is the right one — this app is meant to speak their language, not mine.
--
-- Everything here is guarded on the org existing, because migrations run against
-- an EMPTY database locally, before seed.sql. Without the guard this fails the
-- foreign key on every `supabase db reset` and again in CI. The seed carries the
-- same rows so local and production agree.

update territories
   set name = 'Southern California'
 where id = 'b0000000-0000-0000-0000-000000000002'
   and name = 'SoCal';

-- Buffalo was a city standing in for a region. The client's Northeast runs from
-- Maine to West Virginia, and Russin — the house that supplies it — is theirs.
update territories
   set name = 'Northeast'
 where id = 'b0000000-0000-0000-0000-000000000001'
   and name = 'Buffalo'
   -- unique (org_id, name): if a Northeast already exists in this org the rename
   -- would fail the constraint, so it simply does not happen.
   and not exists (
     select 1 from territories t
      where t.org_id = territories.org_id
        and t.name = 'Northeast'
   );

insert into territories (id, org_id, name)
select r.id, '11111111-1111-1111-1111-111111111111', r.name
from (values
  ('b0000000-0000-0000-0000-000000000010'::uuid, 'Pacific Northwest'),
  ('b0000000-0000-0000-0000-000000000011'::uuid, 'Northern California'),
  ('b0000000-0000-0000-0000-000000000012'::uuid, 'Mountain'),
  ('b0000000-0000-0000-0000-000000000013'::uuid, 'Southwest'),
  ('b0000000-0000-0000-0000-000000000014'::uuid, 'Texas'),
  ('b0000000-0000-0000-0000-000000000015'::uuid, 'Midwest'),
  ('b0000000-0000-0000-0000-000000000016'::uuid, 'South Central'),
  ('b0000000-0000-0000-0000-000000000017'::uuid, 'Southeast')
) as r(id, name)
where exists (
  select 1 from organizations where id = '11111111-1111-1111-1111-111111111111'
)
on conflict (org_id, name) do nothing;

-- territories.region was a second, coarser grouping I invented — "West",
-- "Northeast". The client's map has no such level: their Region IS this name.
-- Cleared rather than left half-filled, because a stale "West" sitting beside
-- "Southern California" is a label nobody can act on.
update territories
   set region = null
 where org_id = '11111111-1111-1111-1111-111111111111'
   and region is not null;

-- ── The states, exactly as the map lists them ───────────────────────────────

insert into territory_states (org_id, state, territory_id)
select '11111111-1111-1111-1111-111111111111', s.state, t.id
from (values
  ('WA', 'Pacific Northwest'), ('OR', 'Pacific Northwest'), ('AK', 'Pacific Northwest'),
  ('ID', 'Mountain'), ('UT', 'Mountain'), ('CO', 'Mountain'),
  ('MT', 'Mountain'), ('WY', 'Mountain'),
  ('AZ', 'Southwest'), ('NV', 'Southwest'), ('NM', 'Southwest'),
  ('TX', 'Texas'),
  ('ND', 'Midwest'), ('SD', 'Midwest'), ('NE', 'Midwest'), ('KS', 'Midwest'),
  ('MN', 'Midwest'), ('IA', 'Midwest'), ('MO', 'Midwest'), ('WI', 'Midwest'),
  ('OH', 'Midwest'), ('IL', 'Midwest'), ('IN', 'Midwest'), ('MI', 'Midwest'),
  ('OK', 'South Central'), ('AR', 'South Central'), ('LA', 'South Central'),
  ('FL', 'Southeast'), ('GA', 'Southeast'), ('SC', 'Southeast'), ('NC', 'Southeast'),
  ('KY', 'Southeast'), ('AL', 'Southeast'), ('MS', 'Southeast'), ('TN', 'Southeast'),
  ('ME', 'Northeast'), ('NH', 'Northeast'), ('VT', 'Northeast'), ('MA', 'Northeast'),
  ('RI', 'Northeast'), ('CT', 'Northeast'), ('NY', 'Northeast'), ('NJ', 'Northeast'),
  ('PA', 'Northeast'), ('DE', 'Northeast'), ('MD', 'Northeast'), ('VA', 'Northeast'),
  ('WV', 'Northeast')
) as s(state, region)
join territories t
  on t.org_id = '11111111-1111-1111-1111-111111111111'
 and t.name = s.region
on conflict (org_id, state) do nothing;

-- ── Every branch that can now place itself, does ────────────────────────────
--
-- This is the seven that were left as "— unknown —" when the branch-to-region
-- edge shipped, and they are no longer unknown: Dallas and Houston are Texas,
-- Memphis, Nashville and Atlanta are Southeast, Salt Lake is Mountain, Detroit
-- is Midwest. Nothing was decided here — the map decided, and this reads it.
--
-- Only branches with no region yet, so Riverside keeps the one it was given by
-- name and no future hand-correction is undone by a redeploy.

update distributor_branches b
   set territory_id = public.territory_for_state(b.org_id, b.state)
 where b.territory_id is null
   and b.state is not null
   and public.territory_for_state(b.org_id, b.state) is not null;

-- ── The view stops guessing once a branch knows where it is ─────────────────
--
-- rep_id was coalesce(region owner, dealer owner), which was right while no
-- branch had a region: something had to hold the number up. It is wrong now.
--
-- Dallas is Texas, and Texas has no Market Owner — the map says TBD. Under the
-- coalesce that null falls through to the dealer's owner, so Texas volume lands
-- on Deon because GMX happens to hold the Builders FirstSource banner in his
-- territory. That is the precise misattribution this whole thread of work set
-- out to remove, and leaving the fallback in place would have quietly preserved
-- it behind a map that looks correct.
--
-- So: if the branch has a region, THE REGION DECIDES — including when the region
-- decides "nobody". An unowned region showing as "Nobody yet" is a gap somebody
-- can fill; the same volume sitting on the wrong rep's number is a gap nobody
-- can see. The dealer's owner is used only where a branch still has no region at
-- all, which after this migration is a branch whose state we do not hold.

drop view if exists sell_through_rows;

create view sell_through_rows (
  org_id, period,
  rep_id, rep_name,
  region_id, region_name,
  market_owner_id, market_owner_name,
  distributor_id, distributor_name,
  branch_id, branch_name, branch_city, branch_state,
  dealer_id, dealer_name, dealer_label,
  product, quantity, unit, value
) with (security_invoker = true) as
select
  st.org_id,
  st.period,
  case when b.territory_id is not null then owner.id else d.owner_id end,
  case
    when b.territory_id is not null
      then (select coalesce(ou.full_name, ou.email) from users ou where ou.id = owner.user_id)
    else coalesce(du.full_name, du.email)
  end,
  t.id,
  t.name,
  owner.id,
  (select coalesce(ou.full_name, ou.email) from users ou where ou.id = owner.user_id),
  dist.id,
  dist.name,
  b.id,
  b.name,
  b.city,
  b.state,
  d.id,
  d.name,
  st.dealer_label,
  st.product,
  st.quantity,
  st.unit,
  st.value
from sell_through st
join distributor_branches b on b.id = st.branch_id
join accounts dist on dist.id = b.distributor_id
left join territories t on t.id = b.territory_id
left join lateral (
  select m2.id, m2.user_id
    from memberships m2
   where m2.territory_id = t.id
     and m2.org_id = st.org_id
     and m2.role = 'rep'
   order by m2.created_at
   limit 1
) as owner on true
left join accounts d on d.id = st.dealer_id
left join memberships m on m.id = d.owner_id
left join users du on du.id = m.user_id;

comment on view sell_through_rows is
  'Sell-through with the whole chain attached: the region the branch sits in and '
  'its Market Owner, the distributor, its branch, and the dealer. A branch with a '
  'region is attributed to that region''s owner even when it has none, so an '
  'unowned region reads as a gap rather than landing on whichever rep happens to '
  'own the dealer''s banner. RLS is inherited from sell_through.';

grant select on sell_through_rows to authenticated;
