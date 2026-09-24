-- THE PRODUCT LINE, IN THE DATABASE (João, 2026-09-24): the screens read one
-- line at a time — Thermo, Accoya or Hardwoods — and Thermo is what they open
-- on. The files name a product, never a line, so the line is read out of the
-- name, the same three rules the app applies to the rows it holds:
--
--   ACCOYA     — acetylated wood, always named
--   THERMO     — "THERMOWOOD", "Maximo Thermo", "Thermally Modified", and the
--                trade's "TM" as its own word (Andre confirmed 2026-09-24 on a
--                Radiata Pine T&G carrying 11,562 LF)
--   HARDWOODS  — everything else: the natural species (Ipe, Garapa, Cumaru)
--
-- Stored on the row rather than computed per query, because the aggregate the
-- trend reads (sell_through_periods) must be able to group by it: the month
-- chart cannot be built from the rows on screen, which are only the window's.
--
-- Its twin lives in src/lib/domain/sell-through.ts (productLine), which reads
-- the rows already fetched. The two must agree; tests/19 pins the examples.

alter table sell_through
  add column product_line text generated always as (
    case
      when product is null or btrim(product) = '' then null
      when product ~* 'accoya' then 'ACCOYA'
      when product ~* '(thermo|thermowood|therm\s*mod|thermally\s+modified|(^|\s)TM(\s|$))'
        then 'THERMO'
      else 'HARDWOODS'
    end
  ) stored;

create index sell_through_product_line_idx on sell_through (org_id, product_line);

-- The reading view gains the column (appended, so every reader is untouched).
-- security_invoker is RESTATED on purpose: create or replace drops it, and
-- without it a rep reads other reps' rows.
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
    ha.id IS NOT NULL AS is_house_account,
    ha.kind AS house_account_kind,
    st.id AS row_id,
    st.product_line
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
     LEFT JOIN distributor_house_accounts ha ON ha.org_id = st.org_id AND ha.distributor_id = dist.id AND ha.dealer_label = st.dealer_label;

-- The month trend's backbone splits by line too. Summing this view without
-- grouping still gives the same totals it always did — one month is simply
-- carried by up to three rows per region now.
create or replace view sell_through_periods
with (security_invoker = true) as
 SELECT org_id,
    period,
    period_kind,
    region_id,
    region_name,
    unit,
    sum(quantity) AS quantity,
    count(*) AS row_count,
    product_line
   FROM sell_through_rows
  GROUP BY org_id, period, period_kind, region_id, region_name, unit, product_line;
