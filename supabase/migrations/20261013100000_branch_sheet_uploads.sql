-- BRANCH SHEETS (Andre, 2026-10-13; spec 2026-10-13-branch-sheet-sell-through).
--
-- Boise's monthly file names no customer, but Riverside now sends its own
-- sheet for the same month WITH customers, and other branches may follow.
-- A branch sheet is an upload for ONE branch: it replaces that branch inside
-- the month and leaves the rest as the house's file said. Rows keep reading
-- `detail` from their own upload, so a Riverside row says dealer while a
-- Dallas row from the house's file says branch — the blind unit is now the
-- branch and month, not the house.

alter table public.sell_through_uploads
  add column branch_id uuid references public.distributor_branches (id) on delete cascade;
comment on column public.sell_through_uploads.branch_id is
  'Null: the file was the whole house. Set: one branch''s own sheet, loaded for that branch only.';

-- A branch sheet exists to bring dealer detail. One without dealers is the
-- house's file and loads as such.
alter table public.sell_through_uploads
  add constraint branch_sheet_has_dealers
  check (branch_id is null or detail = 'dealer');

-- One whole-house upload per month, plus at most one sheet per branch.
drop index if exists public.sell_through_uploads_period_idx;
create unique index sell_through_uploads_period_branch_idx
  on public.sell_through_uploads (org_id, distributor_id, period,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
