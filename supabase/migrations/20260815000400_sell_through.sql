-- Distributor sell-through: what the dealers actually bought.
--
-- The commercial model this serves, in the client's own words: GMX sells to a
-- DISTRIBUTOR (Boise Cascade, Hardwoods), the distributor's BRANCHES sell on to
-- DEALERS, and a rep owns an area where he builds the dealer relationships that
-- make the distributor's next order worth placing. So the number that says
-- whether a rep is working is not our quote book — it is the distributor's
-- sell-through in his patch.
--
-- That data does not originate here. Bianca or João upload a spreadsheet from
-- each distributor, and it is ALWAYS A MONTH BEHIND because that is when the
-- distributor sends it. Every screen that shows it has to say which month it is
-- for; a figure silently thirty days stale is how a decision gets made on the
-- wrong footing.
--
-- WHY BRANCHES ARE NOT ACCOUNTS. A distributor is an account — we sell to it. A
-- branch of that distributor is a location in THEIR network: we do not own it,
-- no rep is assigned to it, it has no territory of ours, and it should never
-- appear in a rep's account list. It arrives as a row in their file. So it is
-- reference data hanging off the distributor account, which also means adding
-- the whole of Boise's 39-branch network costs nothing in the rep's world.

-- ── Branches ────────────────────────────────────────────────────────────────

create table distributor_branches (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations (id),
  -- The distributor we sell to. Their branches roll up to it.
  distributor_id  uuid not null references accounts (id) on delete cascade,
  name            text not null,
  city            text,
  state           text,
  -- What the distributor calls this branch in their own file. The join key on
  -- upload, because names arrive spelled however their system spells them.
  external_code   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger set_updated_at
  before update on distributor_branches
  for each row execute function private.set_updated_at();

comment on table distributor_branches is
  'A location in a distributor''s own network. Reference data from their file — '
  'not an account, not owned by a rep, never in a rep''s list.';

create index distributor_branches_distributor_idx
  on distributor_branches (distributor_id);
create unique index distributor_branches_code_idx
  on distributor_branches (org_id, distributor_id, external_code)
  where external_code is not null;

alter table distributor_branches enable row level security;

-- Visible with the distributor it belongs to: if you may see the account, you
-- may see where its branches are.
create policy distributor_branches_select on distributor_branches
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(distributor_id))
  );

-- Only an admin maintains the branch list; it mirrors somebody else's network.
create policy distributor_branches_write on distributor_branches
  for all to authenticated
  using (org_id = (select private.jwt_org_id()) and (select private.is_admin()))
  with check (org_id = (select private.jwt_org_id()) and (select private.is_admin()));

-- ── Uploads ─────────────────────────────────────────────────────────────────
--
-- One row per file loaded, so a month can be reloaded without anybody guessing
-- whether the figures doubled. Rows point at their upload and the upload owns
-- them: replacing a month means deleting its upload.

create table sell_through_uploads (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations (id),
  distributor_id uuid not null references accounts (id) on delete cascade,
  -- First of the month the file covers, never the day it was sent.
  period         date not null,
  uploaded_by    uuid references memberships (id),
  uploaded_at    timestamptz not null default now(),
  filename       text,
  row_count      integer not null default 0,
  -- Rows whose dealer could not be matched to one of our accounts. Kept as a
  -- number on the upload so nobody has to wonder whether a quiet month means
  -- "no sales" or "we could not read the names".
  unmatched_count integer not null default 0,
  notes          text,
  -- updated_at on every table is this codebase's convention, not decoration:
  -- it is the LWW version key the offline layer syncs on (D61), and 01_schema
  -- holds every base table to it.
  updated_at     timestamptz not null default now()
);

create trigger set_updated_at
  before update on sell_through_uploads
  for each row execute function private.set_updated_at();

comment on table sell_through_uploads is
  'One row per distributor file loaded. A month is replaced by deleting its '
  'upload, so reloading can never double a figure.';

create unique index sell_through_uploads_period_idx
  on sell_through_uploads (org_id, distributor_id, period);

alter table sell_through_uploads enable row level security;

create policy sell_through_uploads_select on sell_through_uploads
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
  );

create policy sell_through_uploads_write on sell_through_uploads
  for all to authenticated
  using (org_id = (select private.jwt_org_id()) and (select private.is_admin()))
  with check (org_id = (select private.jwt_org_id()) and (select private.is_admin()));

-- ── The rows ────────────────────────────────────────────────────────────────

create table sell_through (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations (id),
  upload_id        uuid not null references sell_through_uploads (id) on delete cascade,
  branch_id        uuid not null references distributor_branches (id) on delete cascade,
  -- The dealer, as one of OUR accounts. Null is deliberate and important: a row
  -- whose dealer name did not match anything of ours is still loaded, so the
  -- volume is not silently lost and somebody can map it later.
  dealer_id        uuid references accounts (id) on delete set null,
  -- What the file called the dealer, kept verbatim. This is what an admin reads
  -- when deciding what an unmatched row should map to.
  dealer_label     text not null,
  period           date not null,
  product          text,
  quantity         numeric(14, 2) not null default 0,
  -- Linear feet is what the trade quotes in and what their files carry.
  unit             text not null default 'LF',
  -- Some distributors share price and some do not; a missing value is not zero.
  value            numeric(14, 2),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger set_updated_at
  before update on sell_through
  for each row execute function private.set_updated_at();

comment on table sell_through is
  'A distributor branch''s sales to a dealer in one month, from their own file. '
  'dealer_id is null when the name could not be matched — the volume is kept '
  'either way rather than dropped.';

create index sell_through_period_idx on sell_through (org_id, period desc);
create index sell_through_dealer_idx on sell_through (dealer_id);
create index sell_through_branch_idx on sell_through (branch_id);
create index sell_through_upload_idx on sell_through (upload_id);

alter table sell_through enable row level security;

-- A rep sees the rows for the dealers they own; a manager sees their chain; an
-- admin sees the org. Same fan-out as everything else, keyed on the DEALER —
-- because the dealer is the thing a rep is responsible for.
--
-- Unmatched rows (dealer_id null) are admin-only on purpose: nobody can be held
-- to a number whose owner is unknown, and they are a data-quality queue rather
-- than a result.
create policy sell_through_select on sell_through
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      (select private.is_admin())
      or (dealer_id is not null and (select private.can_see_account(dealer_id)))
    )
  );

create policy sell_through_write on sell_through
  for all to authenticated
  using (org_id = (select private.jwt_org_id()) and (select private.is_admin()))
  with check (org_id = (select private.jwt_org_id()) and (select private.is_admin()));

grant select, insert, update, delete on distributor_branches to authenticated;
grant select, insert, update, delete on sell_through_uploads to authenticated;
grant select, insert, update, delete on sell_through to authenticated;

-- ── The one view every drill path reads ─────────────────────────────────────
--
-- Rep → distributor → branch → dealer, and the same rows read the other two
-- ways round. One view, so the three tabs can never disagree about a month.

create view sell_through_rows (
  org_id, period,
  rep_id, rep_name,
  distributor_id, distributor_name,
  branch_id, branch_name, branch_city, branch_state,
  dealer_id, dealer_name, dealer_label,
  product, quantity, unit, value
) with (security_invoker = true) as
select
  st.org_id,
  st.period,
  d.owner_id,
  -- public.users, not auth.users: this view is security_invoker, so the join runs
  -- as the caller, and `authenticated` cannot read auth.users. Reaching into it
  -- makes the whole view raise "permission denied" for every real user while
  -- looking fine to a superuser. public.users is the mirror kept for exactly this.
  coalesce(du.full_name, du.email),
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
left join accounts d on d.id = st.dealer_id
left join memberships m on m.id = d.owner_id
left join users du on du.id = m.user_id;

comment on view sell_through_rows is
  'Sell-through with the whole chain attached: the rep who owns the dealer, the '
  'distributor, its branch, and the dealer. RLS is inherited from sell_through.';

grant select on sell_through_rows to authenticated;

-- The month the book is good to. Every screen showing sell-through labels
-- itself with this, because the data is always a month behind.
create view sell_through_latest_period
  with (security_invoker = true) as
select
  org_id,
  max(period) as period
from sell_through
group by org_id;

grant select on sell_through_latest_period to authenticated;
