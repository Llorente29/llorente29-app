-- ============================================================================
-- LA GUARDA DE IDEMPOTENCIA DEL ÚNICO ESCRITOR DEL ALMACÉN · 16/09/2026
-- APLICADA en producción el 16/09 a las 17:14:31 UTC = 19:14:31 de Madrid.
--
-- Si lo que habría que escribir es EXACTAMENTE lo que ya hay, se sale sin tocar
-- nada. Antes, un cierre llamaba dos veces a esta función --close_sale y
-- tg_sale_consumption_on_complete escuchan el mismo cambio-- y cada pasada
-- borraba los movimientos y escribía otros nuevos: sobre G190, 27 fuera y 27
-- dentro, mismas cantidades, identificadores distintos. Cuadraba el número y se
-- perdía la trazabilidad.
--
-- Arregla los SIETE caminos a la vez, que es por lo que vive aquí y no en el
-- cierre: close_sale, los dos disparadores, reprocess_sale, el cron de la 01:30,
-- recompute_sales_consumption y recost_sales_for_product.
--
-- CÓMO SE APLICA, y por qué así: la guarda se INSERTA en el cuerpo que hay en
-- producción, leyéndolo de pg_proc. Nadie transcribe 16.401 caracteres a mano,
-- que es donde se cuelan los errores. El ancla se cuenta antes de tocar: si no
-- aparece exactamente una vez, la migración aborta. Y si la guarda ya estaba
-- puesta, no hace nada.
--
-- VOLVER ATRÁS, en una sentencia: el mismo DO quitando la guarda en vez de
-- ponerla. Está al final, comentado. No hace falta guardar aquí el cuerpo
-- viejo: la guarda se quita con el mismo texto con el que se puso.
--
-- LO QUE SE COMPARA: lo que esta función ESCRIBE, ni más ni menos.
--   stock_movement: recipe_item_id, sale_line_id, qty_base, unit_cost,
--                   occurred_at, location_id, notes
--   sale_consumption_skip: recipe_item_id, corte, motivo
--   `cost_provisional` y `storage_area_id` NO: esta función no los escribe.
--   `sale_consumption_failure` tampoco: lo escribe `_resolver_fallo_de_consumo`.
--   `unit_cost` SÍ, y es la condición que sostiene `recost_sales_for_product`.
--
-- DEUDA DECLARADA: el cálculo del escandallo queda DOS VECES dentro de la misma
-- función --el de la guarda y el de siempre, que no se toca--. La alternativa
-- era reestructurar el único escritor del almacén con servicio en marcha. Esta
-- duplicación falla del lado bueno: si los dos cálculos dejan de coincidir, la
-- guarda NO salta y se escribe como siempre. Lo único peligroso sería decir
-- «igual» siendo distinto, y de eso se encarga que la comparación sea estricta y
-- en los dos sentidos.
--
-- LAS SEIS PRUEBAS, cada una en su bloque, midiendo en sentencias aparte y
-- revirtiendo con RAISE (16/09, 21:0x):
--   1 sin cambios (G190) ....... devuelve 27 · misma huella · 0 filas nuevas
--   2 coste cambiado ........... medio 0,890956 · huella distinta · 27 nuevas
--                                · el movimiento queda con unit_cost 0,890956
--   3 ficha cambiada ........... qty −300 → −600 · 27 filas nuevas
--   4 anulada con corte (G979) . 1 → 1 movimiento: protegido, corte 13/09 10:54
--                                contra venta del 12/09 15:44. Como hoy.
--   5 bajo el corte (G645) ..... con guarda y sin guarda: mismo contenido,
--                                mismas notas, 10 movimientos y 10
--   6 anulada libre (fabricado)  27 → 0 al anular → 0 tras la guarda
--   + el parte del 15/09, antes y después: 992 bien · 0 faltan · 5 retenidos
--     · 0 cantidad distinta · 259 uds · 258 descuentan. Idéntico.
--
-- La 6 va fabricada y se dice: NO hay en la población ni una venta anulada cuyos
-- movimientos estén libres de corte, así que no había con qué probarlo real.
--
-- Y EL PRIMER INTENTO SALIÓ EN ROJO POR UN FALLO DE LA PRUEBA, no del código:
-- la llamada y las comprobaciones iban en la MISMA sentencia SELECT, así que las
-- subconsultas leían el snapshot del principio y no veían lo que la función
-- acababa de escribir. Los «0 filas nuevas» eran un artefacto. Lo cazó Julio, y
-- es la regla 5 otra vez: la evidencia no medía lo que yo creía.
-- ============================================================================

do $migracion$
declare
  v_src text;
  v_n   int;
  v_guarda text := $guarda$
  -- ══ GUARDA DE IDEMPOTENCIA · 16/09/2026 ══
  -- Si lo que habria que escribir es EXACTAMENTE lo que ya hay, se sale sin
  -- tocar nada. Va ANTES del primer DELETE: una guarda al final seria borrar
  -- y volver a poner.
  -- Con el motor viejo no salta (sus movimientos cuelgan de la LINEA, y
  -- compararlos pediria replicar tambien esa mitad; son historia).
  IF NOT v_legacy THEN
    WITH base AS (
      SELECT sl.id AS line, r.raw_item_id AS item, sum(r.qty_base) AS qty
        FROM public.sale_line sl
        CROSS JOIN LATERAL public._sale_line_raw_consumption(sl.id) r
       WHERE sl.sale_id = p_sale_id
         AND COALESCE(sl.line_type, 'product') = 'product'
         AND sl.ignored_at IS NULL
         AND (sl.menu_item_id IS NOT NULL
              OR EXISTS (SELECT 1 FROM public.sale_line c
                          WHERE c.parent_sale_line_id = sl.id AND c.line_type = 'combo_item'))
         AND r.raw_item_id IS NOT NULL
         AND r.qty_base IS NOT NULL
       GROUP BY sl.id, r.raw_item_id
      HAVING sum(r.qty_base) <> 0
    ),
    items AS (SELECT DISTINCT item FROM base),
    cortes AS (SELECT * FROM public.cortes_aprobados(v_sale.location_id,
                      (SELECT array_agg(item) FROM items))),
    precios AS (
      SELECT i.item,
             (SELECT ric.avg_unit_cost FROM public.recipe_item_location_stock ric
               WHERE ric.recipe_item_id = i.item AND ric.account_id = v_sale.account_id
                 AND ric.location_id = v_sale.location_id) AS medio,
             (SELECT COALESCE(ri.computed_cost, ri.fixed_cost)
                FROM public.recipe_item ri WHERE ri.id = i.item) AS escandallo
        FROM items i
    ),
    plan AS (
      SELECT i.item, c.corte, (c.corte IS NULL OR v_fecha >= c.corte) AS libre,
             pr.medio, pr.escandallo,
             COALESCE(pr.medio < 0
               OR (pr.medio > 0 AND pr.escandallo > 0 AND pr.medio > 20 * pr.escandallo)
             , false) AS indefendible
        FROM items i LEFT JOIN cortes c ON c.recipe_item_id = i.item
                     LEFT JOIN precios pr ON pr.item = i.item
    ),
    mov_previstos AS (
      SELECT b.item AS recipe_item_id, b.line AS sale_line_id, -b.qty AS qty_base,
             CASE WHEN p.medio IS NULL THEN p.escandallo
                  WHEN p.medio = 0     THEN NULL
                  ELSE p.medio END AS unit_cost,
             v_fecha AS occurred_at, v_sale.location_id AS location_id,
             'Consumo por venta'::text AS notes
        FROM base b JOIN plan p ON p.item = b.item AND p.libre AND NOT p.indefendible
       WHERE NOT v_void
    ),
    mov_actuales AS (
      SELECT sm.recipe_item_id, sm.sale_line_id, sm.qty_base, sm.unit_cost,
             sm.occurred_at, sm.location_id, sm.notes
        FROM public.stock_movement sm
       WHERE sm.account_id = v_sale.account_id AND sm.movement_type = 'consumo'
         AND sm.source_type = 'sale' AND sm.source_id = p_sale_id
    ),
    nota_previstas AS (
      SELECT p.item AS recipe_item_id, p.corte,
             CASE WHEN NOT p.libre
                  THEN 'regeneracion por debajo del corte: el recuento posterior ya cuadro este ingrediente'
                  ELSE format('precio indefendible: %s EUR frente a %s del escandallo. No se escribe el '
                           || 'movimiento para no meter ese precio en la historia de coste.',
                           round(p.medio, 6), round(p.escandallo, 6))
             END AS motivo
        FROM plan p WHERE (NOT p.libre OR p.indefendible) AND NOT v_void
      UNION ALL
      SELECT x.item, NULL::timestamptz,
             'el escandallo de hoy ya no pide este ingrediente en esta venta: se retira lo que habia '
          || 'apuntado. Puede ser que la receta cambiara, que la linea dejara de estar mapeada o que '
          || 'un extra lo anule; no se guarda la version del escandallo con la que se consumio, asi '
          || 'que no se puede decir cual.'
        FROM unnest(v_previos) AS x(item)
       WHERE NOT v_void AND NOT EXISTS (SELECT 1 FROM items i WHERE i.item = x.item)
    ),
    nota_actuales AS (
      SELECT s.recipe_item_id, s.corte, s.motivo
        FROM public.sale_consumption_skip s WHERE s.sale_id = p_sale_id
    ),
    difieren AS (
      SELECT 1 FROM (TABLE mov_previstos  EXCEPT ALL TABLE mov_actuales)  a
      UNION ALL SELECT 1 FROM (TABLE mov_actuales   EXCEPT ALL TABLE mov_previstos) b
      UNION ALL SELECT 1 FROM (TABLE nota_previstas EXCEPT ALL TABLE nota_actuales) c
      UNION ALL SELECT 1 FROM (TABLE nota_actuales  EXCEPT ALL TABLE nota_previstas) d
    )
    SELECT NOT EXISTS (SELECT 1 FROM difieren) INTO v_igual;

    IF v_igual THEN
      -- Nada que hacer. Se devuelve lo que la venta TIENE, que es lo mismo que
      -- habria escrito una regeneracion completa: el contrato del numero no
      -- cambia para ninguno de los siete llamadores.
      RETURN (SELECT count(*)::int FROM public.stock_movement sm
               WHERE sm.account_id = v_sale.account_id AND sm.movement_type = 'consumo'
                 AND sm.source_type = 'sale' AND sm.source_id = p_sale_id);
    END IF;
  END IF;

$guarda$;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='generate_sale_consumption';
  if v_src is null then raise exception 'no existe generate_sale_consumption'; end if;
  if position('GUARDA DE IDEMPOTENCIA' in v_src) > 0 then
    raise notice 'la guarda ya estaba puesta: no se toca'; return;
  end if;

  v_src := replace(v_src, '  v_item       uuid;', '  v_item       uuid;' || chr(10) || '  v_igual      boolean;');

  v_n := (length(v_src) - length(replace(v_src, 'IF array_length(v_previos, 1) IS NOT NULL THEN', '')))
         / length('IF array_length(v_previos, 1) IS NOT NULL THEN');
  if v_n <> 1 then raise exception 'el ancla aparece % veces, esperaba 1', v_n; end if;

  v_src := replace(v_src, '  IF array_length(v_previos, 1) IS NOT NULL THEN',
                          v_guarda || chr(10) || '  IF array_length(v_previos, 1) IS NOT NULL THEN');

  execute format(
    'create or replace function public.generate_sale_consumption(p_sale_id uuid) returns integer '
    || 'language plpgsql security definer set search_path = public as %L', v_src);
end $migracion$;

-- La copia de ensayo se va con la misma migración que aplica lo ensayado.
drop function if exists public._gsc_ensayo(uuid);

-- ── VOLVER ATRÁS ────────────────────────────────────────────────────────────
-- do $vuelta$
-- declare v_src text;
-- begin
--   select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='generate_sale_consumption';
--   v_src := regexp_replace(v_src,
--     '  -- ══ GUARDA DE IDEMPOTENCIA.*?  END IF;\n\n(?=  IF array_length\(v_previos)', '', 'gs');
--   v_src := replace(v_src, chr(10) || '  v_igual      boolean;', '');
--   execute format('create or replace function public.generate_sale_consumption(p_sale_id uuid) '
--     || 'returns integer language plpgsql security definer set search_path = public as %L', v_src);
-- end $vuelta$;
