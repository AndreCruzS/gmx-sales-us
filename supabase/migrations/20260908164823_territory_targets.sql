-- THE GOAL, NOT THE PERCENT (Bianca, 2026-09-08): "625% parece muita coisa
-- — só que 625% pra cima de nada... o dado decepciona. Eu prefiro operar
-- por meta." A monthly LF goal per REGION (her pick over per-distributor:
-- the same dealer buying through Boise or Hardwoods changes nothing), set
-- by admins and read wherever a movement percent used to stand alone.
-- Recurrence against the goal is what "going well" means — her words:
-- "meta e recorrência, é isso que define que está indo bem".
create table territory_targets (
  org_id uuid not null references organizations(id),
  territory_id uuid not null references territories(id),
  monthly_lf numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, territory_id)
);

create trigger set_updated_at
  before update on territory_targets
  for each row execute function private.set_updated_at();

alter table territory_targets enable row level security;
create policy territory_targets_read on territory_targets
  for select to authenticated
  using (org_id = (select private.jwt_org_id())
         and (select private.is_active_member()));
create policy territory_targets_write on territory_targets
  for all to authenticated
  using (org_id = (select private.jwt_org_id())
         and (select private.is_admin()))
  with check (org_id = (select private.jwt_org_id())
              and (select private.is_admin()));
grant select, insert, update, delete on territory_targets to authenticated;
