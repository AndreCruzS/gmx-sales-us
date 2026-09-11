-- A stable key to page by. PostgREST caps every request at the project's
-- max-rows and says nothing about it, so reading the whole book means walking
-- it in ranges — and range paging over an UNORDERED result is free to repeat
-- one row and skip another. On this view that reads as a sales figure nobody
-- can reproduce. The underlying row already has an id; the view stops hiding
-- it so callers have something deterministic to order by.
--
-- security_invoker restated, as every replace of this view must (d89f759).
create or replace view sell_through_rows
with (security_invoker = true) as
 SELECT st.org_id,
    st.period,
        CASE
            WHEN b.territory_id IS NOT NULL THEN owner.id
            ELSE d.owner_id
        END AS rep_id,
        CASE
            WHEN b.territory_id IS NOT NULL THEN ( SELECT COALESCE(ou.full_name, ou.email) AS "coalesce"
               FROM users ou
              WHERE ou.id = owner.user_id)
            ELSE COALESCE(du.full_name, du.email)
        END AS rep_name,
    t.id AS region_id,
    t.name AS region_name,
    owner.id AS market_owner_id,
    ( SELECT COALESCE(ou.full_name, ou.email) AS "coalesce"
           FROM users ou
          WHERE ou.id = owner.user_id) AS market_owner_name,
    dist.id AS distributor_id,
    dist.name AS distributor_name,
    b.id AS branch_id,
    b.name AS branch_name,
    b.city AS branch_city,
    b.state AS branch_state,
    d.id AS dealer_id,
    d.name AS dealer_name,
    st.dealer_label,
    st.product,
    st.quantity,
    st.unit,
    st.value,
    st.ly_quantity,
    u.period_kind,
    (ha.id IS NOT NULL) AS is_house_account,
    ha.kind AS house_account_kind,
    st.id AS row_id
   FROM sell_through st
     JOIN sell_through_uploads u ON u.id = st.upload_id
     JOIN distributor_branches b ON b.id = st.branch_id
     JOIN accounts dist ON dist.id = b.distributor_id
     LEFT JOIN territories t ON t.id = b.territory_id
     LEFT JOIN LATERAL ( SELECT m2.id,
            m2.user_id
           FROM memberships m2
          WHERE m2.territory_id = t.id AND m2.org_id = st.org_id AND m2.role = 'rep'::membership_role
          ORDER BY m2.created_at
         LIMIT 1) owner ON true
     LEFT JOIN accounts d ON d.id = st.dealer_id
     LEFT JOIN memberships m ON m.id = d.owner_id
     LEFT JOIN users du ON du.id = m.user_id
     LEFT JOIN distributor_house_accounts ha
            ON ha.org_id = st.org_id
           AND ha.distributor_id = dist.id
           AND ha.dealer_label = st.dealer_label;
