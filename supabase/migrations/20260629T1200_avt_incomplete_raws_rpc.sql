-- 20260629T1200_avt_incomplete_raws_rpc.sql
-- Aplicada:
--
-- Frente: BLOQUEO POR UNIDAD NO CONVERTIBLE — pieza 2d (AvT puntual coherente con el periodo).
--
-- Qué hace:
--  (1) Extrae la detección de "crudos×local con consumo infra-contado" a una RPC
--      ÚNICA `avt_incomplete_raws`, reusando `recipe_item_unmeasurable_raws`. Es la
--      MISMA verdad para el AvT de periodo (SQL) y el AvT puntual (front) → no se
--      reimplementa la recursión en TypeScript ni se duplica el join de ventas.
--  (2) Refactoriza `avt_period` para que LLAME a esa RPC en vez de tener las CTEs
--      `sold_dishes`/`incomplete_raws` inline.
--
-- Beneficio colateral (corrige el cierre anterior): la lectura de `sale` ya NO vive
-- dentro de `avt_period` (invoker, que podía quedar CIEGO por RLS y no marcar nada
-- en silencio). Ahora vive en la RPC SECURITY DEFINER con guard de tenancy explícito
-- (patrón de `list_costless_sold_products`): lee las ventas con certeza y autoriza
-- en la frontera. `avt_period` sigue siendo invoker; solo delega.
--
-- NOTA DDL: CREATE OR REPLACE (idempotente). Crear PRIMERO la RPC, luego avt_period
-- (que la referencia). Sin BEGIN/COMMIT en el SQL Editor. SECURITY DEFINER: NO probar
-- en el SQL Editor (auth.uid() null → el guard lanza EXCEPCIÓN); verificar desde la app.

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) RPC ÚNICA: crudos×local con consumo infra-contado en [p_from, p_to) y local.
--     p_from NULL = sin límite inferior; p_to NULL = sin límite superior.
--     Guard de tenancy explícito (la lectura de ventas salta RLS por DEFINER).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avt_incomplete_raws(
  p_account  uuid,
  p_from     timestamp with time zone DEFAULT NULL,
  p_to       timestamp with time zone DEFAULT NULL,
  p_location uuid DEFAULT NULL
)
 RETURNS TABLE(location_id uuid, recipe_item_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account)) THEN
    RAISE EXCEPTION 'avt_incomplete_raws: sin acceso a la cuenta %', p_account;
  END IF;

  RETURN QUERY
  WITH sold_dishes AS (
    -- Platos DISTINTOS vendidos en la ventana×local (1 evaluación recursiva por
    -- plato, no por línea de venta).
    SELECT DISTINCT s.location_id AS loc_id, mi.recipe_item_id AS dish_id
    FROM sale s
    JOIN sale_line sl
      ON sl.sale_id = s.id
     AND coalesce(sl.line_type, 'product') = 'product'
     AND sl.menu_item_id IS NOT NULL
    JOIN menu_item mi ON mi.id = sl.menu_item_id AND mi.recipe_item_id IS NOT NULL
    WHERE s.account_id = p_account
      AND s.is_active = true
      AND (p_from     IS NULL OR s.sold_at >= p_from)
      AND (p_to       IS NULL OR s.sold_at <  p_to)
      AND (p_location IS NULL OR s.location_id = p_location)
  )
  SELECT DISTINCT sd.loc_id, ur.raw_item_id
  FROM sold_dishes sd
  CROSS JOIN LATERAL public.recipe_item_unmeasurable_raws(sd.dish_id) ur;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) avt_period — IDÉNTICA a la versión anterior, salvo que las CTEs
--     `sold_dishes`/`incomplete_raws` inline se sustituyen por una sola CTE que
--     LLAMA a avt_incomplete_raws (una sola verdad; ya no lee `sale` aquí).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avt_period(p_account uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_location uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
with locs as (
  select id, name from locations
  where account_id = p_account and (p_location is null or id = p_location)
),
approved as (
  select ic.id as count_id, ic.location_id, ic.closed_at,
         il.recipe_item_id, il.counted_qty
  from inventory_count ic
  join inventory_count_line il on il.inventory_count_id = ic.id
  where ic.account_id = p_account
    and ic.status = 'aprobado'
    and ic.closed_at is not null
    and il.counted_qty is not null
    and (p_location is null or ic.location_id = p_location)
),
final_count as (
  select distinct on (location_id, recipe_item_id)
         location_id, recipe_item_id, counted_qty as real_final, closed_at as final_at
  from approved
  where closed_at >= p_from and closed_at < p_to
  order by location_id, recipe_item_id, closed_at desc
),
initial_count as (
  select distinct on (location_id, recipe_item_id)
         location_id, recipe_item_id, counted_qty as init_count, closed_at as init_at
  from approved
  where closed_at < p_from
  order by location_id, recipe_item_id, closed_at desc
),
opening_mv as (
  select location_id, recipe_item_id, sum(qty_base) as opening_qty
  from stock_movement
  where account_id = p_account
    and movement_type = 'apertura'
    and (p_location is null or location_id = p_location)
  group by location_id, recipe_item_id
),
buys as (
  select location_id, recipe_item_id, sum(qty_base) as buys_qty
  from stock_movement
  where account_id = p_account
    and movement_type in ('recepcion','traspaso_entrada')
    and occurred_at >= p_from and occurred_at < p_to
    and (p_location is null or location_id = p_location)
  group by location_id, recipe_item_id
),
cons as (
  select location_id, recipe_item_id, -sum(qty_base) as consumo_qty
  from stock_movement
  where account_id = p_account
    and movement_type = 'consumo'
    and occurred_at >= p_from and occurred_at < p_to
    and (p_location is null or location_id = p_location)
  group by location_id, recipe_item_id
),
-- Crudos×local con consumo infra-contado (RPC única, reusada por el puntual).
incomplete_raws as (
  select ir.location_id, ir.recipe_item_id
  from public.avt_incomplete_raws(p_account, p_from, p_to, p_location) ir
),
universe as (
  select fc.location_id, fc.recipe_item_id, fc.real_final, fc.final_at
  from final_count fc
),
joined as (
  select u.location_id, u.recipe_item_id, u.real_final,
         ic.init_count, om.opening_qty,
         coalesce(b.buys_qty, 0) as buys_qty,
         coalesce(c.consumo_qty, 0) as consumo_qty,
         case
           when ic.init_count is not null then ic.init_count
           when om.opening_qty is not null then om.opening_qty
           else null
         end as init_qty,
         case
           when ic.init_count is not null then 'conteo'
           when om.opening_qty is not null then 'apertura'
           else null
         end as init_source
  from universe u
  left join initial_count ic on ic.location_id = u.location_id and ic.recipe_item_id = u.recipe_item_id
  left join opening_mv om on om.location_id = u.location_id and om.recipe_item_id = u.recipe_item_id
  left join buys b on b.location_id = u.location_id and b.recipe_item_id = u.recipe_item_id
  left join cons c on c.location_id = u.location_id and c.recipe_item_id = u.recipe_item_id
),
enriched as (
  select j.*,
         ri.name as item_name,
         ri.needs_review,
         ri.family_id,
         rf.name as family_name,
         ku.abbreviation as unit_abbr,
         coalesce(rls.avg_unit_cost, ri.computed_cost, 0) as unit_cost,
         l.name as location_name,
         sa.name as area_name,
         (irc.recipe_item_id is not null) as cons_incomplete,
         case when j.init_qty is not null
              then j.init_qty + j.buys_qty - j.consumo_qty else null end as theo_final,
         case when j.init_qty is not null
              then (j.init_qty + j.buys_qty - j.consumo_qty) - j.real_final else null end as merma_qty
  from joined j
  join recipe_item ri on ri.id = j.recipe_item_id
  left join recipe_family rf on rf.id = ri.family_id
  left join kitchen_unit ku on ku.id = ri.base_unit_id
  left join recipe_item_location_stock rls
         on rls.recipe_item_id = j.recipe_item_id and rls.location_id = j.location_id and rls.account_id = p_account
  left join incomplete_raws irc
         on irc.location_id = j.location_id and irc.recipe_item_id = j.recipe_item_id
  join locs l on l.id = j.location_id
  left join lateral (
    select sa.name
    from recipe_item_storage_area risa
    join storage_area sa on sa.id = risa.storage_area_id
    where risa.recipe_item_id = j.recipe_item_id and sa.location_id = j.location_id
    order by risa.position asc nulls last
    limit 1
  ) sa on true
)
select jsonb_build_object(
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'recipe_item_id', e.recipe_item_id,
      'item_name', e.item_name,
      'location_id', e.location_id,
      'location_name', e.location_name,
      'area_name', e.area_name,
      'family_id', e.family_id,
      'family_name', e.family_name,
      'unit_abbr', e.unit_abbr,
      'init_qty', e.init_qty,
      'init_source', e.init_source,
      'buys_qty', e.buys_qty,
      'consumo_qty', e.consumo_qty,
      'theo_final', e.theo_final,
      'real_final', e.real_final,
      'merma_qty', case when e.cons_incomplete then null else e.merma_qty end,
      'merma_eur', case when e.cons_incomplete or e.merma_qty is null then null
                        else round(e.merma_qty * e.unit_cost, 2) end,
      'status', case
        when e.init_qty is null then 'sin_apertura'
        when e.theo_final is not null and e.theo_final < 0 then 'dato_incompleto'
        when e.cons_incomplete then 'consumo_incompleto'
        when e.needs_review or e.unit_cost = 0 then 'escandallo_no_fiable'
        else 'medible'
      end,
      'init_estimated', (e.init_source = 'apertura')
    ) order by abs(coalesce(e.merma_qty * e.unit_cost, 0)) desc)
    from enriched e
  ), '[]'::jsonb)
);
$function$;

-- GRANT: la RPC la llama el front (sesión de usuario) y avt_period. Igual que sus
-- hermanas, permitir a authenticated (el guard interno hace la autorización fina).
GRANT EXECUTE ON FUNCTION public.avt_incomplete_raws(uuid, timestamp with time zone, timestamp with time zone, uuid) TO authenticated;
