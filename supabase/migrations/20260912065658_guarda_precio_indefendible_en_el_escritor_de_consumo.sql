-- ════════════════════════════════════════════════════════════════════════
-- LA GUARDA DEL PRECIO INDEFENDIBLE
--
-- APLICADA el 12/09/2026 a las 08:56 (Madrid, reloj de la base), con la
-- ventana abierta. Versión registrada: 20260912065658.
--
-- Decisión de Julio, 12/09: «No se escribe ni un movimiento con precio
-- negativo». Y la guarda no es «negativo», es «precio que no se puede
-- defender»: negativo O más de 20 veces el coste del escandallo.
--
-- POR QUÉ 20x Y NO SOLO EL SIGNO, MEDIDO: 24 artículo-local con el coste medio
-- NEGATIVO (los 24 con su `computed_cost` POSITIVO) y 2 absurdos. El peor no
-- es ninguno de los negativos: es la Albahaca de Plaza Castilla a 7,1536
-- EUR/gramo contra 0,0278 del escandallo —258 veces más—, 41 g valorados en
-- 294,68 EUR. En la regeneración de las 522 esa fila sola valía -84,16 EUR y
-- le daba la vuelta al signo del coste de un local entero: sin ella el coste
-- pasa de 80,72 a 164,88 EUR. Las 6 filas negativas que sí atrapaba una guarda
-- de «negativo» suman -1,44 EUR: calderilla al lado de eso.
--
-- LO QUE YA HABIA ESCRITO, medido al aplicar: 9.876 movimientos de consumo con
-- precio unitario NEGATIVO, 77 artículos, del 12/06 al 09/09, el peor a -69,14
-- EUR/ud. Como en un consumo la cantidad es negativa, precio negativo por
-- cantidad negativa da POSITIVO: el consumo ha estado SUMANDO 7.969,73 EUR al
-- valor del almacén en vez de restarlo. La guarda corta la hemorragia; la
-- historia es trabajo aparte, el del coste medio ponderado.
--
-- EL COSTE CERO SE ESCRIBE, y va NULO. 40 artículo-local tienen el coste medio
-- a cero exacto. Julio: «Entre no mover el almacén y no valorarlo, gana mover
-- el almacén». Se escribe el movimiento, pero con `unit_cost` NULO y no cero:
-- cero dice «es gratis» y nulo dice «no lo sé», que es la verdad. No es un
-- invento: hay 443 movimientos con `unit_cost` nulo y el front ya los cuenta
-- así (`unit_cost == null` -> `sinCoste` en `countApprovalService`).
--
-- ── LO QUE CAZÓ EL ENSAYO, Y HABRÍA TUMBADO EL SERVICIO ─────────────────
-- `sale_consumption_skip.corte` era NOT NULL. Un ingrediente SIN corte y con
-- el precio roto deja una nota sin corte -> 23502 -> y como esto corre en el
-- disparador de cada pedido, se lleva la venta entera por delante. Es
-- exactamente la forma del incidente del 10/09 (la p8 dejó `avg_unit_cost` en
-- NULL contra un `stock_value` NOT NULL y abortó 79 entregas, 33 cambios de
-- estado, 10 mermas y 7 cierres). Por eso la migración suelta el NOT NULL.
--
-- ENSAYADA el 12/09 en una llamada acabada en RAISE EXCEPTION: 0 fallos.
-- P1 negativo fuera con las dos cifras en la nota · P2 idempotente · P3 x21
-- fuera · P4 x19 dentro y la nota vieja borrada · P5 cero escrito con coste
-- NULO · P6 una venta vieja protegida por el corte: escribe 0, movimientos y
-- suma intactos, nota de corte sin cambiar.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sale_consumption_skip ALTER COLUMN corte DROP NOT NULL;

COMMENT ON COLUMN public.sale_consumption_skip.corte IS
  'El corte que protegio al ingrediente, si lo hubo. NULO cuando el motivo no es un corte sino un precio indefendible: un ingrediente sin recuento no tiene corte y la nota tiene que poder escribirse igual.';

CREATE OR REPLACE FUNCTION public.generate_sale_consumption(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_sale       sale%ROWTYPE;
  v_void       boolean;
  v_legacy     boolean;
  v_fecha      timestamptz;
  v_written    integer := 0;
  v_previos    uuid[] := '{}';
  v_libres     uuid[] := '{}';
  v_protegidos uuid[] := '{}';
  v_cortes     timestamptz[] := '{}';
  v_nuevos     uuid[] := '{}';
  v_todos      uuid[] := '{}';
  v_item       uuid;
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- La fecha del libro: la misma con la que se sella el asiento y con la que
  -- se decide el corte. Una sola vara para las dos cosas.
  v_fecha := COALESCE(v_sale.created_at, now());

  -- D2: una venta anulada/rechazada/inactiva NO consume.
  v_void := COALESCE(v_sale.status, '') = 'cancelled'
         OR COALESCE(v_sale.order_status, '') IN ('cancelled', 'rejected')
         OR NOT COALESCE(v_sale.is_active, true);

  -- El motor viejo escribia con la llave de la LINEA. Por encima del corte no
  -- existe ninguna (ver `_corte_motor_viejo`, que es donde vive la fecha y su
  -- medicion), asi que ni se buscan: ese `OR source_id IN (...)` cuesta 28 ms
  -- por venta porque no puede usar `idx_sm_source`, y un pedido de hoy no tiene
  -- por que pagarlo. El vigia de consumo avisa si deja de ser verdad.
  v_legacy := v_fecha < public._corte_motor_viejo();

  -- ── LO QUE ESTA VENTA YA TIENE APUNTADO ───────────────────────────────
  SELECT COALESCE(array_agg(DISTINCT sm.recipe_item_id), '{}') INTO v_previos
    FROM public.stock_movement sm
   WHERE sm.account_id    = v_sale.account_id
     AND sm.movement_type = 'consumo'
     AND sm.source_type   = 'sale'
     AND sm.source_id     = p_sale_id
     AND sm.recipe_item_id IS NOT NULL;

  IF v_legacy THEN
    SELECT COALESCE(array_agg(DISTINCT sm.recipe_item_id), '{}') || v_previos
      INTO v_previos
      FROM public.stock_movement sm
     WHERE sm.account_id    = v_sale.account_id
       AND sm.movement_type = 'consumo'
       AND sm.source_type   = 'sale'
       AND sm.source_id IN (SELECT id FROM public.sale_line WHERE sale_id = p_sale_id)
       AND sm.recipe_item_id IS NOT NULL;
    -- Las dos llaves pueden traer el MISMO ingrediente, y concatenar dos
    -- arrays no lo quita. Si se cuela repetido, la nota de proteccion intenta
    -- escribir dos veces la misma fila y Postgres para la venta entera con
    -- 21000 («ON CONFLICT DO UPDATE command cannot affect row a second time»).
    -- Lo cazo el ensayo C8; en una venta de hoy no pasa nunca, porque solo se
    -- mira una llave.
    SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_previos FROM unnest(v_previos) x;
  END IF;

  -- ── LO VIEJO: se borra lo libre, se apunta lo protegido ───────────────
  IF array_length(v_previos, 1) IS NOT NULL THEN
    SELECT COALESCE(array_agg(i.item)  FILTER (WHERE c.corte IS NULL OR v_fecha >= c.corte), '{}'),
           COALESCE(array_agg(i.item)  FILTER (WHERE c.corte IS NOT NULL AND v_fecha < c.corte), '{}'),
           COALESCE(array_agg(c.corte) FILTER (WHERE c.corte IS NOT NULL AND v_fecha < c.corte), '{}')
      INTO v_libres, v_protegidos, v_cortes
      FROM unnest(v_previos) AS i(item)
      LEFT JOIN public.cortes_aprobados(v_sale.location_id, v_previos) c
             ON c.recipe_item_id = i.item;

    IF array_length(v_protegidos, 1) IS NOT NULL THEN
      INSERT INTO public.sale_consumption_skip
        (account_id, sale_id, recipe_item_id, location_id, fecha_venta, corte, motivo)
      SELECT v_sale.account_id, p_sale_id, x.item, v_sale.location_id, v_fecha, x.corte,
             CASE WHEN v_void
                  THEN 'anulacion por debajo del corte: no se devuelve stock, el recuento posterior ya conto lo que habia'
                  ELSE 'regeneracion por debajo del corte: el recuento posterior ya cuadro este ingrediente'
             END
        FROM unnest(v_protegidos, v_cortes) AS x(item, corte)
      ON CONFLICT (sale_id, recipe_item_id) DO UPDATE
        SET corte = EXCLUDED.corte, fecha_venta = EXCLUDED.fecha_venta,
            motivo = EXCLUDED.motivo, created_at = now();
    END IF;

    IF array_length(v_libres, 1) IS NOT NULL THEN
      -- Una nota que ya no es verdad miente igual que un silencio.
      DELETE FROM public.sale_consumption_skip s
       WHERE s.sale_id = p_sale_id AND s.recipe_item_id = ANY(v_libres);

      DELETE FROM public.stock_movement sm
       WHERE sm.account_id    = v_sale.account_id
         AND sm.movement_type = 'consumo'
         AND sm.source_type   = 'sale'
         AND sm.source_id     = p_sale_id
         AND sm.recipe_item_id = ANY(v_libres);

      -- Aqui se cierra el mecanismo que re-creaba duplicados: el motor viejo
      -- de ESTA venta se va con el resto, pero solo por encima del corte.
      IF v_legacy THEN
        DELETE FROM public.stock_movement sm
         WHERE sm.account_id    = v_sale.account_id
           AND sm.movement_type = 'consumo'
           AND sm.source_type   = 'sale'
           AND sm.source_id IN (SELECT id FROM public.sale_line WHERE sale_id = p_sale_id)
           AND sm.recipe_item_id = ANY(v_libres);
      END IF;
    END IF;
  END IF;

  -- ── LO NUEVO: UNA sola pasada del escandallo ──────────────────────────
  -- `base` se recorre una vez y de ella cuelgan las dos escrituras. Llamar
  -- dos veces a `_sale_line_raw_consumption` costaba 50 ms por venta.
  --
  -- UNA FILA POR (LINEA, INGREDIENTE): al rellenar `sale_line_id` se despierta
  -- el indice unico `stock_movement_sale_line_dedup`, dormido desde siempre
  -- porque la columna estaba a NULL en las 68.582 filas. Tiene razon: el mismo
  -- ingrediente puede venir dos veces en una linea, una por la receta y otra
  -- por un extra. Medido sobre 129 ventas reales: 1.474 renglones pasan a
  -- 1.367 filas y la suma no se mueve (74.950,7183 a los dos lados).
  IF NOT v_void THEN
    WITH base AS (
      SELECT sl.id AS line, r.raw_item_id AS item, sum(r.qty_base) AS qty
        FROM public.sale_line sl
        CROSS JOIN LATERAL public._sale_line_raw_consumption(sl.id) r
       WHERE sl.sale_id = p_sale_id
         AND COALESCE(sl.line_type, 'product') = 'product'
         AND sl.ignored_at IS NULL
         -- D1: o la linea esta mapeada, o es la cabecera de un COMBO.
         AND (
           sl.menu_item_id IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.sale_line c
                       WHERE c.parent_sale_line_id = sl.id AND c.line_type = 'combo_item')
         )
         AND r.raw_item_id IS NOT NULL
         AND r.qty_base IS NOT NULL
       GROUP BY sl.id, r.raw_item_id
      -- qty_base viene CON SIGNO: +N consumo, -N remove. Si se anulan entre
      -- ellos no hay asiento: un cero no es un movimiento.
      HAVING sum(r.qty_base) <> 0
    ),
    items AS (SELECT DISTINCT item FROM base),
    cortes AS (
      SELECT * FROM public.cortes_aprobados(v_sale.location_id,
                      (SELECT array_agg(item) FROM items))
    ),
    -- EL PRECIO SE RESUELVE AQUI, Y CON EL SE DECIDE SI SE PUEDE ESCRIBIR.
    -- Antes se calculaba dentro del propio INSERT y nadie lo miraba: por eso
    -- entraban precios imposibles sin que nada chistara.
    precios AS (
      SELECT i.item,
             (SELECT ric.avg_unit_cost
                FROM public.recipe_item_location_stock ric
               WHERE ric.recipe_item_id = i.item
                 AND ric.account_id  = v_sale.account_id
                 AND ric.location_id = v_sale.location_id)            AS medio,
             (SELECT COALESCE(ri.computed_cost, ri.fixed_cost)
                FROM public.recipe_item ri WHERE ri.id = i.item)      AS escandallo
        FROM items i
    ),
    plan AS (
      SELECT i.item, c.corte,
             (c.corte IS NULL OR v_fecha >= c.corte) AS libre,
             pr.medio, pr.escandallo,
             -- PRECIO INDEFENDIBLE: negativo, o mas de 20 veces el escandallo.
             -- Medido el 12/09: 24 articulo-local con el coste medio NEGATIVO
             -- (los 24 con su computed_cost positivo) y 2 absurdos. El peor no
             -- es ninguno de los negativos: es la Albahaca de Plaza Castilla a
             -- 7,1536 EUR/gramo contra 0,0278 del escandallo — 258 veces mas—,
             -- que ella sola le daba la vuelta al signo del coste de un local
             -- entero. Una guarda de "negativo" no la habria atrapado.
             ( pr.medio < 0
               OR (pr.medio > 0 AND pr.escandallo > 0 AND pr.medio > 20 * pr.escandallo)
             ) AS indefendible
        FROM items i
        LEFT JOIN cortes  c  ON c.recipe_item_id = i.item
        LEFT JOIN precios pr ON pr.item = i.item
    ),
    -- UNA NOTA QUE YA NO ES VERDAD MIENTE IGUAL QUE UN SILENCIO (regla 30).
    -- El DELETE de notas de mas arriba solo mira los ingredientes que YA tenian
    -- movimiento. Uno que se quedo fuera por precio no tiene ninguno, asi que
    -- cuando su precio se arregla y vuelve a escribirse, su nota de "no se
    -- escribio por precio" se queda ahi, mintiendo sobre trabajo que SI esta
    -- hecho. Lo cazo el ensayo P4 subiendo y bajando el precio del mismo
    -- articulo. Los dos conjuntos son disjuntos por construccion —este borra lo
    -- libre y defendible, el de abajo apunta lo protegido o indefendible— asi
    -- que no se pisan dentro de la misma sentencia.
    limpia AS (
      DELETE FROM public.sale_consumption_skip s
       USING plan p
       WHERE s.sale_id = p_sale_id AND s.recipe_item_id = p.item
         AND p.libre AND NOT p.indefendible
      RETURNING s.recipe_item_id
    ),
    notas AS (
      INSERT INTO public.sale_consumption_skip
        (account_id, sale_id, recipe_item_id, location_id, fecha_venta, corte, motivo)
      -- UNA fila por ingrediente, no dos: un ingrediente puede estar protegido
      -- por el corte Y tener el precio roto a la vez, y dos filas con la misma
      -- clave rompen la venta entera con 21000. Manda el corte, porque si esta
      -- protegido no se escribe pase lo que pase con el precio.
      SELECT v_sale.account_id, p_sale_id, p.item, v_sale.location_id, v_fecha, p.corte,
             CASE WHEN NOT p.libre
                  THEN 'regeneracion por debajo del corte: el recuento posterior ya cuadro este ingrediente'
                  ELSE format('precio indefendible: %s EUR frente a %s del escandallo. No se escribe el '
                           || 'movimiento para no meter ese precio en la historia de coste.',
                           round(p.medio, 6), round(p.escandallo, 6))
             END
        FROM plan p WHERE NOT p.libre OR p.indefendible
      ON CONFLICT (sale_id, recipe_item_id) DO UPDATE
        SET corte = EXCLUDED.corte, fecha_venta = EXCLUDED.fecha_venta,
            motivo = EXCLUDED.motivo, created_at = now()
      RETURNING recipe_item_id
    ),
    puesto AS (
      INSERT INTO public.stock_movement(
        account_id, location_id, recipe_item_id, movement_type, qty_base,
        unit_cost, source_type, source_id, sale_line_id, occurred_at, notes)
      SELECT v_sale.account_id, v_sale.location_id, b.item, 'consumo', -b.qty,
        -- EL COSTE, con sus tres casos dichos:
        --   sin coste medio      -> vale el del escandallo, como antes;
        --   coste medio CERO     -> NULO, no cero. Cero dice "es gratis"; nulo
        --                           dice "no lo se", que es la verdad. El front
        --                           ya lo cuenta asi (`unit_cost == null` ->
        --                           sinCoste en countApprovalService). Entre no
        --                           mover el almacen y no valorarlo, gana mover
        --                           el almacen: el movimiento SI se escribe.
        --   coste medio bueno    -> ese.
        CASE WHEN p.medio IS NULL THEN p.escandallo
             WHEN p.medio = 0     THEN NULL
             ELSE p.medio END,
        'sale', p_sale_id, b.line, v_fecha, 'Consumo por venta'
        FROM base b JOIN plan p ON p.item = b.item AND p.libre AND NOT p.indefendible
      RETURNING recipe_item_id
    )
    SELECT count(*)::int, COALESCE(array_agg(DISTINCT recipe_item_id), '{}')
      INTO v_written, v_nuevos
      FROM puesto;
  END IF;

  -- ── REFRESCAR LA CACHE de lo que ha podido cambiar ────────────────────
  v_todos := v_previos || v_nuevos;
  IF v_sale.location_id IS NOT NULL AND array_length(v_todos, 1) IS NOT NULL THEN
    FOR v_item IN SELECT DISTINCT x FROM unnest(v_todos) x WHERE x IS NOT NULL
    LOOP
      PERFORM public.recompute_location_stock_core(v_item, v_sale.location_id);
    END LOOP;
  END IF;

  RETURN v_written;
END;
$fn$;