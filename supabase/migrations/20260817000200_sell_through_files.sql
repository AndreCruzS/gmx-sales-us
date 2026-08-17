-- Keep the file the distributor actually sent.
--
-- Every figure on every sales screen is derived from a spreadsheet that arrives by
-- email once a month, and until now nothing kept the spreadsheet. That is fine
-- right up to the first argument about a number, at which point the only way to
-- settle it is to ask Boise to send July again.
--
-- Three things the original buys that the derived rows cannot:
--   · the conversion is auditable. Pieces become linear feet through a length
--     parsed out of an item description, and source_quantity records the input —
--     but only the file proves what the input was.
--   · a mapping can be redone. If a column was pointed at the wrong field, the
--     month can be reloaded from the file rather than re-requested.
--   · a format change is diagnosable. When next year's export breaks the parser,
--     the failing file is the bug report.
--
-- Same shape as the buckets in migration 11: private, org-prefixed path, RLS that
-- matches the prefix. ADMIN ONLY, because loading a report is admin-only
-- everywhere else in this schema and a storage bucket is the one place a leak
-- would sit outside the database.

insert into storage.buckets (id, name, public)
values ('sell-through', 'sell-through', false)
on conflict (id) do nothing;

-- Path: {org_id}/{distributor_id}/{period}-{filename}
create policy storage_sell_through_rw on storage.objects
  for all to authenticated
  using (
    bucket_id = 'sell-through'
    and (select private.is_admin())
    and (storage.foldername(name))[1] = (select private.jwt_org_id())::text
  )
  with check (
    bucket_id = 'sell-through'
    and (select private.is_admin())
    and (storage.foldername(name))[1] = (select private.jwt_org_id())::text
  );

-- Where the original went, so a row can be traced back to it. Null for the months
-- loaded by paste, and for anything the seed creates — a fixture has no file.
alter table sell_through_uploads
  add column storage_path text;

comment on column sell_through_uploads.storage_path is
  'Object path in the sell-through bucket for the file this month came from. '
  'Null when the month was pasted rather than uploaded.';
