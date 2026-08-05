-- ============================================================================
-- BUG CRÍTICO — DOBLE DESCUENTO DE STOCK POR VENTA (solo DDL, sin datos).
--
-- SÍNTOMA (verificado en producción, Foodint Alcalá, "Milanesa de Pollo
-- Rebozado" 52aa4147-…, ventana de 1 día):
--     "Consumo por venta"  → 27 movimientos, 35 uds
--     "consumo teorico"    → 25 movimientos, 32 uds
--   = 67 uds descontadas donde las ventas solo justifican 35.
--
-- CAUSA RAÍZ (RECON completo sobre la BD viva, no sobre el repo):
--   Hay DOS motores de consumo escribiendo en stock_movement con
--   movement_type='consumo' y source_type='sale', pero con DISTINTO source_id:
--
--     A) generate_sale_consumption(sale_id)   → source_id = sale.id
--        notes = 'Consumo por venta'. Idempotente POR VENTA (borra por sale_id
--        antes de reinsertar). Explota combos y modificadores vía
--        _sale_line_raw_consumption. Disparado por el trigger
--        trg_sale_consumption_on_complete (AFTER UPDATE ON sale, al pasar
--        order_status a 'completed').
--
--     B) compute_sale_line_consumption(sale_line_id) → source_id = sale_line.id
--        notes = 'consumo teorico'. Idempotente POR LÍNEA (borra por
--        sale_line_id). Disparado desde close_sale (bucle por línea).
--
--   Como cada uno borra SOLO lo suyo (distinto source_id), nunca se pisan: los
--   dos consumos coexisten. Y el webhook de Last ejecuta LOS DOS en cada venta,
--   en este orden exacto (supabase/functions/lastapp-webhook/index.ts,
--   ingestBill):
--        1. close_sale(id)                        → escribe B
--        2. UPDATE sale SET order_status='completed' → trigger escribe A
--   Resultado: doble descuento en TODAS las ventas de Last. Igual en HubRise.
--
-- POR QUÉ NO BASTA CON "QUITAR B" (lo que el encargo dejaba abierto al RECON):
--   Sobre 30 días de Foodint (2.485 ventas completed+closed):
--        ambas .......... 1.683   (el doble descuento)
--        solo A .............64   (líneas sin computed_cost: B se abstiene)
--        solo B .............86   (el UPDATE a 'completed' nunca ocurrió → el
--                                  trigger A no llegó a disparar)
--        sin consumo .......652   (TODAS sus líneas con computed_cost NULL:
--                                  escandallo sin resolver — problema DISTINTO,
--                                  ni lo causa ni lo agrava este arreglo)
--   Esas 86 "solo B" demuestran que hay ventas que pasan por close_sale y NUNCA
--   por 'completed'. Si close_sale dejara de escribir consumo sin más, esas
--   ventas se quedarían a cero.
--
-- ARREGLO (vía 2 de las dos que planteaba el encargo):
--   close_sale NO deja de generar consumo: pasa a generar el del sistema A.
--   Es seguro precisamente porque A es idempotente POR VENTA: cuando después
--   el UPDATE a 'completed' dispare el trigger, A borra su propio consumo y lo
--   reescribe → el resultado final es 1x, nunca 2x. Y si el UPDATE nunca llega
--   (las 86), el consumo ya quedó escrito por close_sale. Un solo motor, una
--   sola etiqueta, cero duplicados, cero ventas huérfanas.
--
--   Se aplica el mismo cambio a los otros DOS llamadores de B encontrados en el
--   RECON (si no, un reproceso volvería a inyectar el duplicado):
--     - reprocess_sale(sale_id)
--     - recompute_sales_consumption(account_id, from, to)
--
--   compute_sale_line_consumption NO se borra (el encargo lo pide así): queda
--   viva y marcada como deprecada vía COMMENT. Tras esta migración ya no la
--   llama nadie en public (verificado con pg_get_functiondef sobre pg_proc).
--
-- BUG LATENTE ARREGLADO DE PASO (lo destapó el RECON, no estaba en el encargo):
--   revert_sale_consumption borraba SOLO los movimientos de B (join contra
--   sale_line por source_id). Los de A (source_id = sale.id) NUNCA se borraban.
--   Es decir: cancelar una venta (cancel_sale → revert_sale_consumption) dejaba
--   su consumo A vivo en el stock. Y tras esta migración, sin arreglarlo, no
--   borraría absolutamente nada. Ahora borra AMBAS formas.
--
-- Ninguna firma cambia (mismos argumentos y mismo tipo de retorno en las 4
-- funciones), así que CREATE OR REPLACE es suficiente y no hace falta DROP.
--
-- SOLO DDL. El borrado del histórico duplicado va en la migración de datos
-- hermana 20260815T1400_fix_doble_consumo_venta_datos.sql — separadas a
-- propósito: una función SECURITY DEFINER no debe ejecutarse en la misma
-- transacción que la crea (auth.uid() es null en el SQL Editor → EXCEPTION).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) close_sale — el coste sigue igual; el consumo pasa al motor A.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.close_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_line uuid;
begin
  update sale
  set status     = 'closed',
      closed_at  = coalesce(closed_at, now()),
      updated_at = now()
  where id = p_sale_id;

  -- 1) coste de cada línea product (INTACTO: esto no es consumo).
  for v_line in
    select id from sale_line
    where sale_id = p_sale_id and coalesce(line_type, 'product') = 'product'
  loop
    perform public.compute_sale_line_cost(v_line);
  end loop;

  -- 2) consumo de stock: motor ÚNICO y por VENTA (generate_sale_consumption).
  --    Antes aquí había un bucle llamando a compute_sale_line_consumption, que
  --    escribía un segundo consumo con source_id = sale_line.id y sobrevivía a
  --    la idempotencia del trigger de 'completed' → doble descuento.
  --    generate_sale_consumption es idempotente por sale_id: da igual que se
  --    llame aquí y otra vez desde el trigger, el resultado final es 1x.
  perform public.generate_sale_consumption(p_sale_id);
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) reprocess_sale — mismo cambio: reconstruye líneas y coste igual que antes,
--    pero el consumo lo regenera el motor A una sola vez al final.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.reprocess_sale(p_sale_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_account_id uuid;
  v_loc        uuid;
  v_source     text;
  v_line_id    uuid;
  v_item       uuid;
  v_old_items  uuid[];
  v_n          integer := 0;
BEGIN
  SELECT account_id, location_id, source INTO v_account_id, v_loc, v_source
  FROM sale WHERE id = p_sale_id;
  IF v_account_id IS NULL THEN RETURN 0; END IF;

  -- Raws con consumo PREVIO de esta venta, en CUALQUIERA de las dos formas
  -- (por línea = legacy B, por venta = motor A) — para recalcular su stock
  -- aunque tras el reproceso ya no consuman ese raw.
  v_old_items := ARRAY(
    SELECT DISTINCT sm.recipe_item_id
    FROM stock_movement sm
    WHERE sm.account_id = v_account_id
      AND sm.movement_type = 'consumo'
      AND sm.source_type = 'sale'
      AND (
        sm.source_id = p_sale_id
        OR sm.source_id IN (SELECT id FROM sale_line WHERE sale_id = p_sale_id)
      )
  );

  -- Limpiar el consumo legacy por línea (el motor A limpiará el suyo solo).
  DELETE FROM stock_movement sm
  WHERE sm.account_id = v_account_id
    AND sm.movement_type = 'consumo'
    AND sm.source_type = 'sale'
    AND sm.source_id IN (SELECT id FROM sale_line WHERE sale_id = p_sale_id);

  -- 0.bis) Resolver la marca desde external_brand_map (solo Last).
  IF v_source = 'lastapp' THEN
    PERFORM public.resolve_sale_brand_from_map(p_sale_id);
  END IF;

  -- 1) Reconstruir las líneas canónicas con el motor de la fuente correcta.
  IF v_source = 'hubrise' THEN
    PERFORM public.adapt_hubrise_order(p_sale_id);
  ELSE
    PERFORM public.adapt_lastapp_order(p_sale_id);
  END IF;

  -- 2) Coste por línea (el consumo ya NO va aquí).
  FOR v_line_id IN
    SELECT id FROM sale_line
    WHERE sale_id = p_sale_id AND line_type = 'product'
  LOOP
    PERFORM public.compute_sale_line_cost(v_line_id);
    v_n := v_n + 1;
  END LOOP;

  -- 3) Consumo: una sola pasada por venta.
  PERFORM public.generate_sale_consumption(p_sale_id);

  -- 4) Recalcular el stock de los raws que solo tenían el consumo viejo.
  IF v_loc IS NOT NULL THEN
    FOREACH v_item IN ARRAY COALESCE(v_old_items, '{}'::uuid[])
    LOOP
      PERFORM public.recompute_location_stock_core(v_item, v_loc);
    END LOOP;
  END IF;

  RETURN v_n;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) recompute_sales_consumption — recálculo masivo por cuenta. Pasa a iterar
--    por VENTA (no por línea), que es la granularidad del motor A. Mismo guard
--    de permisos, misma firma, mismo shape de retorno.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.recompute_sales_consumption(
  p_account_id uuid,
  p_from timestamp with time zone default null,
  p_to   timestamp with time zone default null
)
returns table(lines_processed integer, movements_written integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_sale_id uuid;
  v_sales   integer := 0;
  v_moves   integer := 0;
BEGIN
  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'recompute_sales_consumption: sin acceso a la cuenta %', p_account_id;
  END IF;

  FOR v_sale_id IN
    SELECT s.id
    FROM sale s
    WHERE s.account_id = p_account_id
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to   IS NULL OR s.sold_at <  p_to)
  LOOP
    v_moves := v_moves + COALESCE(public.generate_sale_consumption(v_sale_id), 0);
    v_sales := v_sales + 1;
  END LOOP;

  -- 'lines_processed' se mantiene por compatibilidad de firma; ahora cuenta
  -- VENTAS procesadas (la unidad real del motor A).
  lines_processed   := v_sales;
  movements_written := v_moves;
  RETURN NEXT;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) revert_sale_consumption — ahora borra el consumo de la venta en SUS DOS
--    formas. Antes solo borraba el legacy por línea, así que cancelar una
--    venta dejaba vivo su consumo del motor A (stock fantasma).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.revert_sale_consumption(p_sale_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_loc      uuid;
  v_affected uuid[];
  v_item     uuid;
  v_deleted  integer := 0;
begin
  select location_id into v_loc from sale where id = p_sale_id;

  -- Raws afectados por el consumo de esta venta, en cualquiera de las dos formas.
  v_affected := array(
    select distinct sm.recipe_item_id
    from stock_movement sm
    where sm.source_type   = 'sale'
      and sm.movement_type = 'consumo'
      and (
        sm.source_id = p_sale_id
        or sm.source_id in (select id from sale_line where sale_id = p_sale_id)
      )
  );

  delete from stock_movement sm
  where sm.source_type   = 'sale'
    and sm.movement_type = 'consumo'
    and (
      sm.source_id = p_sale_id
      or sm.source_id in (select id from sale_line where sale_id = p_sale_id)
    );
  get diagnostics v_deleted = row_count;

  if v_loc is not null then
    foreach v_item in array coalesce(v_affected, '{}'::uuid[])
    loop
      perform public.recompute_location_stock_core(v_item, v_loc);
    end loop;
  end if;

  return v_deleted;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) Deprecación explícita del motor legacy (NO se borra: el encargo pide
--    dejarla viva por si algo externo la usara).
-- ────────────────────────────────────────────────────────────────────────────
comment on function public.compute_sale_line_consumption(uuid) is
  'DEPRECADA (2026-08-15). Motor de consumo legacy por LÍNEA (notes=''consumo '
  'teorico'', source_id=sale_line.id). Convivía con generate_sale_consumption '
  '(por VENTA) y, al usar distinto source_id, ninguna idempotencia borraba a la '
  'otra: cada venta descontaba stock DOS VECES. Ya no la llama nadie en public. '
  'El motor único es generate_sale_consumption(sale_id). NO usar en código nuevo.';

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — ninguna función de public puede seguir llamando al motor legacy.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
declare
  v_callers text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_callers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname <> 'compute_sale_line_consumption'
    and pg_get_functiondef(p.oid) ilike '%compute_sale_line_consumption%';

  if v_callers is not null then
    raise exception 'MIGRACIÓN FALLIDA: siguen llamando al motor legacy: %', v_callers;
  end if;

  raise notice 'OK — motor de consumo unificado en generate_sale_consumption (sin llamadores legacy).';
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, en transacción APARTE de esta migración):
--
--   -- 1) Una venta NUEVA posterior al fix debe tener SOLO 'Consumo por venta'.
--   --    (Se filtra por uuid de local: hay DOS 'Foodint Alcalá', uno por cuenta.)
--   select sm.notes, count(*), sum(abs(sm.qty_base))
--     from stock_movement sm
--    where sm.recipe_item_id = '52aa4147-d2de-4bfd-9679-5a757247c16c'
--      and sm.location_id = '38158159-cd71-4056-950b-53425afac1ce'
--      and sm.movement_type = 'consumo'
--      and sm.occurred_at >= now() - interval '2 hours'
--    group by 1;
--   -- Esperado: una sola fila, 'Consumo por venta'.
--
--   -- 2) Que no reaparezca el legacy en ninguna venta nueva:
--   select count(*) from stock_movement
--    where notes = 'consumo teorico' and occurred_at > now() - interval '1 hour';
--   -- Esperado: 0.
-- ============================================================================
