-- THE EVIDENCE (Andre, 2026-09-04): a branch that shows in a monthly
-- sell-through return with LF on it PROVABLY had material — nobody sells
-- what is not on the floor. One row per dealer account per reported month,
-- for the Material gate to cite. It never writes the gate: past sales
-- prove the past, not today's floor, so the yes/no stays a person's word —
-- the same split as PURCHASES_FROM: the paper proves, the system cites,
-- nobody pretends to know more than the paper says.
create view public.account_material_evidence
with (security_invoker = true) as
select
  s.dealer_id as account_id,
  s.period,
  sum(s.quantity)::numeric as lf
from public.sell_through_rows s
where s.dealer_id is not null
  and coalesce(s.period_kind, 'MONTH') = 'MONTH'
  and s.quantity > 0
group by s.dealer_id, s.period;
