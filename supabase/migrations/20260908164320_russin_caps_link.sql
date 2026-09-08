-- RUSSIN, THE ONE IN CAPITALS (meeting with Bianca, 2026-09-08): the order
-- system holds TWO customers for the same house — "Russin" and "RUSSIN" —
-- and the whole invoiced history sits under the capitals one, which the
-- seed never linked. So Russin vanished from "Sold to, but no sell-through
-- return on file" while owing exactly that return. Every RUSSIN* customer
-- now points at the Russin account. Guarded: a fresh local reset has no
-- mirror rows and this is a clean no-op.
insert into order_customer_links (customer_id, account_id)
select c.id, 'd0000000-0000-0000-0000-000000000007'::uuid
from order_customers_mirror c
where upper(c.name) like 'RUSSIN%'
  and exists (select 1 from accounts a
              where a.id = 'd0000000-0000-0000-0000-000000000007'::uuid)
on conflict (customer_id) do nothing;
