-- The one edge Bianca's hierarchy needs that the schema did not have.
--
-- She wrote it out as:
--
--   Region → Market Owner (Rep) → Distributor → Branch → Dealer → Project → End Customer
--
-- and every level of that already exists here — territories, memberships.territory_id,
-- accounts DISTRIBUTOR, distributor_branches, accounts DEALER, projects,
-- project_stakeholders. Exactly one link was missing: nothing said which region a
-- BRANCH sits in. That is what this adds.
--
-- WHY THE EDGE HANGS OFF THE BRANCH AND NOT THE DISTRIBUTOR. Read strictly, her
-- chain puts Distributor under Market Owner, which would make the house the thing
-- a rep owns. That cannot hold: Boise Cascade ships out of Riverside, Dallas,
-- Memphis, Salt Lake, Detroit, Atlanta, Houston and Nashville, and no rep owns all
-- of that. Her chain is a DRILL PATH — the three lenses on the dashboard walk it —
-- not an ownership tree. The thing that physically sits in one region is the
-- branch, so the branch is what carries the region.
--
-- WHAT THIS FIXES, TODAY, IN PRODUCTION. Attribution currently flows through the
-- DEALER's account: whose volume a row is depends on which single territory the
-- customer happens to be filed under. So Boise's Dallas and Detroit branches are
-- both credited to SoCal, because we hold the Builders FirstSource banner there —
-- Deon has Texas and Michigan volume on his number. Once a branch carries its own
-- region, where the goods shipped from decides whose they are.

alter table distributor_branches
  add column territory_id uuid references territories (id);

comment on column distributor_branches.territory_id is
  'The region this branch sits in — Bianca''s "Region", the level that has a '
  'Market Owner. Null until somebody says which, and a null is a question for an '
  'admin rather than a reason to hide the volume.';

create index distributor_branches_territory_idx
  on distributor_branches (territory_id);

-- ── The view learns the region ──────────────────────────────────────────────
--
-- DROPPED AND RECREATED, not replaced. CREATE OR REPLACE can only APPEND columns
-- to a view; asking it to insert region_id after rep_name is read as renaming
-- distributor_id, and it refuses. Nothing depends on this view, so dropping it is
-- free — but the grant goes with it and has to be reissued below.
--
-- AND security_invoker HAS TO BE RESTATED. It is not inherited by a recreated
-- view, and losing it means one org can read another's book. That has bitten this
-- codebase once already.

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
  -- THE EFFECTIVE REP, and it prefers the region.
  --
  -- Coalesced rather than switched outright, because on the day this ships not one
  -- branch has a region yet. A hard switch would blank every rep's number until
  -- somebody finished the mapping; this way today's behaviour is unchanged, and
  -- each branch that gets a region moves its own rows to the right person. The
  -- dashboard improves as the mapping is filled in instead of breaking until it is.
  coalesce(owner.id, d.owner_id),
  coalesce(
    (select coalesce(ou.full_name, ou.email) from users ou where ou.id = owner.user_id),
    coalesce(du.full_name, du.email)
  ),
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
-- The region's Market Owner. A region has one rep; lateral + limit 1 keeps the
-- view row-for-row with sell_through even if a territory ever gained a second.
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
  'its Market Owner, the distributor, its branch, and the dealer. rep_id prefers '
  'the region''s owner and falls back to the dealer''s, so attribution improves as '
  'branches are mapped rather than breaking until they all are. RLS is inherited '
  'from sell_through.';

grant select on sell_through_rows to authenticated;

-- ── What we already know about our own branches ─────────────────────────────
--
-- One branch, by name, and nothing inferred.
--
-- The tempting rule was "any Californian branch is SoCal", and it is wrong:
-- California is not one region. Stockton and Windsor are northern California and
-- have no business being credited to a southern-California rep, so a state-level
-- rule would have quietly put somebody's name on volume five hundred miles from
-- their patch. Riverside is named because Riverside is genuinely in Deon's area.
--
-- Everything else — Dallas, Memphis, Salt Lake, Detroit, Atlanta, Houston,
-- Nashville — sits outside every region GMX holds. They stay null, which is the
-- honest answer and exactly what Bianca offered to resolve.

update distributor_branches b
   set territory_id = 'b0000000-0000-0000-0000-000000000002'
 where b.territory_id is null
   and b.name = 'Riverside Branch'
   and exists (
     select 1 from territories t
      where t.id = 'b0000000-0000-0000-0000-000000000002'
        and t.org_id = b.org_id
   );
