-- supabase/migrations/20260816T1000_almacen_vigia_stock_negativo.sql
--
-- ENCARGO — Almacén: vigía de stock negativo (Fase B del frente de fiabilidad
-- de almacén, folvy_almacen_fiabilidad_hallazgo_20260810.md §Fase B y §7).
--
-- Decisión de Julio (10/08): Fase B = PERMITIR + AVISAR, NO bloquear. Un stock
-- negativo es información real; no se pone suelo a cero ni se frena la venta o
-- el consumo — eso lo escondería. Hoy 24 fichas están en negativo en Foodint
-- Alcalá y NO se ven en ninguna pantalla (formatStockQty los enseñaba como
-- "sin contar": qty<0 no pasaba su guarda `q > 0`, ni tampoco valueEur<0 pasaba
-- `valueEur > 0` — el fallo silencioso exacto que este vigía existe para
-- destapar; el arreglo del lado cliente va en el mismo commit que esta migración).
--
-- QUÉ HACE esta migración (solo lectura + config, CERO escritura de stock):
--   1) supply_settings += 3 columnas de umbral (ya tenía tol_a/b/c, drift_*,
--      price_alert_pct… — mismo patrón, sin romper las existentes):
--        neg_stock_rel_pct    numeric  default 5   (%,  igual convención que
--                                                   price_alert_pct/drift_alert_pct)
--        neg_stock_abs_qty    numeric  default 5   (suelo absoluto, UNIDAD BASE
--                                                   del artículo — evita ruido
--                                                   por micro-negativos cuando
--                                                   el artículo casi no rota)
--        neg_stock_window_days integer default 60  (ventana de "consumo reciente")
--   2) negative_stock_report(p_account, p_location) — RPC de solo lectura:
--      universo = recipe_item type='raw' is_active (mismo universo que
--      storage_coverage/stock_levels_overview/autoinventory_queue) con
--      qty_on_hand < 0. Por cada uno:
--        - REGLA ANTI-RUIDO: is_alert = |qty_on_hand| >= GREATEST(
--            neg_stock_rel_pct/100 * consumo_de_referencia , neg_stock_abs_qty)
--          consumo_de_referencia = consumo (|qty_base| de movement_type='consumo')
--          de los últimos N días; si esa ventana no tiene datos, cae al consumo
--          TOTAL histórico ("en su defecto, consumo total", tal cual el encargo).
--          Con esto Tomate Pera (−130 / 15.582 consumidos = 0,8%) NO alerta;
--          Arroz Largo (−13.040/27.060 = 48%) y Carne de Birria (42%) SÍ.
--        - CAUSA (accionable, sobre TOTALES históricos — son los que explican
--          el acumulado, no la ventana de ruido):
--            'sin_entradas'        si no hay NINGÚN stock_movement 'recepcion'
--                                  para ese artículo×local.
--            'compras_por_detras'  si hay recepciones pero
--                                  abs(consumo total) > recepción total.
--            'otras_salidas'       fallback honesto: no cuadra solo con
--                                  compras vs consumo (mermas/ajustes/traspasos) —
--                                  NO se inventa una causa que no se sostiene.
--      SECURITY DEFINER + guard explícito (admin/manager de la cuenta), NO
--      security invoker: stock_movement tiene RLS costosa fila a fila (ver
--      20260815T1600, statement timeout real con 361 filas); esta RPC agrega
--      sobre TODO el universo negativo del local de una vez, así que necesita
--      el guard evaluado UNA vez, no por fila — mismo criterio que
--      list_item_stock_movements/get_sale_ticket.
--
-- NO TOCA: recipe_item_location_stock (solo SELECT), no hay ningún UPDATE/
-- INSERT/DELETE de stock en todo este fichero. No bloquea confirm_goods_receipt,
-- ventas, ni consumo. No pone nada a cero.
--
-- Sin BEGIN/COMMIT. Se prueba DESDE LA APP (auth.uid() necesita sesión).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Umbrales configurables en supply_settings ──────────────────────────
alter table public.supply_settings
  add column if not exists neg_stock_rel_pct     numeric not null default 5,
  add column if not exists neg_stock_abs_qty      numeric not null default 5,
  add column if not exists neg_stock_window_days  integer not null default 60;

comment on column public.supply_settings.neg_stock_rel_pct is
  'Vigía de stock negativo: % del consumo reciente que debe superar |qty_on_hand| para contar como ALERTA (anti-ruido). Default 5.';
comment on column public.supply_settings.neg_stock_abs_qty is
  'Vigía de stock negativo: suelo absoluto en unidad base del artículo (evita ruido en artículos casi sin consumo). Default 5.';
comment on column public.supply_settings.neg_stock_window_days is
  'Vigía de stock negativo: ventana en días para el "consumo reciente"; sin consumo en la ventana, se usa el consumo total histórico. Default 60.';

-- ── 2) negative_stock_report — solo lectura, SECURITY DEFINER + guard ─────
create or replace function public.negative_stock_report(
  p_account  uuid,
  p_location uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_rel_pct numeric;
  v_abs_qty numeric;
  v_window  integer;
  v_res     jsonb;
begin
  if not (current_user_is_admin() or current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'negative_stock_report: sin acceso a la cuenta %', p_account;
  end if;

  select coalesce(s.neg_stock_rel_pct, 5),
         coalesce(s.neg_stock_abs_qty, 5),
         coalesce(s.neg_stock_window_days, 60)
    into v_rel_pct, v_abs_qty, v_window
  from public.supply_settings s
  where s.account_id = p_account;

  v_rel_pct := coalesce(v_rel_pct, 5);
  v_abs_qty := coalesce(v_abs_qty, 5);
  v_window  := coalesce(v_window, 60);

  with universe as (
    select ri.id, ri.name, ku.abbreviation as unit_abbr,
           coalesce(rls.qty_on_hand, 0) as qty_on_hand,
           coalesce(rls.stock_value, 0) as value_eur
    from public.recipe_item ri
    left join public.kitchen_unit ku on ku.id = ri.base_unit_id
    left join public.recipe_item_location_stock rls
           on rls.recipe_item_id = ri.id
          and rls.location_id    = p_location
          and rls.account_id     = p_account
    where ri.account_id = p_account
      and ri.type = 'raw'
      and ri.is_active = true
  ),
  negativos as (
    select * from universe where qty_on_hand < 0
  ),
  mov_all as (
    -- Totales históricos: son los que EXPLICAN el acumulado (la causa).
    select sm.recipe_item_id,
           coalesce(sum(sm.qty_base) filter (where sm.movement_type = 'recepcion'), 0)      as recepcion_total,
           count(*)                  filter (where sm.movement_type = 'recepcion')          as recepcion_count,
           coalesce(sum(abs(sm.qty_base)) filter (where sm.movement_type = 'consumo'), 0)    as consumo_total_abs
    from public.stock_movement sm
    where sm.account_id  = p_account
      and sm.location_id = p_location
      and sm.recipe_item_id in (select id from negativos)
    group by sm.recipe_item_id
  ),
  mov_window as (
    -- Consumo reciente: solo para la regla anti-ruido (magnitud relativa).
    select sm.recipe_item_id,
           coalesce(sum(abs(sm.qty_base)), 0) as consumo_window_abs
    from public.stock_movement sm
    where sm.account_id     = p_account
      and sm.location_id    = p_location
      and sm.movement_type  = 'consumo'
      and sm.occurred_at   >= now() - make_interval(days => v_window)
      and sm.recipe_item_id in (select id from negativos)
    group by sm.recipe_item_id
  ),
  scored as (
    select n.id, n.name, n.unit_abbr, n.qty_on_hand, n.value_eur,
           coalesce(ma.recepcion_total, 0)   as recepcion_total,
           coalesce(ma.recepcion_count, 0)   as recepcion_count,
           coalesce(ma.consumo_total_abs, 0) as consumo_total_abs,
           -- "en su defecto, consumo total": sin dato en la ventana, cae al histórico.
           case when coalesce(mw.consumo_window_abs, 0) > 0
                then mw.consumo_window_abs
                else coalesce(ma.consumo_total_abs, 0)
           end as consumo_ref_abs
    from negativos n
    left join mov_all    ma on ma.recipe_item_id = n.id
    left join mov_window mw on mw.recipe_item_id = n.id
  )
  select jsonb_build_object(
    'window_days',       v_window,
    'threshold_rel_pct', v_rel_pct,
    'threshold_abs_qty', v_abs_qty,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'recipe_item_id', s.id,
               'name',           s.name,
               'unit_abbr',      s.unit_abbr,
               'qty_on_hand',    s.qty_on_hand,
               'value_eur',      s.value_eur,
               'ratio_pct',      case when s.consumo_ref_abs > 0
                                       then round(abs(s.qty_on_hand) / s.consumo_ref_abs * 100, 1)
                                       else null end,
               'cause',          case
                                    when s.recepcion_count = 0 then 'sin_entradas'
                                    when s.consumo_total_abs > s.recepcion_total then 'compras_por_detras'
                                    else 'otras_salidas'
                                  end,
               'is_alert',       (abs(s.qty_on_hand) >= greatest(v_rel_pct / 100.0 * s.consumo_ref_abs, v_abs_qty))
             ) order by
               -- más severo primero: mayor % del consumo reciente que representa
               -- el negativo; sin ninguna referencia de consumo, al principio
               -- (es el caso más raro de explicar, no el más fácil de ignorar).
               (case when s.consumo_ref_abs > 0
                     then abs(s.qty_on_hand) / s.consumo_ref_abs
                     else null end) desc nulls first,
               s.qty_on_hand asc)
      from scored s
    ), '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$function$;

revoke all on function public.negative_stock_report(uuid, uuid) from public, anon;
grant execute on function public.negative_stock_report(uuid, uuid) to authenticated;

-- ── GUARD — seguridad y permisos exactamente como deben quedar ────────────
do $guard$
declare
  v_no_definer         text;
  v_filtrable_por_anon text;
begin
  select string_agg(p.proname, ', ') into v_no_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'negative_stock_report'
    and not p.prosecdef;
  if v_no_definer is not null then
    raise exception 'MIGRACIÓN FALLIDA: debería ser SECURITY DEFINER: %', v_no_definer;
  end if;

  select string_agg(routine_name || '/' || grantee, ', ') into v_filtrable_por_anon
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name = 'negative_stock_report'
    and grantee in ('anon', 'PUBLIC');
  if v_filtrable_por_anon is not null then
    raise exception 'MIGRACIÓN FALLIDA: acceso indebido de anon/public: %', v_filtrable_por_anon;
  end if;

  if not exists (
    select 1 from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'negative_stock_report' and grantee = 'authenticated'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: authenticated no tiene EXECUTE sobre negative_stock_report';
  end if;

  raise notice 'OK — negative_stock_report es DEFINER, solo authenticated, columnas de umbral en supply_settings.';
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, tras aplicar):
--   - SELECT negative_stock_report no se puede probar en el SQL Editor
--     (auth.uid() es NULL sin sesión) — probar desde la app (Almacén → Teórico
--     vs Real → Stock negativo) con un usuario admin/manager de Foodint Alcalá.
--   - Deben aparecer en alerta: Arroz Largo, Carne de Birria, Guacamole y las
--     elaboraciones sin entrada. NO debe aparecer Tomate Pera (−130, ruido).
--   - Ninguna venta ni consumo se bloquea; recipe_item_location_stock.qty_on_hand
--     sigue siendo el real (negativo) — esta migración no lo toca.
-- ════════════════════════════════════════════════════════════════════════════
