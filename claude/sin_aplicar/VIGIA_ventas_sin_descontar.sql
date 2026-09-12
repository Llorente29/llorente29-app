-- ════════════════════════════════════════════════════════════════════════
-- EL VIGÍA DE LAS VENTAS QUE NO DESCUENTAN
--
-- Sale de la causa raíz medida el 12/09: 912 pedidos cerrados sin descontar
-- durante dos meses y CERO avisos. Regla 8: el silencio se lee como que
-- funcionó. Mientras nadie cuente esto, vuelve a pasar y nadie se entera.
--
-- TRES cuentas que NO se mezclan, cada una con su pregunta y su silencio:
--   1) COMANDA VIVA SIN CERRAR (>24 h).
--   2) ESTADO IMPOSIBLE: `status='open'` con el pedido muerto, o
--      `order_status='cancelled'` sin `cancelled_at`.
--   3) CERRADA SIN DESCONTAR (>24 h, últimos 7 días). Es la fuga.
--
-- UNA PASADA POR CUENTA (regla 9). La primera versión contó las tres cuentas
-- juntas y dio 158 donde Foodint tiene 113: dentro iban 14 de `Folvy Interno`
-- —el catálogo plantilla del sistema— y 4 comandas vivas de Kitchen Grill que
-- nadie habría visto. Un número sin cuenta no da un número equivocado: da un
-- número QUE NO ES DE NADIE, y además escondía el único hallazgo del otro
-- cliente. Cada aviso lleva su `account_id` y su propio freno, para que llegue
-- a quien puede arreglarlo y para que una cuenta no silencie a otra.
--
-- EL UMBRAL DE 24 H ESTÁ MEDIDO, NO ELEGIDO (regla 39). Sobre 994 ventas de
-- los últimos 10 días: el consumo NO se escribe al entrar el pedido, se
-- escribe al cerrar la comanda. Mediana 125 min en Last, 648 de 669 entre 2 y
-- 12 h. Por debajo de 12 h el vigía ladraría cada noche contra el
-- funcionamiento normal. 24 h deja el doble del peor caso medido.
--
-- LA ALARMA MIRA 7 DÍAS Y EL ARRASTRE SE DICE (regla 7). Hay 2.659 ventas
-- viejas sin descontar que NO se pueden recuperar: sus ingredientes están por
-- debajo del corte de su recuento y el escritor único no reescribe lo
-- protegido. Avisar de ellas cada día no las arregla y a la tercera nadie lo
-- lee. Así que la ALARMA es de 7 días, pero el arrastre VA ESCRITO DENTRO del
-- aviso: un contador puede contar solo lo prioritario; lo que no puede es
-- decir «0» habiendo filas.
-- ════════════════════════════════════════════════════════════════════════

-- ── Las dos varas, en un solo sitio y POR CONJUNTOS ─────────────────────
-- No son un adorno: el cron de reproceso ya tiene SU propia definición de
-- «tenía que descontar» y SU propio corte, distintos de los del motor. Dos
-- definiciones de lo mismo es como se consigue que el vigía vigile otra cosa.
--
-- Devuelven el CONJUNTO, no responden venta a venta. La primera versión
-- preguntaba por cada fila y el vigía tardaba más de 60 s sobre 10.275
-- ventas: inservible para correr cada hora. La definición sigue estando en un
-- solo sitio; lo que cambia es que se une una vez.

CREATE OR REPLACE FUNCTION public._ventas_que_deberian_descontar()
RETURNS TABLE(sale_id uuid)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  -- El plato tiene que tener RECETA, no solo estar mapeado: un plato sin
  -- receta no descuenta, y eso es correcto, no una fuga. (Es la causa 2 del
  -- 12/09: 29 líneas apuntan a platos que siguen sin receta.)
  SELECT DISTINCT sl.sale_id
    FROM public.sale_line sl
    LEFT JOIN public.menu_item mi ON mi.id = sl.menu_item_id
   WHERE COALESCE(sl.line_type,'product') = 'product'
     AND sl.ignored_at IS NULL
     AND ( mi.recipe_item_id IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.sale_line c
                       WHERE c.parent_sale_line_id = sl.id AND c.line_type = 'combo_item') );
$fn$;

CREATE OR REPLACE FUNCTION public._ventas_con_consumo()
RETURNS TABLE(sale_id uuid)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  -- Las DOS llaves: la venta (motor A) y la línea (motor B). Mirar solo una
  -- daría por no descontada una venta que sí lo está.
  SELECT DISTINCT COALESCE(sl.sale_id, sm.source_id)
    FROM public.stock_movement sm
    LEFT JOIN public.sale_line sl ON sl.id = sm.source_id
   WHERE sm.movement_type = 'consumo' AND sm.source_type = 'sale';
$fn$;

REVOKE ALL ON FUNCTION public._ventas_que_deberian_descontar() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ventas_que_deberian_descontar() FROM anon;
REVOKE ALL ON FUNCTION public._ventas_que_deberian_descontar() FROM authenticated;
REVOKE ALL ON FUNCTION public._ventas_con_consumo() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ventas_con_consumo() FROM anon;
REVOKE ALL ON FUNCTION public._ventas_con_consumo() FROM authenticated;

CREATE OR REPLACE FUNCTION public.ventas_sin_descontar_watchdog()
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

REVOKE ALL ON FUNCTION public.ventas_sin_descontar_watchdog() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ventas_sin_descontar_watchdog() FROM anon;
REVOKE ALL ON FUNCTION public.ventas_sin_descontar_watchdog() FROM authenticated;

COMMENT ON FUNCTION public.ventas_sin_descontar_watchdog() IS
  'Tres cuentas que no se mezclan, UNA POR CUENTA (regla 9): comanda viva sin cerrar (>24 h), venta en estado imposible, y venta cerrada que no ha descontado (>24 h, 7 dias). El umbral de 24 h esta medido: el consumo se escribe al cerrar la comanda, no al entrar el pedido.';
