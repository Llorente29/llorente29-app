-- ════════════════════════════════════════════════════════════════════════
-- DOS ARREGLOS AL VIGÍA · aplicado 12/09 09:05 · versión 20260912070517
--
-- 1 · LA CUENTA PLANTILLA NO AVISA. NUNCA. `Folvy Interno` es el catálogo
--     plantilla del sistema: nadie va a arreglar sus datos, así que su aviso
--     estaría ahí para siempre — y un aviso que no se puede cerrar es
--     exactamente el ruido que enseña a no leer los demás (regla 7). Aportaba
--     7 de los 106; el vigía pasa a devolver 99.
--     Su aviso de esta mañana YA SALIÓ: la cola lo drenó antes de que pudiera
--     retirarlo. No se puede deshacer, solo evitar que vuelva.
--
-- 2 · NOMBRES QUE DICEN QUÉ MIRAN. Había dos relojes casi iguales y, la raíz,
--     dos FUNCIONES casi iguales. La mía pasa a
--     `ventas_cerradas_sin_consumo_watchdog` y los relojes a:
--       64 · ventas-cerradas-sin-consumo          · 20 * * * *
--       65 · consumo-fallos-y-atajo-motor-viejo   · 35 * * * *
--
--     MEDIDO: no comparten NINGÚN tipo de aviso. Pero SÍ se solapan en la
--     pregunta: el 65 cuenta ventas con un FALLO REGISTRADO (el motor lo
--     intentó y no pudo); el 64 cuenta ventas SIN CONSUMO, lo intentara o no.
--     Una venta puede estar en las dos. Hoy los fallos son 0, así que no se
--     pisan; estructuralmente sí. El 64 es el superconjunto: es el que caza los
--     silenciosos, que son los que costaron 912 pedidos.
-- ════════════════════════════════════════════════════════════════════════

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
BEGIN
  FOR r IN
    WITH deberia AS (SELECT sale_id FROM public._ventas_que_deberian_descontar()),
         tiene    AS (SELECT sale_id FROM public._ventas_con_consumo())
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
           count(*) FILTER (WHERE COALESCE(s.status,'') = 'closed'
                 AND COALESCE(s.order_status,'') NOT IN ('cancelled','rejected')
                 AND COALESCE(s.is_active, true)
                 AND s.created_at <  now() - interval '24 hours'
                 AND s.created_at >= now() - interval '7 days'
                 AND d.sale_id IS NOT NULL AND t.sale_id IS NULL)                   AS fuga,
           count(*) FILTER (WHERE COALESCE(s.status,'') = 'closed'
                 AND COALESCE(s.order_status,'') NOT IN ('cancelled','rejected')
                 AND COALESCE(s.is_active, true)
                 AND s.created_at < now() - interval '7 days'
                 AND d.sale_id IS NOT NULL AND t.sale_id IS NULL)                   AS arrastre
      FROM public.sale s
      LEFT JOIN public.accounts a ON a.id = s.account_id
      LEFT JOIN deberia d ON d.sale_id = s.id
      LEFT JOIN tiene   t ON t.sale_id = s.id
     -- LA CUENTA PLANTILLA NO AVISA. NUNCA. `Folvy Interno` es el catalogo
     -- plantilla del sistema: nadie va a arreglar sus datos, asi que su aviso
     -- estaria ahi para siempre, y un aviso que no se puede cerrar es
     -- exactamente el ruido que ensena a no leer los demas (regla 7). Si algun
     -- dia la plantilla tiene datos rotos, eso es mantenimiento nuestro, no un
     -- aviso para un cliente. Cualquier vigia nuevo hace lo mismo.
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

    -- ── 3 · CERRADA SIN DESCONTAR ────────────────────────────────────────
    IF r.fuga > 0 THEN
      SELECT string_agg(x.linea, E'\n' ORDER BY x.creada) INTO v_txt FROM (
        SELECT s.created_at AS creada,
               format('%s de %s (%s)',
                 COALESCE(s.pos_short_code, s.platform_order_code, left(s.id::text,8)),
                 COALESCE(l.name,'sin local'),
                 to_char(s.created_at AT TIME ZONE 'Europe/Madrid','DD/MM HH24:MI')) AS linea
          FROM public.sale s LEFT JOIN public.locations l ON l.id = s.location_id
         WHERE s.account_id = r.acc AND COALESCE(s.status,'') = 'closed'
           AND COALESCE(s.order_status,'') NOT IN ('cancelled','rejected')
           AND COALESCE(s.is_active, true)
           AND s.created_at <  now() - interval '24 hours'
           AND s.created_at >= now() - interval '7 days'
           AND s.id IN (SELECT sale_id FROM public._ventas_que_deberian_descontar())
           AND s.id NOT IN (SELECT sale_id FROM public._ventas_con_consumo())
         ORDER BY s.created_at LIMIT 30) x;

      PERFORM public.encolar_alerta(
        p_kind => 'venta_cerrada_sin_descontar',
        p_subject => format('%s: %s pedido(s) cerrados no han descontado del almacén', r.cuenta, r.fuga),
        p_message => 'Cerrados hace más de 24 h, con plato Y receta, y sin un solo movimiento de '
                  || 'consumo. Su comida salió del almacén y el almacén no se ha enterado.' || E'\n'
                  || COALESCE(v_txt,'') || E'\n\n'
                  || format('Arrastre anterior a 7 días en esta cuenta: %s ventas. No entran en esta '
                         || 'alarma porque sus ingredientes están por debajo del corte de su recuento y '
                         || 'el motor no reescribe lo protegido: avisar de ellas cada día no las arregla.',
                         r.arrastre),
        p_debounce_kind => 'venta_cerrada_sin_descontar:' || r.acc::text,
        p_debounce_window => interval '24 hours',
        p_account_id => r.acc, p_location_id => NULL, p_brand_id => NULL, p_severity => 'critico');
    END IF;

    v_total := v_total + r.viva + r.roto_total + r.fuga;
  END LOOP;

  RETURN v_total;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ventas_cerradas_sin_consumo_watchdog() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ventas_cerradas_sin_consumo_watchdog() FROM anon;
REVOKE ALL ON FUNCTION public.ventas_cerradas_sin_consumo_watchdog() FROM authenticated;

COMMENT ON FUNCTION public.ventas_cerradas_sin_consumo_watchdog() IS
  'Cuenta ventas SIN CONSUMO, lo intentara el motor o no — es el superconjunto que caza los silenciosos. Distinto de consumo_sin_descontar_watchdog, que cuenta ventas con un FALLO REGISTRADO. Tres cuentas que no se mezclan y UNA POR CUENTA (regla 9), sin la cuenta plantilla.';

DROP FUNCTION IF EXISTS public.ventas_sin_descontar_watchdog();

SELECT cron.unschedule('ventas-sin-descontar-watchdog');
SELECT cron.unschedule('consumo-sin-descontar-watchdog');
SELECT cron.schedule('ventas-cerradas-sin-consumo', '20 * * * *',
                     $cron$SELECT public.ventas_cerradas_sin_consumo_watchdog()$cron$);
SELECT cron.schedule('consumo-fallos-y-atajo-motor-viejo', '35 * * * *',
                     $cron$SELECT public.consumo_sin_descontar_watchdog()$cron$);
