-- The last straggler of the schema invariant (CI, 2026-09-04): the Google
-- second-handshake table shipped on 2026-09-01 with updated_at but without
-- the set_updated_at trigger — and the pgTAP schema suite has failed every
-- push since, one identical e-mail per commit. It conforms like every other
-- app-written table.

drop trigger if exists set_updated_at on google_connections;
create trigger set_updated_at
  before update on google_connections
  for each row execute function private.set_updated_at();
