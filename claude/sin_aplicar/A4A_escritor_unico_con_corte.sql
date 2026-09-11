-- ════════════════════════════════════════════════════════════════════════
-- A4a · UN SOLO ESCRITOR DE CONSUMO, Y QUE CONOZCA EL CORTE
--
-- SIN APLICAR. Vive en `claude/sin_aplicar/` a propósito. Se aplica a partir
-- de las 23:45 del reloj de la BASE (`now() at time zone 'Europe/Madrid'`),
-- decidido por Julio el 11/09 tras comprobar que su reloj iba adelantado. Al
-- aplicar se mueve a `supabase/migrations/` con la versión que registre la
-- base (regla 17).
--
-- VUELTA ATRÁS PREPARADA Y PROBADA:
--   claude/vuelta_atras/VUELTA_ATRAS_A4_generate_sale_consumption_20260911.sql
--   (cuerpo anterior, md5 97a3533602349f6cebb7f55f3ab15fc3, 3.595 bytes)
--
-- ── QUÉ CAMBIA ──────────────────────────────────────────────────────────
-- 1) `generate_sale_consumption` pasa a ser el ÚNICO escritor: al regenerar
--    una venta se lleva también los movimientos del motor viejo de esa venta
--    (los que tienen `source_id` = una LÍNEA suya). Sin esto, el duplicado se
--    vuelve a crear solo: los 516 que quedan hoy nacieron así, el 25/08, un
--    reproceso escribiendo el motor A encima de un motor B que sobrevivió a la
--    limpieza del 15/08.
-- 2) Aprende el CORTE POR INGREDIENTE. Un ingrediente cuya última línea de
--    recuento aprobado es posterior a la fecha de la venta NO SE TOCA: ni se
--    borra ni se reescribe. Hoy esta función reescribe por debajo de recuentos
--    cerrados sin preguntar, y eso ya es un fallo de la regla 6 sin A4.
-- 3) Cada movimiento lleva `sale_line_id`: el origen a nivel de línea, en la
--    columna que ya existía y estaba a 0 de 68.582, sin inventar un
--    `source_type` nuevo — que es exactamente el 23514 de A3.
--
-- ── LA VARA DEL CORTE ES LA DEL MOTOR DE RECUENTOS (regla 39) ───────────
-- No se inventa una. `20260825T1000_inventory_system_qty_desde_ledger.sql`
-- define el corte de una línea de recuento como
--     COALESCE(icl.counted_at, ic.started_at, ic.closed_at, ic.created_at)
-- y lo aplica ESTRICTO: el recuento absorbe lo que tiene `occurred_at < corte`.
-- Aquí se usa exactamente eso, y por eso «tocable» es `fecha >= corte`.
--
-- Medirlo con la vara equivocada cambia la respuesta, y lo comprobé en carne
-- propia: con el corte por LOCAL, de los 516 duplicados salían 0 tocables en
-- Carabanchel; con el corte por INGREDIENTE, que es el bueno, salen 16.
--
-- ── LA FECHA ────────────────────────────────────────────────────────────
-- El movimiento se fecha con `sale.created_at` —la fecha del libro—, igual que
-- antes, y el corte se compara contra ESA MISMA fecha. Una sola vara para el
-- asiento y para la decisión. La deuda declarada sigue en pie: lo definitivo
-- es fechar con `sold_at`, y ese día las dos cosas se mueven juntas.
--
-- ── LO QUE NO SE TOCA, SE DICE (regla 8) ────────────────────────────────
-- Cuando el corte protege un ingrediente, la función NO puede limitarse a no
-- hacer nada: eso es un silencio, y un silencio se lee como que funcionó. Deja
-- fila en `sale_consumption_skip` con el ingrediente, el corte y el motivo.
-- Esa tabla es el «informe» que pedía Julio para el caso de la anulación por
-- debajo del corte: no se devuelve el stock —el recuento posterior ya contó lo
-- que había de verdad— y queda escrito por qué y con qué fecha.
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
      FOR SELECT TO authenticated
      USING (public.belongs_to_account(account_id));
  END IF;
END
$pol$;

REVOKE ALL ON TABLE public.sale_consumption_skip FROM PUBLIC;
REVOKE ALL ON TABLE public.sale_consumption_skip FROM anon;
GRANT SELECT ON TABLE public.sale_consumption_skip TO authenticated;
GRANT ALL    ON TABLE public.sale_consumption_skip TO service_role;

COMMENT ON TABLE public.sale_consumption_skip IS
  'Lo que el corte del recuento protegio: ingredientes de una venta que NO se reescriben porque un recuento aprobado posterior ya los cuadro. Es el informe de por que no se toco, no un fallo.';

-- ── (1) La vara del corte, en un solo sitio ─────────────────────────────
-- Una sola definicion. Si manana cambia la del motor de recuentos, cambia
-- aqui y en ningun otro lado: dos definiciones del mismo corte es como se
-- consigue que el ensayo diga una cosa y produccion haga otra.
CREATE OR REPLACE FUNCTION public.ultimo_corte_aprobado(
  p_location_id    uuid,
  p_recipe_item_id uuid
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT max(COALESCE(icl.counted_at, ic.started_at, ic.closed_at, ic.created_at))
    FROM public.inventory_count ic
    JOIN public.inventory_count_line icl ON icl.inventory_count_id = ic.id
   WHERE ic.status = 'aprobado'
     AND ic.location_id = p_location_id
     AND icl.recipe_item_id = p_recipe_item_id
     AND icl.excluded_at IS NULL;
$fn$;

REVOKE ALL ON FUNCTION public.ultimo_corte_aprobado(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ultimo_corte_aprobado(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ultimo_corte_aprobado(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ultimo_corte_aprobado(uuid, uuid) TO service_role;

-- ── (2) El escritor unico ───────────────────────────────────────────────
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
  v_fecha      timestamptz;
  v_written    integer := 0;
  v_borrados   integer := 0;
  v_libres     uuid[] := '{}';
  v_protegidos uuid[] := '{}';
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

  -- ── EL PLAN ───────────────────────────────────────────────────────────
  -- Implicados = lo que esta venta YA tiene apuntado (con cualquiera de las
  -- dos llaves, la de la venta y la vieja de la linea) MAS lo que la receta de
  -- hoy dice que consumiria. Hay que mirar los dos: un ingrediente que sale de
  -- la receta tiene que perder su asiento, y uno que entra tiene que ganarlo.
  WITH lineas AS (
    SELECT sl.id FROM public.sale_line sl WHERE sl.sale_id = p_sale_id
  ),
  previos AS (
    SELECT DISTINCT sm.recipe_item_id AS item
      FROM public.stock_movement sm
     WHERE sm.account_id    = v_sale.account_id
       AND sm.movement_type = 'consumo'
       AND sm.source_type   = 'sale'
       AND (sm.source_id = p_sale_id OR sm.source_id IN (SELECT id FROM lineas))
       AND sm.recipe_item_id IS NOT NULL
  ),
  ahora AS (
    SELECT DISTINCT r.raw_item_id AS item
      FROM public.sale_line sl
      CROSS JOIN LATERAL public._sale_line_raw_consumption(sl.id) r
     WHERE sl.sale_id = p_sale_id
       AND COALESCE(sl.line_type, 'product') = 'product'
       AND sl.ignored_at IS NULL
       -- D1: o la linea esta mapeada, o es la cabecera de un COMBO. Un combo
       -- se resuelve por sus hijos.
       AND (
         sl.menu_item_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.sale_line c
                     WHERE c.parent_sale_line_id = sl.id AND c.line_type = 'combo_item')
       )
       AND r.raw_item_id IS NOT NULL
  ),
  implicados AS (SELECT item FROM previos UNION SELECT item FROM ahora),
  con_corte AS (
    SELECT i.item,
           public.ultimo_corte_aprobado(v_sale.location_id, i.item) AS corte
      FROM implicados i
  )
  SELECT
    COALESCE(array_agg(item) FILTER (WHERE corte IS NULL OR v_fecha >= corte), '{}'),
    COALESCE(array_agg(item) FILTER (WHERE corte IS NOT NULL AND v_fecha < corte), '{}'),
    COALESCE(array_agg(item), '{}')
    INTO v_libres, v_protegidos, v_todos
    FROM con_corte;

  -- ── LO QUE EL CORTE PROTEGE, ESCRITO (regla 8) ────────────────────────
  -- No se toca, y se dice. Con el ingrediente, el corte y el motivo, para que
  -- una anulacion que no devuelve stock tenga una linea que lo explique en vez
  -- de un silencio.
  IF array_length(v_protegidos, 1) IS NOT NULL THEN
    INSERT INTO public.sale_consumption_skip
      (account_id, sale_id, recipe_item_id, location_id, fecha_venta, corte, motivo)
    SELECT v_sale.account_id, p_sale_id, x.item, v_sale.location_id, v_fecha,
           public.ultimo_corte_aprobado(v_sale.location_id, x.item),
           CASE WHEN v_void
                THEN 'anulacion por debajo del corte: no se devuelve stock, el recuento posterior ya conto lo que habia'
                ELSE 'regeneracion por debajo del corte: el recuento posterior ya cuadro este ingrediente'
           END
      FROM unnest(v_protegidos) AS x(item)
    ON CONFLICT (sale_id, recipe_item_id) DO UPDATE
      SET corte       = EXCLUDED.corte,
          fecha_venta = EXCLUDED.fecha_venta,
          motivo      = EXCLUDED.motivo,
          created_at  = now();
  END IF;
  -- Y si un ingrediente deja de estar protegido (se anulo el recuento), su
  -- nota se va: una nota que ya no es verdad miente igual que un silencio.
  DELETE FROM public.sale_consumption_skip s
   WHERE s.sale_id = p_sale_id
     AND s.recipe_item_id = ANY(v_libres);

  -- ── BORRAR, SOLO EN LO LIBRE, LAS DOS LLAVES ──────────────────────────
  -- Aqui se cierra el mecanismo que re-creaba duplicados: el motor viejo de
  -- ESTA venta (llave = la linea) se va con el resto. Pero solo por encima del
  -- corte: por debajo, borrarlo cambiaria un stock que un recuento ya cerro.
  IF array_length(v_libres, 1) IS NOT NULL THEN
    DELETE FROM public.stock_movement sm
     WHERE sm.account_id    = v_sale.account_id
       AND sm.movement_type = 'consumo'
       AND sm.source_type   = 'sale'
       AND (sm.source_id = p_sale_id
            OR sm.source_id IN (SELECT id FROM public.sale_line WHERE sale_id = p_sale_id))
       AND sm.recipe_item_id = ANY(v_libres);
    GET DIAGNOSTICS v_borrados = ROW_COUNT;
  END IF;

  -- ── ESCRIBIR ──────────────────────────────────────────────────────────
  -- UNA FILA POR (LINEA, INGREDIENTE). No es un capricho: al rellenar
  -- `sale_line_id` se despiertan DOS indices unicos que llevaban meses
  -- dormidos —`stock_movement_sale_dedup` y `stock_movement_sale_line_dedup`,
  -- los dos sobre (sale_line_id, recipe_item_id) WHERE source_type='sale'—
  -- que nunca habian mordido porque la columna estaba a NULL en las 68.582
  -- filas. El motor viejo insertaba una fila por cada renglon que devolvia
  -- `_sale_line_raw_consumption`, y ese mismo ingrediente puede venir dos
  -- veces en una linea: una por la receta y otra por un extra. Sumarlos por
  -- (linea, ingrediente) es lo que esos indices dicen que tiene que ser.
  --
  -- Consecuencia medible, y hay que decirla: donde eso pasaba, la venta pasa a
  -- tener MENOS movimientos que antes, con la MISMA cantidad total. El numero
  -- de asientos cambia; el stock no.
  IF NOT v_void AND array_length(v_libres, 1) IS NOT NULL THEN
    INSERT INTO public.stock_movement(
      account_id, location_id, recipe_item_id, movement_type, qty_base,
      unit_cost, source_type, source_id, sale_line_id, occurred_at, notes)
    SELECT
      v_sale.account_id, v_sale.location_id, t.item, 'consumo',
      -- qty_base del teorico viene CON SIGNO: +N consumo, -N remove. Si se
      -- anulan entre ellos, no hay asiento: un cero no es un movimiento.
      -t.qty,
      (SELECT COALESCE(ric.avg_unit_cost, ri.computed_cost)
         FROM public.recipe_item ri
         LEFT JOIN public.recipe_item_location_stock ric
                ON ric.recipe_item_id = ri.id
               AND ric.account_id     = v_sale.account_id
               AND ric.location_id    = v_sale.location_id
        WHERE ri.id = t.item),
      'sale', p_sale_id, t.line, v_fecha, 'Consumo por venta'
      FROM (
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
           AND r.raw_item_id = ANY(v_libres)
         GROUP BY sl.id, r.raw_item_id
        HAVING sum(r.qty_base) <> 0
      ) t;
    GET DIAGNOSTICS v_written = ROW_COUNT;
  END IF;

  -- ── REFRESCAR LA CACHE de todo lo implicado, tocado o no ──────────────
  -- Tambien de lo protegido: no cambia, pero recalcularlo no hace dano y evita
  -- que una cache vieja se confunda con una decision del corte.
  IF v_sale.location_id IS NOT NULL AND array_length(v_todos, 1) IS NOT NULL THEN
    FOREACH v_item IN ARRAY v_todos
    LOOP
      PERFORM public.recompute_location_stock_core(v_item, v_sale.location_id);
    END LOOP;
  END IF;

  RETURN v_written;
END;
$fn$;

-- Los permisos NO se tocan: la funcion ya era postgres | authenticated |
-- service_role y `CREATE OR REPLACE` los conserva. Que `authenticated` pueda
-- llamarla sin guarda de cuenta es una deuda declarada aparte; cerrarla aqui,
-- de madrugada y en la funcion mas caliente, seria meter dos cambios en uno.
DO $acl$
DECLARE v_acl text;
BEGIN
  SELECT array_to_string(p.proacl, ' | ') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'generate_sale_consumption';
  IF v_acl IS DISTINCT FROM 'postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres' THEN
    RAISE EXCEPTION 'A4a: los permisos de generate_sale_consumption han cambiado -> %', COALESCE(v_acl, '(nulo)');
  END IF;
  RAISE NOTICE 'A4a permisos intactos: %', v_acl;
END
$acl$;
