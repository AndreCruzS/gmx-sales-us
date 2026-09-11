-- THE DISTRIBUTOR'S OWN COUNTER, NAMED (Andre, 2026-09-11).
--
-- Every house writes lines that are not a dealer buying: samples, the cash
-- counter, showroom displays, a staff account, its own internal division. They
-- arrive looking exactly like a customer — "SAMPLG1 - HARDWOODS SP USLP -
-- SAMPLES" sits in the customer column beside Ganahl — and today they are
-- counted as dealers with no account, which inflates "who is buying" with the
-- distributor's own warehouse.
--
-- 11,920 LF of the book is this. It IS real volume and Andre's ruling is to
-- keep counting it; what was missing is a way to tell it apart.
--
-- WHY A TABLE AND NOT A COLUMN. A flag stamped on each row at load time goes
-- stale the moment somebody realises a label was miscategorised, and fixing it
-- means a backfill nobody remembers to run. This is reference data about a
-- LABEL, not about a line: state it once, and every row past and future reads
-- the same answer. The view derives the flag, so a correction here corrects
-- five months of history in one statement.
--
-- WHY NOT A REGEX IN CODE. "CASH" is inside "CASH & CARRY", a real dealer
-- banner in the Northeast, and "SAMPLE" would one day meet a company called
-- Sample & Sons. A rule that guesses at the wrong moment silently moves the
-- company's sales figures. A list is boring, auditable, and wrong only where
-- somebody put a wrong row in it.

create table distributor_house_accounts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations (id),
  -- The house whose file this label belongs to. The same string can mean
  -- different things to two distributors, so the pair is the key.
  distributor_id uuid not null references accounts (id) on delete cascade,
  -- Exactly as the file writes it, because that is what the loader compares.
  dealer_label   text not null,
  kind           text not null check (kind in ('SAMPLES','CASH','DISPLAY','STAFF','INTERNAL')),
  -- Why somebody decided this, in their own words. Same paper-proves /
  -- person-confirms habit the rest of the schema keeps.
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger set_updated_at
  before update on distributor_house_accounts
  for each row execute function private.set_updated_at();

comment on table distributor_house_accounts is
  'Labels in a distributor''s file that are the distributor''s own counter — '
  'samples, cash sales, displays, staff, internal divisions — not a dealer. '
  'The volume still counts; this is what lets a screen say whose it is.';

create unique index distributor_house_accounts_key_idx
  on distributor_house_accounts (org_id, distributor_id, dealer_label);

alter table distributor_house_accounts enable row level security;

-- Readable by any active member: the flag has to reach every screen that reads
-- sell-through, and it carries no figure of its own.
create policy distributor_house_accounts_select on distributor_house_accounts
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
  );

create policy distributor_house_accounts_write on distributor_house_accounts
  for all to authenticated
  using (org_id = (select private.jwt_org_id()) and (select private.is_admin()))
  with check (org_id = (select private.jwt_org_id()) and (select private.is_admin()));
