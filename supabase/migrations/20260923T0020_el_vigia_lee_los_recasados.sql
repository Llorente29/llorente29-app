-- ============================================================================
-- El vigia lee la tabla de recasados
-- ----------------------------------------------------------------------------
-- 23/09/2026. Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710.
-- Julio: «que el vigia lea la tabla de recasados».
--
-- ── POR QUE, Y NO ES UNA ALARMA FALSA TODAVIA ─────────────────────────────
-- El recasado en frio del 23/09 00:08 dejo 463 lineas CON plato y SIN consumo,
-- a proposito. `ventas_cerradas_sin_consumo_watchdog` pregunta al motor si el
-- escandallo de una venta cerrada da renglones: antes esas lineas no daban
-- ninguno (no tenian plato) y ahora SI. O sea que el vigia ha empezado a
-- contarlas como comida que salio del almacen sin que el almacen se entere,
-- que es justo lo que NO son.
--
-- Medido antes de tocar nada, el 23/09 a las 00:12:
--   336 ventas recasadas cerradas
--     4 caen en la ventana de 24 h a 7 dias del vigia
--     0 serian FUGA hoy  <- esas 4 si tienen consumo de sus otras lineas
--    43 se suman al ARRASTRE, que es un numero dentro del mensaje critico
--
-- O sea: **hoy no salta una alarma falsa, pero el vigia ya cuenta mal**, y en
-- cuanto una venta recasada entre en la ventana sin consumo saldria como fuga
-- CRITICA. Se arregla ahora, no cuando suene.
--
-- ── CASILLA PROPIA, NO FILTRO (regla 7) ───────────────────────────────────
-- La tentacion es descontarlas y callar. No: eso es exactamente «sin alertas»
-- habiendo filas. Las 463 lineas EXISTEN y no van a descontar nunca. Asi que
-- salen en una casilla suya, con su nombre y su cifra, en severidad `aviso`
-- —no `critico`, porque no es una averia— y con la misma ventana de 7 dias
-- que la cobertura, que es el otro caso de «esto no es una averia».
--
-- Y el reparto es por LINEA, no por venta:
--   · una venta que aporta renglones por una linea NO recasada sigue siendo
--     FUGA, aunque ademas tenga lineas recasadas. Una averia de verdad no se
--     esconde detras de una linea en frio.
--   · solo cuando TODAS las lineas que aportan son recasadas en frio, la venta
--     va a la casilla nueva.
--
-- `aviso` y no `medio`: el CHECK de `system_alert_queue` solo admite
-- critico / alto / aviso / info. Comprobado antes de escribir (el 12/09 eso
-- se llevo un vigia entero por delante).
--
-- Misma firma, mismo tipo de vuelta: CREATE OR REPLACE es correcto y NO crea
-- sobrecarga (regla 2, que solo muerde al anadir parametros).
--
-- ── ENSAYADA EL 23/09 A LAS 00:18, CON ROLLBACK ───────────────────────────
-- El reparto, medido con la MISMA consulta a los dos lados (regla 31):
--
--   ventana de 7 dias (la real)   23 candidatas · fuga 0 -> 0 · frio 0
--   ventana de 30 dias           156 candidatas · fuga 47 -> 4 · frio 43
--                                 cobertura 109 igual · el reparto cuadra
--
-- Con los datos de HOY el reparto no se ejerce —hoy hay 0 fugas—, y una
-- prueba cuya poblacion no puede fallar es un espejo. Por eso se ensancho la
-- ventana a 30 dias: entran las 43 recasadas y se ve el corte de verdad. No
-- se fabrico ni una fila: es la misma logica mirando mas atras.
--
-- Y lo que importa de ese 47 -> 4 + 43 es el **4**: las averias de verdad
-- siguen saliendo. La casilla nueva no se las traga.
--
-- Tiempo, que es lo que casi tumba este vigia el 12/09 (20.917 ms):
--   ANTES   296 ms, devolvio 77
--   DESPUES 300 ms, devolvio 77
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.sale_line_recast_frio') is null then
    raise exception 'ABORTA: falta public.sale_line_recast_frio. Este vigia la lee.';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='ventas_cerradas_sin_consumo_watchdog'
       and pg_get_functiondef(p.oid) like '%v_cob%')
  then raise exception 'ABORTA: ventas_cerradas_sin_consumo_watchdog no tiene la forma medida el 23/09.'; end if;
end $$;

CREATE OR REPLACE FUNCTION public.ventas_cerradas_sin_consumo_watchdog()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r          record;
  v_total    integer := 0;
  v_txt      text;
  v_cand     uuid[];   -- cerradas de 7 dias que deberian haber descontado y no
  v_fuga     uuid[];   -- de esas, las que el motor SI habria escrito: averia
  v_frio     uuid[];   -- de esas, las que solo aportan por lineas RECASADAS EN FRIO
  v_cob      uuid[];   -- de esas, las que no tenian con que: cobertura
  v_recast   uuid[];   -- ventas con alguna linea recasada en frio (todas las cuentas)
BEGIN
  -- ── PASO 0 · LAS CANDIDATAS, Y SOLO A ESAS SE LES PREGUNTA AL MOTOR ─────
  -- Esto NO puede ir como CTE dentro de la consulta grande, y esta medido:
  -- Postgres INCORPORA las CTE no recursivas referenciadas una sola vez
  -- (desde la 12), asi que `candidatas` y `escribe` se disolvian y el
  -- EXISTS correlacionado acababa colgando de `sale` ENTERA. El vigia
  -- tardaba 20.917 ms y aborte la migracion.
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

  -- Ventas con alguna linea recasada en frio. Se saca UNA vez y cabe en
  -- memoria (336 el 23/09): dentro del bucle seria un correlacionado sobre
  -- `sale` entera, que es el error que ya costo 20 s una vez.
  SELECT COALESCE(array_agg(DISTINCT f.sale_id), '{}'::uuid[]) INTO v_recast
    FROM public.sale_line_recast_frio f;

  -- LA VARA ES LA DEL MOTOR (regla 39), no una copia mia: si el escandallo
  -- de verdad no da ni un renglon, no habia nada que descontar y escribir
  -- cero es lo correcto.
  --
  -- 23/09: el reparto se hace por LINEA. Una venta que aporta renglones por
  -- una linea NO recasada sigue siendo FUGA aunque tenga ademas lineas en
  -- frio: una averia de verdad no se esconde detras de una linea recasada.
  -- Solo cuando TODAS las que aportan son recasadas, la venta es «en frio».
  -- Una sola pasada del motor, no dos.
  SELECT COALESCE(array_agg(q.sale_id) FILTER (WHERE q.aporta_linea_propia), '{}'::uuid[]),
         COALESCE(array_agg(q.sale_id) FILTER (WHERE NOT q.aporta_linea_propia), '{}'::uuid[])
    INTO v_fuga, v_frio
  FROM (
    SELECT sl.sale_id,
           bool_or(NOT EXISTS (SELECT 1 FROM public.sale_line_recast_frio f
                                WHERE f.sale_line_id = sl.id)) AS aporta_linea_propia
      FROM public.sale_line sl
      CROSS JOIN LATERAL public._sale_line_raw_consumption(sl.id) r2
     WHERE sl.sale_id = ANY(v_cand)
       AND COALESCE(sl.line_type,'product') = 'product'
       AND sl.ignored_at IS NULL
       AND r2.raw_item_id IS NOT NULL
       AND COALESCE(r2.qty_base,0) <> 0
     GROUP BY sl.sale_id
  ) q;

  -- Cobertura: las que no aportan NADA, ni propio ni recasado. Sin cambio de
  -- significado: se resta lo que aporta por cualquier via.
  SELECT COALESCE(array_agg(c), '{}'::uuid[]) INTO v_cob
    FROM unnest(v_cand) AS c
   WHERE NOT (c = ANY(v_fuga)) AND NOT (c = ANY(v_frio));

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
           -- OJO: roto_a y roto_b SE SOLAPAN. El titular lleva el recuento SIN
           -- duplicar; el desglose va dentro, que es donde sirve.
           count(*) FILTER (WHERE (COALESCE(s.status,'') = 'open'
                     AND COALESCE(s.order_status,'') IN ('cancelled','rejected','delivery_failed'))
                 OR (COALESCE(s.order_status,'') = 'cancelled' AND s.cancelled_at IS NULL)) AS roto_total,
           count(*) FILTER (WHERE s.id = ANY(v_fuga))                               AS fuga,
           count(*) FILTER (WHERE s.id = ANY(v_frio))                               AS frio,
           count(*) FILTER (WHERE s.id = ANY(v_cob))                                AS cobertura,
           count(*) FILTER (WHERE COALESCE(s.status,'') = 'closed'
                 AND COALESCE(s.order_status,'') NOT IN ('cancelled','rejected')
                 AND COALESCE(s.is_active, true)
                 AND s.created_at < now() - interval '7 days'
                 AND d.sale_id IS NOT NULL AND t.sale_id IS NULL)                   AS arrastre,
           -- 23/09: de ese arrastre, cuantas son recasadas en frio. No se
           -- resta a escondidas: se ensena al lado, que es lo que deja leer
           -- el numero de verdad.
           count(*) FILTER (WHERE COALESCE(s.status,'') = 'closed'
                 AND COALESCE(s.order_status,'') NOT IN ('cancelled','rejected')
                 AND COALESCE(s.is_active, true)
                 AND s.created_at < now() - interval '7 days'
                 AND d.sale_id IS NOT NULL AND t.sale_id IS NULL
                 AND s.id = ANY(v_recast))                                          AS arrastre_frio
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
                         || 'cada dia no las arregla.', r.arrastre)
                  || CASE WHEN r.arrastre_frio > 0 THEN E'\n'
                       || format('De ese arrastre, %s son ventas RECASADAS EN FRÍO el 23/09: tienen '
                              || 'plato y no van a descontar nunca, a propósito. No son avería. '
                              || 'Están en `sale_line_recast_frio`.', r.arrastre_frio)
                     ELSE '' END,
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
        p_debounce_kind => 'ventas_sin_con_que_descontar:' || r.acc::text,
        p_debounce_window => interval '7 days',
        p_account_id => r.acc, p_location_id => NULL, p_brand_id => NULL, p_severity => 'aviso');
    END IF;

    -- ── 5 · RECASADO EN FRIO: TIENE PLATO Y NO VA A DESCONTAR ────────────
    -- Casilla propia, no filtro (regla 7). Estas ventas EXISTEN y su consumo
    -- no esta ni va a estar. Esconderlas seria decir «sin alertas» habiendo
    -- filas; contarlas como fuga seria llamar averia a una decision tomada.
    IF r.frio > 0 THEN
      SELECT string_agg(x.linea, E'\n' ORDER BY x.creada) INTO v_txt FROM (
        SELECT s.created_at AS creada,
               format('%s de %s (%s)',
                 COALESCE(s.pos_short_code, s.platform_order_code, left(s.id::text,8)),
                 COALESCE(l.name,'sin local'),
                 to_char(s.created_at AT TIME ZONE 'Europe/Madrid','DD/MM HH24:MI')) AS linea
          FROM public.sale s LEFT JOIN public.locations l ON l.id = s.location_id
         WHERE s.account_id = r.acc AND s.id = ANY(v_frio)
         ORDER BY s.created_at LIMIT 30) x;

      PERFORM public.encolar_alerta(
        p_kind => 'venta_recasada_en_frio',
        p_subject => format('%s: %s venta(s) casadas en frío, sin consumo a propósito',
                            r.cuenta, r.frio),
        p_message => 'NO es una fuga. Estas ventas se casaron con su plato hacia atrás el 23/09 '
                  || 'SIN generar consumo, por decisión de Julio: recuperar el casado sin '
                  || 'reprocesar stock por debajo del conteo aprobado.' || E'\n'
                  || 'Tienen plato y NUNCA van a tener movimiento de almacén. Eso no se recupera, '
                  || 'y cuadra en el siguiente recuento, no solo.' || E'\n'
                  || 'Cada línea está en `sale_line_recast_frio` con su vía y su importe.' || E'\n'
                  || 'Si una de estas aparece además como fuga, es que tiene OTRA línea sin '
                  || 'recasar: esa sí es avería y sale en el aviso crítico.' || E'\n'
                  || COALESCE(v_txt,''),
        p_debounce_kind => 'venta_recasada_en_frio:' || r.acc::text,
        p_debounce_window => interval '7 days',
        p_account_id => r.acc, p_location_id => NULL, p_brand_id => NULL, p_severity => 'aviso');
    END IF;

    -- La fuga y la cobertura NO se suman: son dos preguntas distintas.
    -- El frio tampoco: no es una averia, es una decision con nombre.
    v_total := v_total + r.viva + r.roto_total + r.fuga;
  END LOOP;

  RETURN v_total;
END;
$function$;

commit;
