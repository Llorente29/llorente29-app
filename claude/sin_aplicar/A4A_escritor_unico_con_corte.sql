-- ════════════════════════════════════════════════════════════════════════
-- A4a · UN SOLO ESCRITOR DE CONSUMO, Y QUE CONOZCA EL CORTE
--
-- SIN APLICAR. Se aplica a partir de las 23:45 del reloj de la BASE
-- (`now() at time zone 'Europe/Madrid'`). Al aplicar se mueve a
-- `supabase/migrations/` con la versión que registre la base (regla 17).
--
-- VUELTA ATRÁS PREPARADA Y PROBADA:
--   claude/vuelta_atras/VUELTA_ATRAS_A4_generate_sale_consumption_20260911.sql
--   (cuerpo anterior, md5 97a3533602349f6cebb7f55f3ab15fc3, 3.595 bytes)
--
-- ── QUÉ CAMBIA ──────────────────────────────────────────────────────────
-- 1) `generate_sale_consumption` es el ÚNICO escritor: al regenerar una venta
--    se lleva también los movimientos del motor viejo de ESA venta. Sin esto
--    el duplicado se re-crea solo: los 516 que quedan hoy nacieron así el
--    25/08, un reproceso escribiendo el motor A encima de un motor B que
--    sobrevivió a la limpieza del 15/08.
-- 2) CORTE POR INGREDIENTE. Un ingrediente cuya última línea de recuento
--    aprobado es posterior a la fecha de la venta no se toca: ni se borra ni
--    se reescribe. Hoy esta función reescribe por debajo de recuentos cerrados
--    sin preguntar, y eso ya es un fallo de la regla 6 sin A4.
-- 3) `sale_line_id` en cada asiento: el origen por línea, en la columna que ya
--    existía, sin inventar un `source_type` — que es el 23514 de A3.
-- 4) `revert_sale_consumption` y `reprocess_sale` dejan de borrar por su
--    cuenta. Un solo escritor quiere decir un solo borrador también.
--
-- ── LA VARA DEL CORTE ES LA DEL MOTOR DE RECUENTOS (regla 39) ───────────
-- `20260825T1000_inventory_system_qty_desde_ledger.sql` define el corte de una
-- línea como COALESCE(counted_at, started_at, closed_at, created_at) y lo
-- aplica ESTRICTO (el recuento absorbe lo de `occurred_at < corte`). Aquí se
-- usa eso mismo, y por eso «tocable» es `fecha >= corte`. Vive en
-- `cortes_aprobados`, un solo sitio: dos definiciones del mismo corte es como
-- se consigue que el ensayo diga una cosa y producción haga otra.
--
-- Medirlo con la vara equivocada cambia la respuesta, y lo pagué: con el corte
-- por LOCAL, de los 516 duplicados salían 0 tocables en Carabanchel; con el
-- corte por INGREDIENTE salen 16.
--
-- ── LA FECHA ────────────────────────────────────────────────────────────
-- El asiento se fecha con `sale.created_at` —la fecha del libro—, igual que
-- antes, y el corte se compara contra ESA misma fecha. Una sola vara para el
-- asiento y para la decisión. Deuda declarada: lo definitivo es `sold_at`, y
-- ese día las dos cosas se mueven juntas.
--
-- ── TIEMPO: MEDIDO, PORQUE ESTO CORRE EN CADA PEDIDO ────────────────────
-- Sobre las MISMAS 60 ventas reales, antes y después (regla 31):
--
--   versión                                     mediana   p95     max
--   motor actual                                 72,9 ms  121,6   149,6
--   1ª: corte llamado por ingrediente           243,0 ms  376,0   445,7
--   2ª: corte en una pasada + índice            169,8 ms  265,7   314,4
--   3ª: + sin el OR de las dos llaves           119,9 ms  206,7   265,5
--   4ª: + UNA sola pasada del escandallo  →      77,3 ms  130,7   156,5
--
-- El techo que puso Julio era p95 < 150 ms. La primera versión lo triplicaba.
-- Medido por partes, el coste estaba en tres sitios y ninguno era el corte en
-- sí: `_sale_line_raw_consumption` (50/81 ms) se llamaba DOS veces; buscar los
-- movimientos previos con `OR source_id IN (…)` (28/28 ms) no puede usar
-- `idx_sm_source`; y `ultimo_corte_aprobado`, al ser SECURITY DEFINER, no se
-- puede incrustar y pagaba una llamada por ingrediente.
--
-- Los tres arreglos, en orden de lo que dieron:
--   · El escandallo se recorre UNA vez, con CTEs que escriben (`notas`,
--     `puesto`) colgando de la misma pasada.
--   · La llave vieja sólo se busca si la venta puede tenerla: la última fila
--     del motor B es del 03/08 (medido), así que por debajo de 04/08 se mira y
--     por encima no. Una venta de hoy no paga ese peaje.
--   · El corte se pide UNA vez por lado, en bloque, con `cortes_aprobados`, y
--     con un índice nuevo sobre `inventory_count_line (recipe_item_id,
--     inventory_count_id)`, que no existía.
--
-- ── LO QUE NO SE TOCA, SE DICE (regla 8) ────────────────────────────────
-- Cuando el corte protege un ingrediente, no basta con no hacer nada: un
-- silencio se lee como que funcionó. Deja fila en `sale_consumption_skip` con
-- el ingrediente, el corte y el motivo. Es el informe que pidió Julio para la
-- anulación por debajo del corte: no se devuelve el stock —el recuento
-- posterior ya contó lo que había— y queda escrito por qué y con qué fecha.
--
-- ── EL ÍNDICE GEMELO ────────────────────────────────────────────────────
-- Hay DOS índices únicos idénticos sobre (sale_line_id, recipe_item_id) WHERE
-- source_type='sale'. Ninguno respalda una restricción (comprobado en
-- `pg_constraint`), así que uno sobra y se borra: se queda
-- `stock_movement_sale_line_dedup`, que es el que se llama como lo que hace.
-- ════════════════════════════════════════════════════════════════════════

-- ── (0) La tabla donde se apunta lo que el corte protege ────────────────
CREATE TABLE IF NOT EXISTS public.sale_consumption_skip (
  account_id     uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sale_id        uuid        NOT NULL REFERENCES public.sale(id) ON DELETE CASCADE,
  recipe_item_id uuid        NOT NULL REFERENCES public.recipe_item(id) ON DELETE CASCADE,
  location_id    uuid,
  fecha_venta    timestamptz NOT NULL,
  corte          timestamptz NOT NULL,
  motivo         text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sale_id, recipe_item_id)
);

ALTER TABLE public.sale_consumption_skip ENABLE ROW LEVEL SECURITY;

DO $pol$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.sale_consumption_skip'::regclass
                    AND polname = 'sale_consumption_skip_por_cuenta') THEN
    CREATE POLICY sale_consumption_skip_por_cuenta ON public.sale_consumption_skip
      FOR SELECT TO authenticated USING (public.belongs_to_account(account_id));
  END IF;
END
$pol$;

REVOKE ALL ON TABLE public.sale_consumption_skip FROM PUBLIC;
REVOKE ALL ON TABLE public.sale_consumption_skip FROM anon;
GRANT SELECT ON TABLE public.sale_consumption_skip TO authenticated;
GRANT ALL    ON TABLE public.sale_consumption_skip TO service_role;

COMMENT ON TABLE public.sale_consumption_skip IS
  'Lo que el corte del recuento protegio: ingredientes de una venta que NO se reescriben porque un recuento aprobado posterior ya los cuadro. Es el informe de por que no se toco, no un fallo.';

-- ── (1) El indice que faltaba ───────────────────────────────────────────
-- Sin el, cada consulta del corte se comia la tabla entera de lineas de
-- recuento. 6.172 filas y 2,3 MB: se crea en un parpadeo, pero toma un lock de
-- escritura sobre `inventory_count_line`. Por eso va a las 23:45, cuando no
-- hay nadie contando.
CREATE INDEX IF NOT EXISTS idx_icl_item_count
  ON public.inventory_count_line (recipe_item_id, inventory_count_id);

-- ── (2) El indice gemelo que sobra ──────────────────────────────────────
DROP INDEX IF EXISTS public.stock_movement_sale_dedup;

-- ── (3) La vara del corte, en un solo sitio y en bloque ─────────────────
-- Devuelve el corte de MUCHOS ingredientes de una vez. No es SECURITY DEFINER
-- a proposito: asi Postgres puede incrustarla, y eso es la diferencia entre
-- una llamada por ingrediente y una consulta por venta.
CREATE OR REPLACE FUNCTION public.cortes_aprobados(
  p_location_id uuid,
  p_items       uuid[]
)
RETURNS TABLE(recipe_item_id uuid, corte timestamptz)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT icl.recipe_item_id,
         max(COALESCE(icl.counted_at, ic.started_at, ic.closed_at, ic.created_at))
    FROM public.inventory_count_line icl
    JOIN public.inventory_count ic ON ic.id = icl.inventory_count_id
   WHERE icl.recipe_item_id = ANY(p_items)
     AND icl.excluded_at IS NULL
     AND ic.status = 'aprobado'
     AND ic.location_id = p_location_id
   GROUP BY icl.recipe_item_id;
$fn$;

REVOKE ALL ON FUNCTION public.cortes_aprobados(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cortes_aprobados(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.cortes_aprobados(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cortes_aprobados(uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.cortes_aprobados(uuid, uuid[]) IS
  'El corte de cada ingrediente en un local: la ultima linea de recuento APROBADO, con la misma vara que usa el motor de recuentos. Es LA definicion; nadie escribe otra.';

-- ── (4) EL ESCRITOR UNICO ───────────────────────────────────────────────
-- Misma firma (uuid -> integer), asi que CREATE OR REPLACE no crea sobrecarga
-- (regla 2). La llaman `tg_sale_consumption_on_complete`,
-- `tg_sale_line_consumption`, `close_sale`, `reprocess_sale` y
-- `recompute_sales_consumption`: cambiar la firma las rompe todas a la vez.
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

  -- El motor viejo escribia con la llave de la LINEA. Su ultima fila es del
  -- 03/08 (medido sobre las 3.277 que quedan), asi que una venta posterior no
  -- puede tener ninguna y no hace falta ni mirar. Buscarlas cuesta 28 ms por
  -- venta porque el `OR source_id IN (...)` no puede usar `idx_sm_source`, y
  -- ese peaje no lo paga un pedido de hoy.
  v_legacy := v_fecha < TIMESTAMPTZ '2026-08-04 00:00:00+02';

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
    plan AS (
      SELECT i.item, c.corte, (c.corte IS NULL OR v_fecha >= c.corte) AS libre
        FROM items i LEFT JOIN cortes c ON c.recipe_item_id = i.item
    ),
    notas AS (
      INSERT INTO public.sale_consumption_skip
        (account_id, sale_id, recipe_item_id, location_id, fecha_venta, corte, motivo)
      SELECT v_sale.account_id, p_sale_id, p.item, v_sale.location_id, v_fecha, p.corte,
             'regeneracion por debajo del corte: el recuento posterior ya cuadro este ingrediente'
        FROM plan p WHERE NOT p.libre
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
        (SELECT COALESCE(ric.avg_unit_cost, ri.computed_cost)
           FROM public.recipe_item ri
           LEFT JOIN public.recipe_item_location_stock ric
                  ON ric.recipe_item_id = ri.id
                 AND ric.account_id     = v_sale.account_id
                 AND ric.location_id    = v_sale.location_id
          WHERE ri.id = b.item),
        'sale', p_sale_id, b.line, v_fecha, 'Consumo por venta'
        FROM base b JOIN plan p ON p.item = b.item AND p.libre
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

-- ── (5) LOS OTROS DOS QUE BORRABAN POR SU CUENTA ────────────────────────
-- «Un solo escritor» tiene que querer decir tambien «un solo borrador». Estas
-- dos borraban consumo sin mirar ningun corte, asi que anular o reprocesar una
-- venta vieja devolvia stock por debajo de un recuento cerrado. Es el mismo
-- fallo de la regla 6, por otra puerta.
--
-- `revert_sale_consumption` pasa a marcar el camino corto: si la venta ya esta
-- anulada, el escritor unico hace exactamente lo que hay que hacer —quitar lo
-- libre, respetar lo protegido y dejar la nota—. Si no lo esta, borra lo libre
-- con el mismo corte y deja la nota de lo demas.
CREATE OR REPLACE FUNCTION public.revert_sale_consumption(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_sale     sale%ROWTYPE;
  v_fecha    timestamptz;
  v_legacy   boolean;
  v_previos  uuid[] := '{}';
  v_libres   uuid[] := '{}';
  v_protegidos uuid[] := '{}';
  v_cortes   timestamptz[] := '{}';
  v_deleted  integer := 0;
  v_n        integer := 0;
  v_item     uuid;
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_fecha  := COALESCE(v_sale.created_at, now());
  v_legacy := v_fecha < TIMESTAMPTZ '2026-08-04 00:00:00+02';

  SELECT COALESCE(array_agg(DISTINCT sm.recipe_item_id), '{}') INTO v_previos
    FROM public.stock_movement sm
   WHERE sm.movement_type = 'consumo' AND sm.source_type = 'sale'
     AND sm.source_id = p_sale_id AND sm.recipe_item_id IS NOT NULL;
  IF v_legacy THEN
    SELECT COALESCE(array_agg(DISTINCT sm.recipe_item_id), '{}') || v_previos
      INTO v_previos
      FROM public.stock_movement sm
     WHERE sm.movement_type = 'consumo' AND sm.source_type = 'sale'
       AND sm.source_id IN (SELECT id FROM public.sale_line WHERE sale_id = p_sale_id)
       AND sm.recipe_item_id IS NOT NULL;
  END IF;
  IF array_length(v_previos, 1) IS NULL THEN RETURN 0; END IF;

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
           'anulacion por debajo del corte: no se devuelve stock, el recuento posterior ya conto lo que habia'
      FROM unnest(v_protegidos, v_cortes) AS x(item, corte)
    ON CONFLICT (sale_id, recipe_item_id) DO UPDATE
      SET corte = EXCLUDED.corte, fecha_venta = EXCLUDED.fecha_venta,
          motivo = EXCLUDED.motivo, created_at = now();
  END IF;

  IF array_length(v_libres, 1) IS NOT NULL THEN
    DELETE FROM public.stock_movement sm
     WHERE sm.movement_type = 'consumo' AND sm.source_type = 'sale'
       AND sm.source_id = p_sale_id AND sm.recipe_item_id = ANY(v_libres);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_legacy THEN
      DELETE FROM public.stock_movement sm
       WHERE sm.movement_type = 'consumo' AND sm.source_type = 'sale'
         AND sm.source_id IN (SELECT id FROM public.sale_line WHERE sale_id = p_sale_id)
         AND sm.recipe_item_id = ANY(v_libres);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_deleted := v_deleted + v_n;
    END IF;
  END IF;

  IF v_sale.location_id IS NOT NULL THEN
    FOREACH v_item IN ARRAY v_previos
    LOOP
      PERFORM public.recompute_location_stock_core(v_item, v_sale.location_id);
    END LOOP;
  END IF;

  RETURN v_deleted;
END;
$fn$;

-- `reprocess_sale` borraba el motor viejo por su cuenta y sin corte. Ya no
-- hace falta: el escritor unico se lo lleva, y con el corte delante. Se le
-- quita el DELETE y se queda con lo suyo, que es re-adaptar y recalcular.
CREATE OR REPLACE FUNCTION public.reprocess_sale(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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

  -- (Aqui habia un DELETE sin corte. Lo hace `generate_sale_consumption`, que
  --  es el unico que sabe que puede borrar y que no.)

  IF v_source = 'lastapp' THEN
    PERFORM public.resolve_sale_brand_from_map(p_sale_id);
  END IF;

  IF v_source = 'hubrise' THEN
    PERFORM public.adapt_hubrise_order(p_sale_id);
  ELSE
    PERFORM public.adapt_lastapp_order(p_sale_id);
  END IF;

  FOR v_line_id IN
    SELECT id FROM sale_line
    WHERE sale_id = p_sale_id AND line_type = 'product'
  LOOP
    PERFORM public.compute_sale_line_cost(v_line_id);
    v_n := v_n + 1;
  END LOOP;

  PERFORM public.generate_sale_consumption(p_sale_id);

  IF v_loc IS NOT NULL THEN
    FOREACH v_item IN ARRAY COALESCE(v_old_items, '{}'::uuid[])
    LOOP
      PERFORM public.recompute_location_stock_core(v_item, v_loc);
    END LOOP;
  END IF;

  RETURN v_n;
END;
$fn$;

-- ── (6) LOS PERMISOS, MEDIDOS DENTRO DE LA MIGRACION ────────────────────
-- No se tocan: `CREATE OR REPLACE` los conserva. Que `authenticated` pueda
-- llamar a estas dos sin guarda de cuenta es una deuda declarada aparte;
-- cerrarla aqui, de madrugada y en el camino de los pedidos, seria meter dos
-- cambios en uno. Pero si algo los hubiera movido, esto aborta.
DO $acl$
DECLARE v_gen text; v_rev text;
BEGIN
  SELECT array_to_string(p.proacl, ' | ') INTO v_gen FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'generate_sale_consumption';
  SELECT array_to_string(p.proacl, ' | ') INTO v_rev FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'revert_sale_consumption';
  IF v_gen IS DISTINCT FROM 'postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres'
     OR v_rev IS DISTINCT FROM 'postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres' THEN
    RAISE EXCEPTION 'A4a: permisos movidos -> generate=[%] revert=[%]', v_gen, v_rev;
  END IF;
  RAISE NOTICE 'A4a permisos intactos';
END
$acl$;
