-- Phase 1 · migration 11: Storage buckets + RLS (D14, D21, D38, D42).
-- Storage is a leak vector OUTSIDE the database — org-prefixed paths with
-- matching policies, served via signed URLs only.
--
-- Buckets:
--   voice — {org_id}/{user_id}/{capture_id}   (spec §4a; rep-private)
--   cards — {org_id}/cards/...                (D42; org members)
--   email — {org_id}/email/...                (D38; SERVICE-ROLE ONLY — no
--           client policies at all; bodies/attachments reach clients only
--           through signed URLs minted server-side)

insert into storage.buckets (id, name, public)
values
  ('voice', 'voice', false),
  ('cards', 'cards', false),
  ('email', 'email', false)
on conflict (id) do nothing;

-- voice: the capturing rep's own path only — org prefix AND user prefix.
create policy storage_voice_rw on storage.objects
  for all to authenticated
  using (
    bucket_id = 'voice'
    and (select private.is_active_member())
    and (storage.foldername(name))[1] = (select private.jwt_org_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'voice'
    and (select private.is_active_member())
    and (storage.foldername(name))[1] = (select private.jwt_org_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- cards: any active member of the org, inside the org prefix.
create policy storage_cards_rw on storage.objects
  for all to authenticated
  using (
    bucket_id = 'cards'
    and (select private.is_active_member())
    and (storage.foldername(name))[1] = (select private.jwt_org_id())::text
  )
  with check (
    bucket_id = 'cards'
    and (select private.is_active_member())
    and (storage.foldername(name))[1] = (select private.jwt_org_id())::text
  );

-- email: deliberately NO policies — default-deny for all client roles.
