-- A quote is a SURVEY, not a price list.
--
-- The client's quote (2026-08-31, Andre): the rep walks the counter and lists
-- WHAT and HOW MUCH — thermo first — and the system answers the only figure
-- that matters downstream: linear feet. No price anywhere in the flow, by
-- design: the catalog view carries no price column, and the priced quote is
-- produced inside Spruce. What is ours is the survey itself.
--
-- Products stay EXTERNAL (the standing rule: no products table here — the
-- catalog is public.sales_catalog_view on the connector project, read through
-- a server-side route). Each line copies the identity it needs — sku,
-- description, lf_per_piece — because a survey must still read true in a year
-- even if the catalog reshapes; a quote line is a record of what was asked
-- for, not a live join.

create table quote_items (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations (id),
  -- The deal this survey belongs to (stage QUOTE at birth, but the items stay
  -- through the walk to WON — they are what the quote was FOR).
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  -- Denormalised on purpose: RLS keys on the account (see below), and the
  -- account is a fact about the line the day it was written.
  account_id     uuid not null references accounts (id),
  sku            text not null,
  description    text not null,
  species        text,
  profile        text,
  nominal_size   text,
  /** The catalog's own conversion at the time of the survey. */
  lf_per_piece   numeric(10, 2),
  -- What the rep TYPED, kept verbatim beside the answer — the same
  -- source/converted pairing sell_through uses, for the same reason: a
  -- conversion you cannot check is a number you cannot trust.
  qty_input      numeric(14, 2) not null check (qty_input > 0),
  input_uom      text not null check (input_uom in ('LF', 'PC')),
  lf             numeric(14, 2) not null check (lf >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references memberships (id)
);

create trigger set_updated_at
  before update on quote_items
  for each row execute function private.set_updated_at();

comment on table quote_items is
  'The lines of a quote survey: which product, how much, and the LF it comes '
  'to. No price by design — pricing happens in Spruce. Product identity is '
  'copied from the external catalog at write time, never joined live.';

create index quote_items_opportunity_idx on quote_items (opportunity_id);
create index quote_items_org_idx on quote_items (org_id);

alter table quote_items enable row level security;

-- Visibility follows the account, exactly like the rollout gates: a quote
-- line is a fact about a door, so whoever may see the door may see it.
create policy quote_items_select on quote_items
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_id))
  );

create policy quote_items_insert on quote_items
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_id))
  );

create policy quote_items_update on quote_items
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_id))
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_id))
  );

create policy quote_items_delete on quote_items
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (select private.can_see_account(account_id))
  );

grant select, insert, update, delete on quote_items to authenticated;
