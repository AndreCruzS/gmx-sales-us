-- DEALER ALIASES — "every time if X, then Y" (Bianca, 2026-09-18).
--
-- The same dealer arrives from each house under its own spelling: Boise writes
-- "DGLUGCH - DG LUMBER GROUP INC", Hardwoods "DGL8844 - DG LUMBER GROUP, INC.",
-- and Hardwoods sends Builders FirstSource's yards as "BMC". The loader matches a
-- label when every word of OUR name sits inside theirs, which cannot see through
-- an abbreviation or a trading name ("LABL HOLDINGS" is Beyond Lumber). Until
-- now each such link was a one-off migration (Valencia, 2026-09-10) that fixed
-- the rows already stored and said nothing about next month's file.
--
-- This is that word kept: a label, verbatim as the distributor writes it, and
-- the account it means. It is written only by an admin, from answers a person
-- gave — the matching spreadsheet Bianca validates — never from a guess.
--
-- It acts in the DATABASE, not in the upload screen, so every path that writes
-- sell_through obeys it:
--   * a row inserted with no dealer takes the alias's account (before insert);
--   * an alias added later links the rows already stored under that label.
-- Neither ever overrides a dealer already set: an alias fills a gap, it does
-- not overrule a match.
--
-- The key folds case and spacing only. Codes are kept ("DGLUGCH - …") because
-- they are the distributor's own customer number and the most stable part of
-- the label; two yards of one banner differ exactly there.

create table dealer_aliases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  -- What the distributor's file says, verbatim, for a person to read.
  label text not null check (length(btrim(label)) > 0),
  -- The same, folded — what a row is matched on.
  label_key text generated always as
    (lower(btrim(regexp_replace(label, '\s+', ' ', 'g')))) stored,
  dealer_id uuid not null references accounts(id) on delete cascade,
  -- Whose word it is and when: "Bianca, matching sheet 2026-09-18, row 1".
  note text,
  created_by uuid references memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, label_key)
);

create index dealer_aliases_dealer_idx on dealer_aliases (dealer_id);

alter table dealer_aliases enable row level security;
create policy dealer_aliases_read on dealer_aliases
  for select to authenticated
  using (org_id = (select private.jwt_org_id())
         and (select private.is_active_member()));
create policy dealer_aliases_write on dealer_aliases
  for all to authenticated
  using (org_id = (select private.jwt_org_id())
         and (select private.is_admin()))
  with check (org_id = (select private.jwt_org_id())
              and (select private.is_admin())
              -- the account it points at must be one of this org's own
              and exists (select 1 from accounts a
                          where a.id = dealer_id and a.org_id = dealer_aliases.org_id));
grant select, insert, update, delete on dealer_aliases to authenticated;

-- A new row with no dealer: does an alias know this label?
-- SECURITY DEFINER so the lookup does not depend on the writer's read policy;
-- it is confined to the row's own org.
create or replace function private.sell_through_apply_alias()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.dealer_id is null then
    select a.dealer_id into new.dealer_id
    from public.dealer_aliases a
    where a.org_id = new.org_id
      and a.label_key = lower(btrim(regexp_replace(new.dealer_label, '\s+', ' ', 'g')));
  end if;
  return new;
end;
$$;

create trigger sell_through_apply_alias
  before insert on sell_through
  for each row execute function private.sell_through_apply_alias();

-- A new alias: link what is already stored under that label.
create or replace function private.dealer_alias_backfill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  with linked as (
    update public.sell_through s
    set dealer_id = new.dealer_id
    where s.org_id = new.org_id
      and s.dealer_id is null
      and lower(btrim(regexp_replace(s.dealer_label, '\s+', ' ', 'g'))) = new.label_key
    returning s.org_id, s.dealer_id, s.branch_id
  )
  -- The rows now prove a purchase, exactly as a fresh insert would have
  -- (sell_through_links_purchases fires on INSERT only, and this is an update).
  insert into public.account_relationships
    (org_id, account_a_id, relationship_type, account_b_id, notes, last_confirmed_at)
  select distinct l.org_id, l.dealer_id, 'PURCHASES_FROM'::public.relationship_type,
         b.distributor_id, 'Proven by a sell-through file (via a dealer alias)', now()
  from linked l
  join public.distributor_branches b on b.id = l.branch_id
  where l.dealer_id <> b.distributor_id
  on conflict (org_id, account_a_id, relationship_type, account_b_id)
    do update set last_confirmed_at = excluded.last_confirmed_at;
  return new;
end;
$$;

create trigger dealer_alias_backfill
  after insert or update of label, dealer_id on dealer_aliases
  for each row execute function private.dealer_alias_backfill();
