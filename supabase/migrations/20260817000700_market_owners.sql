-- The three Market Owners the client's map actually names.
--
-- Their map has a Market Owner column and ten regions in it. Three carry a name
-- and seven read TBD, and this file records exactly that: three owners, seven
-- regions left unowned. A TBD is a decision the client has not made yet, not a
-- blank for me to fill in — and it is load-bearing, because after
-- 20260817000600 an unowned region attributes its volume to nobody, which is how
-- 36,718 LF of Texas, Southeast, Mountain and Midwest stopped landing on a rep
-- in southern California.
--
--   Northern California   Jason
--   Southern California   Deonn Deford
--   Northeast             Anthony Peca
--   the other seven       TBD
--
-- TWO THINGS HERE ARE INFERRED, and both are one UPDATE away from being fixed if
-- I have them wrong. Neither can misattribute anybody's volume.
--
-- 1. THE EMAIL ADDRESSES. The map gives people, not logins, and this schema says
--    a Market Owner IS a user — memberships.user_id references users, which
--    references auth.users. So Jason and Anthony need accounts. Every one of the
--    five existing users is firstname@gmxgroup.com, so that is the convention
--    followed. If either address is wrong, correcting it is an update to one
--    column and changes nothing about who owns what.
--
-- 2. THAT "Deon Rep" IS Deonn Deford. Southern California is the region he
--    already holds in this system and the map names him for it; "Deon" was my
--    own truncation in the original seed. So this renames the existing user
--    rather than creating a second person and moving 46,436 LF onto them.
--
-- NOBODY GETS A WORKING PASSWORD. These two are being created because the client
-- named them as owners, not because anybody asked for logins, and inventing
-- credentials for a real named person is not mine to do. The password column
-- gets a value nothing can match, so the account exists and owns its region and
-- the first real login goes through a password reset. Note this is the LIVE
-- project's data — the local seed's password123 is a development convenience and
-- has no business here.

-- ── The two people the system did not have ──────────────────────────────────
--
-- Guarded on the org, like every other reference-data migration in this repo:
-- these run against an EMPTY database locally, before seed.sql exists to create
-- the org. The seed carries the same rows so local and production agree.

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, email_change, email_change_token_new, recovery_token)
select
  '00000000-0000-0000-0000-000000000000',
  p.id,
  'authenticated', 'authenticated',
  p.email,
  -- Deliberately unmatchable. A bcrypt hash of a value nobody will ever see, so
  -- there is no shared secret and no password to leak.
  extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  jsonb_build_object('full_name', p.full_name),
  now(), now(), '', '', '', ''
from (values
  ('a0000000-0000-0000-0000-000000000010'::uuid, 'jason@gmxgroup.com',  'Jason'),
  ('a0000000-0000-0000-0000-000000000011'::uuid, 'anthony@gmxgroup.com', 'Anthony Peca')
) as p(id, email, full_name)
where exists (
  select 1 from organizations where id = '11111111-1111-1111-1111-111111111111'
)
and not exists (select 1 from auth.users u where u.email = p.email)
on conflict (id) do nothing;

-- The on_auth_user_created trigger mirrors those into public.users. Belt and
-- braces in case the trigger is ever dropped, and it is also what fixes the
-- full_name if a row somehow predates this.
insert into public.users (id, email, full_name)
select p.id, p.email, p.full_name
from (values
  ('a0000000-0000-0000-0000-000000000010'::uuid, 'jason@gmxgroup.com',  'Jason'),
  ('a0000000-0000-0000-0000-000000000011'::uuid, 'anthony@gmxgroup.com', 'Anthony Peca')
) as p(id, email, full_name)
where exists (select 1 from auth.users u where u.id = p.id)
on conflict (id) do update set full_name = excluded.full_name;

-- ── The name the client uses ─────────────────────────────────────────────────
--
-- Both places, so a re-mirror of the auth row cannot quietly put my truncation
-- back.

update public.users
   set full_name = 'Deonn Deford'
 where id = 'a0000000-0000-0000-0000-000000000004'
   and full_name = 'Deon Rep';

update auth.users
   set raw_user_meta_data =
         coalesce(raw_user_meta_data, '{}'::jsonb) || '{"full_name":"Deonn Deford"}'::jsonb
 where id = 'a0000000-0000-0000-0000-000000000004'
   and raw_user_meta_data ->> 'full_name' = 'Deon Rep';

-- ── Northeast changes hands ─────────────────────────────────────────────────
--
-- TJ Rep held it, and TJ is a name out of my own development seed. The client
-- says the Northeast is Anthony Peca's, so it is.
--
-- TJ IS DETACHED, NOT DELETED. His membership is what Buffalo Lumber Co's
-- owner_id points at; deleting it to correct a region would take an account's
-- owner with it. He becomes a rep with no region, which is the honest record of
-- what just happened rather than a tidier fiction.
--
-- It also has to happen BEFORE Anthony is attached: sell_through_rows picks a
-- region's rep with `order by created_at limit 1`, so leaving both on the
-- Northeast would keep every Northeast figure on TJ and this migration would
-- look applied while changing nothing.

update memberships
   set territory_id = null
 where id = 'c0000000-0000-0000-0000-000000000003'
   and territory_id = 'b0000000-0000-0000-0000-000000000001';

-- ── The memberships that make them Market Owners ────────────────────────────
--
-- Under João, matching how the two existing reps are wired, so the manager view
-- keeps working without a special case.

insert into memberships (id, org_id, user_id, role, territory_id, manager_id)
select
  m.id, '11111111-1111-1111-1111-111111111111', m.user_id, 'rep', m.territory_id,
  -- Only if João is actually there; a missing manager is a null, not a failure.
  (select id from memberships
    where id = 'c0000000-0000-0000-0000-000000000002'
      and org_id = '11111111-1111-1111-1111-111111111111')
from (values
  -- Jason takes Northern California — Stockton and Windsor, the half of the
  -- state the state table refuses to guess at.
  ('c0000000-0000-0000-0000-000000000010'::uuid,
   'a0000000-0000-0000-0000-000000000010'::uuid,
   'b0000000-0000-0000-0000-000000000011'::uuid),
  ('c0000000-0000-0000-0000-000000000011'::uuid,
   'a0000000-0000-0000-0000-000000000011'::uuid,
   'b0000000-0000-0000-0000-000000000001'::uuid)
) as m(id, user_id, territory_id)
where exists (select 1 from public.users u where u.id = m.user_id)
  and exists (
    select 1 from territories t
     where t.id = m.territory_id
       and t.org_id = '11111111-1111-1111-1111-111111111111'
  )
on conflict (org_id, user_id) do update set territory_id = excluded.territory_id;
