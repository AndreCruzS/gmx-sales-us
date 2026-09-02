-- The order book, synced in (Andre, 2026-09-02): the order-system project
-- holds GMX's own sales — POs from the very distributors this system tracks
-- (Boise Cascade BMD, Capital Lumber SLC, Hardwoods USLP, Russin…). That is
-- the SELL-IN half of the funnel; the sell-through book is the SELL-OUT
-- half. This migration gives the desk both.
--
-- Architecture: postgres_fdw foreign tables (schema ext_orders_fdw, server
-- orders_srv — provisioned OUT-OF-BAND, because a user mapping carries a
-- password and a migration lives in git) → LOCAL MIRROR tables refreshed by
-- pg_cron every 5 minutes. The app reads the mirror like any table: fast,
-- RLS-scoped, and standing even when the other project is not.
--
-- Out-of-band provisioning, for the record (run once, by hand, in prod):
--   · orders project: role gmx_sales_reader (login, select-only) + explicit
--     RLS read policies on gmx_orders / customers / customer_contacts
--   · sales project:  create extension postgres_fdw; create server
--     orders_srv (host db.<orders-ref>.supabase.co); create user mapping
--     for postgres (the reader role + its password); import foreign schema
--     into ext_orders_fdw
--
-- Everything here is guarded so a local `db reset` (no FDW, maybe no cron)
-- is a clean no-op: the mirror exists empty, the sync function returns
-- early, the schedule is skipped.

-- ── The mirrors ─────────────────────────────────────────────────────────────
create table if not exists order_customers_mirror (
  id uuid primary key,
  org_id uuid not null default '11111111-1111-1111-1111-111111111111'
    references organizations(id),
  account_number text,
  name text not null,
  updated_at timestamptz,
  synced_at timestamptz not null default now()
);

create table if not exists orders_mirror (
  id uuid primary key,
  org_id uuid not null default '11111111-1111-1111-1111-111111111111'
    references organizations(id),
  order_number text not null,
  customer_id uuid,
  customer_name text not null,
  status text not null,
  order_type text,
  priority text,
  -- the item list, exactly as the order system holds it:
  -- [{sku, description, quantity, uom, unit_price?, total_amount?}, …]
  items jsonb,
  total_value numeric,
  po_number text,
  buyer_name text,
  order_date_po date,
  estimated_delivery date,
  delivered_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists orders_mirror_customer_idx on orders_mirror (customer_id);
create index if not exists orders_mirror_status_idx on orders_mirror (status);

-- ── Who is who: order customer → sales account ──────────────────────────────
-- The same philosophy as the hierarchy: link the day you know. An admin can
-- add or correct rows; the seed below links the ones whose names already
-- speak for themselves.
create table if not exists order_customer_links (
  customer_id uuid primary key,
  org_id uuid not null default '11111111-1111-1111-1111-111111111111'
    references organizations(id),
  account_id uuid not null references accounts(id),
  created_at timestamptz not null default now()
);

alter table orders_mirror enable row level security;
alter table order_customers_mirror enable row level security;
alter table order_customer_links enable row level security;

create policy orders_mirror_select on orders_mirror
  for select to authenticated
  using (org_id = (select private.jwt_org_id())
         and (select private.is_active_member()));
create policy order_customers_mirror_select on order_customers_mirror
  for select to authenticated
  using (org_id = (select private.jwt_org_id())
         and (select private.is_active_member()));
create policy order_customer_links_select on order_customer_links
  for select to authenticated
  using (org_id = (select private.jwt_org_id())
         and (select private.is_active_member()));
-- Linking is admin work, like loading the sell-through.
create policy order_customer_links_write on order_customer_links
  for insert to authenticated
  with check (org_id = (select private.jwt_org_id())
              and (select private.is_admin()));
create policy order_customer_links_delete on order_customer_links
  for delete to authenticated
  using (org_id = (select private.jwt_org_id())
         and (select private.is_admin()));

grant select on orders_mirror, order_customers_mirror, order_customer_links
  to authenticated;
grant insert, delete on order_customer_links to authenticated;

-- ── The sync ────────────────────────────────────────────────────────────────
-- Full upsert + prune each pass: the book is a few hundred rows, and simple-
-- and-correct beats incremental at this size. Early return when the FDW leg
-- does not exist (every local environment).
create or replace function private.sync_orders_mirror()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regclass('ext_orders_fdw.gmx_orders') is null then
    return;
  end if;

  insert into public.order_customers_mirror
    (id, account_number, name, updated_at, synced_at)
  select id, account_number, name, updated_at, now()
  from ext_orders_fdw.customers
  on conflict (id) do update set
    account_number = excluded.account_number,
    name = excluded.name,
    updated_at = excluded.updated_at,
    synced_at = excluded.synced_at;
  delete from public.order_customers_mirror m
   where not exists (select 1 from ext_orders_fdw.customers o where o.id = m.id);

  insert into public.orders_mirror
    (id, order_number, customer_id, customer_name, status, order_type,
     priority, items, total_value, po_number, buyer_name, order_date_po,
     estimated_delivery, delivered_at, created_at, updated_at, archived_at,
     synced_at)
  select id, order_number, customer_id, customer_name, status, order_type,
         priority, items, total_value, po_number, buyer_name, order_date_po,
         estimated_delivery, delivered_at, created_at, updated_at, archived_at,
         now()
  from ext_orders_fdw.gmx_orders
  on conflict (id) do update set
    order_number = excluded.order_number,
    customer_id = excluded.customer_id,
    customer_name = excluded.customer_name,
    status = excluded.status,
    order_type = excluded.order_type,
    priority = excluded.priority,
    items = excluded.items,
    total_value = excluded.total_value,
    po_number = excluded.po_number,
    buyer_name = excluded.buyer_name,
    order_date_po = excluded.order_date_po,
    estimated_delivery = excluded.estimated_delivery,
    delivered_at = excluded.delivered_at,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    archived_at = excluded.archived_at,
    synced_at = excluded.synced_at;
  delete from public.orders_mirror m
   where not exists (select 1 from ext_orders_fdw.gmx_orders o where o.id = m.id);
end
$$;

-- Every 5 minutes, where cron exists (production; local dev has no job).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'sync-orders-mirror', '*/5 * * * *',
      'select private.sync_orders_mirror()');
  end if;
end $$;

-- First pass now, then the seed links for the customers whose names already
-- name our accounts. Guarded by the FDW check inside the function, so all of
-- this no-ops locally.
select private.sync_orders_mirror();

insert into order_customer_links (customer_id, account_id)
select c.id, m.account_id
from order_customers_mirror c
join (values
  ('BOISE CASCADE%',        'd0000000-0000-0000-0000-000000000005'::uuid),
  ('CAPITAL LUMBER%',       'd0000000-0000-0000-0000-000000000009'::uuid),
  ('HARDWOODS USLP%',       'd0000000-0000-0000-0000-000000000006'::uuid),
  ('RUSSIN%',               'd0000000-0000-0000-0000-000000000007'::uuid)
) as m(pattern, account_id) on upper(c.name) like m.pattern
on conflict (customer_id) do nothing;
