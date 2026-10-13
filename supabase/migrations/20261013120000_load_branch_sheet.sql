-- LOADING A BRANCH SHEET IS ONE TRANSACTION (review, 2026-10-13).
--
-- The loader used to do it in five requests: drop the previous sheet, drop
-- the house file's rows for that branch, rewrite its row_count, insert the
-- new upload, insert the rows. A failure after the first two left the
-- branch silently EMPTY for the month — a false zero on the map, in the
-- branch totals and in "no dealer detail" — with nothing on the screen to
-- say the month had been altered. Now the whole replacement is one function
-- call: it all lands, or none of it does. The file goes to storage BEFORE
-- the call, so the worst case is an orphan file, never a missing month.
--
-- security invoker: RLS still decides — only an admin of the org can run
-- it to any effect (sell_through_write / sell_through_uploads_write).

create or replace function public.load_branch_sheet(p_upload jsonb, p_rows jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org    uuid := (p_upload->>'org_id')::uuid;
  v_dist   uuid := (p_upload->>'distributor_id')::uuid;
  v_period date := (p_upload->>'period')::date;
  v_kind   sell_period_kind := coalesce((p_upload->>'period_kind')::sell_period_kind, 'MONTH');
  v_branch uuid := (p_upload->>'branch_id')::uuid;
  v_whole  uuid;
  v_id     uuid;
begin
  if v_branch is null then
    raise exception 'load_branch_sheet: branch_id is required';
  end if;

  -- The branch's previous sheet for the month goes, rows and all.
  delete from sell_through_uploads
   where org_id = v_org and distributor_id = v_dist and period = v_period
     and period_kind = v_kind and branch_id = v_branch;

  -- The house's own file loses only this branch's rows; the upload, its
  -- file in storage and its other branches stay.
  select id into v_whole from sell_through_uploads
   where org_id = v_org and distributor_id = v_dist and period = v_period
     and period_kind = v_kind and branch_id is null;
  if v_whole is not null then
    delete from sell_through where upload_id = v_whole and branch_id = v_branch;
    update sell_through_uploads
       set row_count = (select count(*) from sell_through where upload_id = v_whole)
     where id = v_whole;
  end if;

  insert into sell_through_uploads
    (org_id, distributor_id, period, period_kind, uploaded_by, filename, storage_path,
     row_count, unmatched_count, detail, branch_id)
  values
    (v_org, v_dist, v_period, v_kind,
     (p_upload->>'uploaded_by')::uuid, p_upload->>'filename', p_upload->>'storage_path',
     jsonb_array_length(p_rows), coalesce((p_upload->>'unmatched_count')::int, 0),
     'dealer', v_branch)
  returning id into v_id;

  insert into sell_through
    (org_id, upload_id, branch_id, dealer_id, dealer_label, period, product,
     quantity, ly_quantity, unit, source_quantity, source_unit, value)
  select v_org, v_id, (r->>'branch_id')::uuid, (r->>'dealer_id')::uuid, r->>'dealer_label',
         v_period, r->>'product', (r->>'quantity')::numeric, (r->>'ly_quantity')::numeric,
         'LF', (r->>'source_quantity')::numeric, r->>'source_unit', (r->>'value')::numeric
    from jsonb_array_elements(p_rows) r;

  return v_id;
end;
$$;

grant execute on function public.load_branch_sheet(jsonb, jsonb) to authenticated;

-- THE MONTH INDEX KNOWS THE KIND OF FILE (review, 2026-10-13). The loader
-- has always let a June month and a YTD-through-June coexist (both are
-- stored as June 1st); the index never did, and said so only as a raw
-- duplicate-key error.
drop index if exists public.sell_through_uploads_period_branch_idx;
create unique index sell_through_uploads_period_branch_idx
  on public.sell_through_uploads (org_id, distributor_id, period, period_kind,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
