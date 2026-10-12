-- A CONTACT CAN BELONG TO A BRANCH (Andre, 2026-10-12). The distributor
-- contact directories name the branch a person sits in; on the Distribution
-- lens that is the one thing a rep wants from a branch — who to call there.
-- Nullable: most contacts are a dealer's people, and a distributor's
-- corporate staff sit in no branch.

alter table public.contacts
  add column branch_id uuid references public.distributor_branches (id) on delete set null;

create index contacts_branch_idx on public.contacts (org_id, branch_id) where branch_id is not null;

comment on column public.contacts.branch_id is
  'The distributor branch this person sits in, when known. Null for dealer contacts and corporate staff.';
