-- The schema invariant catches up with the orders sync (CI, 2026-09-04):
-- every table carries a trigger-maintained updated_at (D61's LWW key), and
-- the sync's three tables broke it in two different ways.
--
-- order_customer_links is a NORMAL local table and simply conforms: it gains
-- updated_at and the standard trigger, like everything else an admin writes.
--
-- The two MIRRORS do not conform, DELIBERATELY: their updated_at is the
-- ORDER SYSTEM's own timestamp, copied by the sync — it is the source's LWW
-- key, and a local set_updated_at trigger would overwrite it on every
-- five-minute upsert, destroying the one honest "when did this order really
-- change" the bridge carries. They are excluded by name in 01_schema.test.sql
-- with the same reasoning.

alter table order_customer_links
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_updated_at on order_customer_links;
create trigger set_updated_at
  before update on order_customer_links
  for each row execute function private.set_updated_at();
