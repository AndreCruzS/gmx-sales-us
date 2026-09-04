-- ADMINS PLACE ACCOUNTS BEFORE THE MAP DOES (Andre, 2026-09-04): "precisamos
-- liberar que os admins criem dealers ou distributors sem que tenham
-- território atribuído — eles são admins". territory_id loses its NOT NULL:
-- an account can exist before anyone knows whose patch it is. Visibility
-- still stands — can_see_account ORs the owner with the territory, so the
-- creator's chain sees it — and both views that join territories already
-- join LEFT. Unplaced is a state this system already speaks (a branch off
-- the map, a dealer label unmatched); it was never a reason to refuse the
-- front door.
alter table accounts alter column territory_id drop not null;
