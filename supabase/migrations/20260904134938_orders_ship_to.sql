-- WHERE THE ORDER WENT (Andre, 2026-09-04): the buy-in should answer the
-- region lens like everything else on the desk. The order system has always
-- known the destination — gmx_orders.ship_to_address carries a structured
-- {street, city, state, zip_code} — the mirror just never brought it over.
-- Now it does: the state (plus city and the house's branch tag), so a
-- ship-to state can meet the Master Territory Map and the buy-in can be
-- read region by region. Nationwide stays the sum; an order whose state no
-- territory covers belongs to no region and only the nationwide read sees it.

alter table orders_mirror
  add column if not exists ship_to_state text,
  add column if not exists ship_to_city text,
  add column if not exists customer_branch text;

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
     ship_to_state, ship_to_city, customer_branch, synced_at)
  select id, order_number, customer_id, customer_name, status, order_type,
         priority, items, total_value, po_number, buyer_name, order_date_po,
         estimated_delivery, delivered_at, created_at, updated_at, archived_at,
         nullif(upper(trim(ship_to_address->>'state')), ''),
         nullif(trim(ship_to_address->>'city'), ''),
         nullif(trim(customer_branch), ''),
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
    ship_to_state = excluded.ship_to_state,
    ship_to_city = excluded.ship_to_city,
    customer_branch = excluded.customer_branch,
    synced_at = excluded.synced_at;
  delete from public.orders_mirror m
   where not exists (select 1 from ext_orders_fdw.gmx_orders o where o.id = m.id);
end
$$;

-- Backfill the whole book now rather than waiting for the next cron pass.
select private.sync_orders_mirror();
