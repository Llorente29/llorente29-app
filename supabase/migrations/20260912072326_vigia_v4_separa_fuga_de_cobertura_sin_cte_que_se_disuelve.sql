-- ════════════════════════════════════════════════════════════════════════════
-- VIGIA v4 · separa FUGA de COBERTURA, y lo hace en 1,5 s
--
-- QUE CAMBIA (lo pidio Julio el 12/09):
--   «"Pedido cerrado sin descontar" solo cuenta cuando TENIA con que
--    descontar. Lo demas es COBERTURA, no averia. Una linea, una vez a la
--    semana, y no cada hora. Las dos cifras se dan por cuenta y no se suman
--    entre si.»
--   Kitchen Grill LstQ tiene 0 platos, 0 fichas, 0 lineas de escandallo y 0
--   movimientos: sus 27 ventas de 7 dias no son una fuga, son una carta sin
--   escandallos. Avisar de eso cada hora con severidad `critico` es el ruido
--   que ensena a no leer los avisos de verdad.
--
-- LA VARA ES LA DEL MOTOR (regla 39): `escribiria` le pregunta al escandallo
-- de verdad, `_sale_line_raw_consumption`, no a una copia mia del criterio.
--
-- POR QUE v4 Y NO v3: la v3 hacia lo mismo con CTEs y ABORTO al aplicarla,
-- «El vigia tarda 20917 ms: demasiado para correr cada hora». Medido despues,
-- paso a paso, sobre produccion:
--     _ventas_que_deberian_descontar()   9.651 filas ......... 35 ms
--     _ventas_con_consumo()              6.611 filas ......... 65 ms
--     candidatas de 7 dias ................................... 29
--     lineas de producto de esas 29 .............. 46 de 29.756
--     el motor sobre esas 46 lineas ....................... 1.344 ms
-- O sea: el trabajo no era el problema, el PLAN lo era. Postgres INCORPORA
-- las CTE no recursivas referenciadas una sola vez (desde la 12), asi que
-- `candidatas` y `escribe` se disolvian y el EXISTS correlacionado acababa
-- colgando de `sale` ENTERA. En variables plpgsql el plan ya no puede
-- reordenar. Ensayado antes de aplicar: 1.561 ms, 0 fallos.
--
-- LA CADENCIA SEMANAL DE LA COBERTURA la pone el freno de repeticion de
-- 7 dias, no un cron aparte: el vigia sigue corriendo cada hora por la fuga,
-- que es lo que urge, y la cobertura solo sale una vez por semana.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ventas_cerradas_sin_consumo_watchdog()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r          record;
  v_total    integer := 0;
  v_txt      text;
  v_cand     uuid[];   -- cerradas de 7 dias que deberian haber descontado y no
  v_fuga     uuid[];   -- de esas, las que el motor SI habria escrito: averia
  v_cob      uuid[];   -- de esas, las que no tenian con que: cobertura
BEGIN
  -- ── PASO 0 · LAS CANDIDATAS, Y SOLO A ESAS SE LES PREGUNTA AL MOTOR ─────
  -- Esto NO puede ir como CTE dentro de la consulta grande, y esta medido:
  -- Postgres INCORPORA las CTE no recursivas referenciadas una sola vez
  -- (desde la 12), asi que `candidatas` y `escribe` se disolvian y el
  -- EXISTS correlacionado acababa colgando de `sale` ENTERA. El vigia
  -- tardaba 20.917 ms y aborte la migracion.
  --
  -- Cronometrado el 12/09 sobre produccion, paso a paso:
  --   _ventas_que_deberian_descontar()  9.651 filas ...... 35 ms
  --   _ventas_con_consumo()             6.611 filas ...... 65 ms
  --   candidatas de 7 dias ............................... 29
  --   lineas de producto de esas 29 ...... 46 de 29.756
  --   el motor sobre esas 46 lineas ................... 1.344 ms
  --
  -- En variables plpgsql el plan ya no puede reordenar: `= ANY(v_cand)` es
  -- una constante en tiempo de plan, el indice de sale_line filtra primero
  -- y el lateral solo puede correr sobre las filas que sobreviven.
  SELECT COALESCE(array_agg(q.id), '{}'::uuid[]) INTO v_cand FROM (
    SELECT s.id
      FROM public.sale s
      LEFT JOIN public._ventas_que_deberian_descontar() d ON d.sale_id = s.id
      LEFT JOIN public._ventas_con_consumo()            t ON t.sale_id = s.id
     WHERE COALESCE(s.status,'') = 'closed'
       AND COALESCE(s.order_status,'') NOT IN ('cancelled','rejected')
       AND COALESCE(s.is_active, true)
       AND s.created_at <  now() - interval '24 hours'
       AND s.created_at >= now() - interval '7 days'
       AND s.account_id <> '00000000-0000-0000-0000-000000000001'::uuid
       AND d.sale_id IS NOT NULL AND t.sale_id IS NULL
  ) q;

  -- LA VARA ES LA DEL MOTOR (regla 39), no una copia mia: si el escandallo
  -- de verdad no da ni un renglon, no habia nada que descontar y escribir
  -- cero es lo correcto. Kitchen Grill son 27 de estas: 0 platos, 0 fichas,
  -- 0 lineas de escandallo, 0 movimientos.
  SELECT COALESCE(array_agg(DISTINCT sl.sale_id), '{}'::uuid[]) INTO v_fuga
    FROM public.sale_line sl
    CROSS JOIN LATERAL public._sale_line_raw_consumption(sl.id) r2
   WHERE sl.sale_id = ANY(v_cand)
     AND COALESCE(sl.line_type,'product') = 'product'
     AND sl.ignored_at IS NULL
     AND r2.raw_item_id IS NOT NULL
     AND COALESCE(r2.qty_base,0) <> 0;

  SELECT COALESCE(array_agg(c), '{}'::uuid[]) INTO v_cob
    FROM unnest(v_cand) AS c WHERE NOT (c = ANY(v_fuga));

  FOR r IN
    SELECT s.account_id AS acc,
           COALESCE(a.name, s.account_id::text) AS cuenta,
           count(*) FILTER (WHERE COALESCE(s.status,'') = 'open'
                 AND COALESCE(s.order_status,'') NOT IN ('cancelled','rejected','delivery_failed')
                 AND s.cancelled_at IS NULL AND COALESCE(s.is_active, true)
                 AND s.created_at < now() - interval '24 hours')                    AS viva,
           count(*) FILTER (WHERE COALESCE(s.status,'') = 'open'
                 AND COALESCE(s.order_status,'') IN ('cancelled','rejected','delivery_failed')) AS roto_a,
           count(*) FILTER (WHERE COALESCE(s.order_status,'') = 'cancelled'
                 AND s.cancelled_at IS NULL)                                        AS roto_b,
           -- OJO: roto_a y roto_b SE SOLAPAN. En Foodint son 48 y 63, pero las
           -- ventas distintas son 66, no 111: 45 estan en las dos listas a la
           -- vez. El titular lleva el recuento SIN duplicar; el desglose va
           -- dentro, que es donde sirve.
           count(*) FILTER (WHERE (COALESCE(s.status,'') = 'open'
                     AND COALESCE(s.order_status,'') IN ('cancelled','rejected','delivery_failed'))
                 OR (COALESCE(s.order_status,'') = 'cancelled' AND s.cancelled_at IS NULL)) AS roto_total,
           count(*) FILTER (WHERE s.id = ANY(v_fuga))                               AS fuga,
           count(*) FILTER (WHERE s.id = ANY(v_cob))                                AS cobertura,
           count(*) FILTER (WHERE COALESCE(s.status,'') = 'closed'
                 AND COALESCE(s.order_status,'') NOT IN ('cancelled','rejected')
                 AND COALESCE(s.is_active, true)
                 AND s.created_at < now() - interval '7 days'
                 AND d.sale_id IS NOT NULL AND t.sale_id IS NULL)                   AS arrastre
      FROM public.sale s
      LEFT JOIN public.accounts a ON a.id = s.account_id
      LEFT JOIN public._ventas_que_deberian_descontar() d ON d.sale_id = s.id
      LEFT JOIN public._ventas_con_consumo()            t ON t.sale_id = s.id
     WHERE s.account_id <> '00000000-0000-0000-0000-000000000001'::uuid
     GROUP BY s.account_id, COALESCE(a.name, s.account_id::text)
  LOOP
    -- ── 1 · COMANDA VIVA SIN CERRAR ──────────────────────────────────────
    IF r.viva > 0 THEN
      SELECT string_agg(x.linea, E'\n' ORDER BY x.creada) INTO v_txt FROM (
        SELECT s.created_at AS creada,
               format('%s de %s (%s)',
                 COALESCE(s.pos_short_code, s.platform_order_code, left(s.id::text,8)),
                 COALESCE(l.name,'sin local'),
                 to_char(s.created_at AT TIME ZONE 'Europe/Madrid','DD/MM HH24:MI')) AS linea
          FROM public.sale s LEFT JOIN public.locations l ON l.id = s.location_id
         WHERE s.account_id = r.acc AND COALESCE(s.status,'') = 'open'
           AND COALESCE(s.order_status,'') NOT IN ('cancelled','rejected','delivery_failed')
           AND s.cancelled_at IS NULL AND COALESCE(s.is_active, true)
           AND s.created_at < now() - interval '24 hours'
         ORDER BY s.created_at LIMIT 30) x;

      PERFORM public.encolar_alerta(
        p_kind => 'comanda_viva_sin_cerrar',
        p_subject => format('%s: %s comanda(s) llevan más de 24 h abiertas', r.cuenta, r.viva),
        p_message => 'Son comandas VIVAS: nadie las ha anulado ni rechazado. Mientras no se '
                  || 'cierren, su consumo no se descuenta del almacén.' || E'\n' || COALESCE(v_txt,''),
        p_debounce_kind => 'comanda_viva_sin_cerrar:' || r.acc::text,
        p_debounce_window => interval '24 hours',
        p_account_id => r.acc, p_location_id => NULL, p_brand_id => NULL, p_severity => 'alto');
    END IF;

    -- ── 2 · ESTADO IMPOSIBLE ─────────────────────────────────────────────
    IF r.roto_total > 0 THEN
      SELECT string_agg(x.linea, E'\n' ORDER BY x.local) INTO v_txt FROM (
        SELECT COALESCE(l.name,'sin local') AS local,
               format('%s: %s con la comanda abierta y el pedido muerto, %s anuladas sin fecha',
                 COALESCE(l.name,'sin local'),
                 count(*) FILTER (WHERE COALESCE(s.status,'')='open'
                       AND COALESCE(s.order_status,'') IN ('cancelled','rejected','delivery_failed')),
                 count(*) FILTER (WHERE COALESCE(s.order_status,'')='cancelled'
                       AND s.cancelled_at IS NULL)) AS linea
          FROM public.sale s LEFT JOIN public.locations l ON l.id = s.location_id
         WHERE s.account_id = r.acc
           AND ( (COALESCE(s.status,'')='open'
                  AND COALESCE(s.order_status,'') IN ('cancelled','rejected','delivery_failed'))
              OR (COALESCE(s.order_status,'')='cancelled' AND s.cancelled_at IS NULL) )
         GROUP BY COALESCE(l.name,'sin local')) x;

      -- Ventana de 7 días a propósito: esto no cambia de un día para otro ni se
      -- arregla en caliente. Avisar cada mañana de lo mismo es la forma más
      -- rápida de que se deje de leer.
      PERFORM public.encolar_alerta(
        p_kind => 'venta_en_estado_imposible',
        p_subject => format('%s: %s venta(s) en un estado que no puede existir',
                            r.cuenta, r.roto_total),
        p_message => 'NO son comandas vivas: son datos rotos, y no tocan el almacén.' || E'\n'
                  || format('· %s con `status=open` y el pedido anulado, rechazado o con reparto fallido.', r.roto_a) || E'\n'
                  || format('· %s con `order_status=cancelled` y `cancelled_at` vacío: nadie las anuló.', r.roto_b) || E'\n'
                  || '(Las dos listas se solapan: una venta puede estar en las dos.)' || E'\n'
                  || 'Si el estado lo puso un proceso nuestro, el arreglo va en el proceso, no a mano.' || E'\n'
                  || COALESCE(v_txt,''),
        p_debounce_kind => 'venta_en_estado_imposible:' || r.acc::text,
        p_debounce_window => interval '7 days',
        p_account_id => r.acc, p_location_id => NULL, p_brand_id => NULL, p_severity => 'alto');
    END IF;

    -- ── 3 · FUGA: CERRADA SIN DESCONTAR TENIENDO CON QUE ──────────────────
    IF r.fuga > 0 THEN
      SELECT string_agg(x.linea, E'\n' ORDER BY x.creada) INTO v_txt FROM (
        SELECT s.created_at AS creada,
               format('%s de %s (%s)',
                 COALESCE(s.pos_short_code, s.platform_order_code, left(s.id::text,8)),
                 COALESCE(l.name,'sin local'),
                 to_char(s.created_at AT TIME ZONE 'Europe/Madrid','DD/MM HH24:MI')) AS linea
          FROM public.sale s LEFT JOIN public.locations l ON l.id = s.location_id
         WHERE s.account_id = r.acc AND s.id = ANY(v_fuga)
         ORDER BY s.created_at LIMIT 30) x;

      PERFORM public.encolar_alerta(
        p_kind => 'venta_cerrada_sin_descontar',
        p_subject => format('%s: %s pedido(s) cerrados no han descontado del almacén', r.cuenta, r.fuga),
        p_message => 'Cerrados hace más de 24 h, con escandallo que SÍ da renglones, y sin un solo '
                  || 'movimiento de consumo. Su comida salió del almacén y el almacén no se ha '
                  || 'enterado.' || E'\n'
                  || COALESCE(v_txt,'') || E'\n\n'
                  || format('Arrastre anterior a 7 días en esta cuenta: %s ventas, contadas con la '
                         || 'vara BARATA (plato con ficha), no con la del motor: preguntarle al '
                         || 'escandallo por todas tardaba mas de 60 s. Es una cota alta, no una cifra '
                         || 'fina. No entran en la alarma porque sus ingredientes estan por debajo del '
                         || 'corte de su recuento y el motor no reescribe lo protegido: avisar de ellas '
                         || 'cada dia no las arregla.', r.arrastre),
        p_debounce_kind => 'venta_cerrada_sin_descontar:' || r.acc::text,
        p_debounce_window => interval '24 hours',
        p_account_id => r.acc, p_location_id => NULL, p_brand_id => NULL, p_severity => 'critico');
    END IF;

    -- ── 4 · COBERTURA: NO TENIA CON QUE DESCONTAR ────────────────────────
    IF r.cobertura > 0 THEN
      PERFORM public.encolar_alerta(
        p_kind => 'ventas_sin_con_que_descontar',
        p_subject => format('%s: %s venta(s) de 7 dias no tenian con que descontar', r.cuenta, r.cobertura),
        p_message => 'NO es una fuga: es cobertura. Estas ventas se cerraron bien, pero su plato '
                  || 'no tiene escandallo, asi que no habia nada que descontar y el motor hizo lo '
                  || 'correcto escribiendo cero.' || E'\n'
                  || 'Se arregla poniendo la carta y los escandallos de esa cuenta, no tocando el '
                  || 'motor. Va una vez por semana a proposito: no es una averia.',
        -- `aviso`, no `medio`: la regla de `system_alert_queue` solo admite
        -- critico / alto / aviso / info, y `medio` habria reventado contra el
        -- CHECK llevandose el vigia entero. Comprobado antes de aplicar.
        p_debounce_kind => 'ventas_sin_con_que_descontar:' || r.acc::text,
        p_debounce_window => interval '7 days',
        p_account_id => r.acc, p_location_id => NULL, p_brand_id => NULL, p_severity => 'aviso');
    END IF;

    -- La fuga y la cobertura NO se suman: son dos preguntas distintas.
    v_total := v_total + r.viva + r.roto_total + r.fuga;
  END LOOP;

  RETURN v_total;
END;
$fn$;

-- ── HUELLA · fichero == aplicado, y UNA sola firma (regla 2) ───────────────
DO $huellas$
DECLARE v_md5 text; v_firmas int;
BEGIN
  SELECT count(*) INTO v_firmas FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='ventas_cerradas_sin_consumo_watchdog';
  IF v_firmas <> 1 THEN
    RAISE EXCEPTION 'ventas_cerradas_sin_consumo_watchdog tiene % firmas, no 1', v_firmas;
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='ventas_cerradas_sin_consumo_watchdog';
  IF v_md5 <> '80c55fe22cb7502a152dd3d097526475' THEN
    RAISE EXCEPTION 'md5 del vigia instalado = %, esperaba 80c55fe22cb7502a152dd3d097526475', v_md5;
  END IF;
END $huellas$;
