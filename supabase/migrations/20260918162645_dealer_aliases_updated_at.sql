-- Every table carries updated_at and its trigger (tests/01_schema); the alias
-- table shipped without them. An alias can be corrected — pointed at another
-- account — and when that happened is part of whose word it is.
alter table dealer_aliases add column updated_at timestamptz not null default now();
create trigger set_updated_at
  before update on dealer_aliases
  for each row execute function private.set_updated_at();
