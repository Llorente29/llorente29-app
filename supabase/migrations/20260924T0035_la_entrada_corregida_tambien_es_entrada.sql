-- ENCARGO CODE 23/09 «Que los terminos de la resta sean medibles» — PUNTO 4
--
-- El encargo pedia: «las recepciones que entran como ajuste». Medido, la premisa
-- no se sostiene y hay que decirlo: una recepcion nueva YA escribe 'recepcion'.
--
--   source_type='goods_receipt_line'   movs      euros   con nota «Ajuste de oficina»
--   recepcion                         1.046  69.030,00                             0
--   ajuste                               52   9.503,46                            39
--
-- Los 52 no son recepciones por la puerta equivocada: son CORRECCIONES y
-- ANULACIONES de recepciones que ya entraron bien. Lo escriben a proposito dos
-- funciones, y una lleva la decision firmada dentro:
--
--   adjust_goods_receipt_line, lineas 92-97:
--     if v_had_movement then v_movement_type := 'ajuste';
--     else                   v_movement_type := 'recepcion';   -- entrega que llega tarde
--   -- «ENCARGO CODE (14/08) A.3.bis (decision de Julio)»
--   void_goods_receipt, linea 42: 'ajuste', -qty  -- reverso por anulacion
--
-- O sea: el que escribe esta bien. Donde se pierde el termino es en el que LEE.
--
-- Dos funciones de la misma familia de pantallas no se ponen de acuerdo en que
-- es una entrada:
--   _count_review_context_core  →  source_type='goods_receipt_line'
--                                  OR movement_type IN ('recepcion','traspaso_entrada','apertura')
--   avt_cause_context           →  movement_type = 'recepcion'   ← y solo eso
--
-- Es la familia de la regla 30: la lista con la que se ESCRIBE no puede ser otra
-- que la lista con la que se LEE. Aqui la puerta por la que entra la mercancia
-- ('ajuste' cuando la oficina corrige) no es la puerta por la que se mira.
--
-- LA MEDIDA, sobre la poblacion real (regla 31), cuenta 771648e1 «en_revision»:
--   RAW-00174 Milanesa de Pollo Rebozado, ALB-00146, 2 movimientos de correccion
--     entradas que ve el AVT hoy ........... 0   (no hay ni un 'recepcion' en el periodo)
--     entradas reales por albaran ....... -22,440 kg  (la oficina corrigio a la baja)
--
-- Ensayo en transaccion revertida, llamando al MOTOR (regla 39), como usuario
-- real de la cuenta y no como postgres:
--   filas antes 2 · filas despues 2
--   filas con otro campo movido .......... 0
--   filas con entradas distintas ......... 1
--   delta total de entradas .......... -22,440
--
-- Alcance, a proposito estrecho: se suma 'recepcion' O CUALQUIER movimiento cuyo
-- source_type sea 'goods_receipt_line' — que es exactamente «lo que entro por un
-- albaran», con su signo. El reverso de una anulacion resta, que es la verdad: esa
-- mercancia no entro. NO se copia el resto del criterio de _count_review_context_core
-- ('traspaso_entrada', 'apertura'): esa funcion contesta otra pregunta («que se ha
-- movido desde tu ultimo conteo») y meter la apertura en «entradas» seria falso.
--
-- No toca el motor de consumo, no reprocesa nada, no reescribe ni una fila ya
-- escrita: cambia UNA lectura. Un create or replace de funcion no toma cierre
-- sobre ninguna tabla. Medido: 0 funciones, 0 crons y 0 disparadores la llaman.
--
-- Firma igual (mismos parametros, mismas columnas de vuelta): no aplica la regla 2
-- —no se anade parametro— y no hay que regenerar los tipos del cliente.

CREATE OR REPLACE FUNCTION public.avt_cause_context(p_count_id uuid)
 RETURNS TABLE(recipe_item_id uuid, waste_qty_base numeric, receipts_qty_base numeric, transfers_out_qty_base numeric, used_in_recipes boolean, consumo_incompleto boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_location_id uuid;
  v_closed_at timestamptz;
  v_prev_closed_at timestamptz;
BEGIN
  SELECT account_id, location_id, COALESCE(closed_at, created_at, now())
    INTO v_account_id, v_location_id, v_closed_at
    FROM public.inventory_count WHERE id = p_count_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'avt_cause_context: conteo % no existe', p_count_id;
  END IF;

  IF NOT belongs_to_account(v_account_id) THEN
    RAISE EXCEPTION 'avt_cause_context: sin acceso a la cuenta %', v_account_id;
  END IF;

  SELECT COALESCE(ic.closed_at, ic.created_at) INTO v_prev_closed_at
    FROM public.inventory_count ic
   WHERE ic.location_id = v_location_id
     AND ic.status = 'aprobado'
     AND ic.id <> p_count_id
     AND COALESCE(ic.closed_at, ic.created_at) < v_closed_at
   ORDER BY COALESCE(ic.closed_at, ic.created_at) DESC
   LIMIT 1;
  v_prev_closed_at := COALESCE(v_prev_closed_at, '-infinity'::timestamptz);

  RETURN QUERY
  WITH lines AS (
    SELECT DISTINCT l.recipe_item_id
      FROM public.inventory_count_line l
     WHERE l.inventory_count_id = p_count_id
  ),
  movs AS (
    SELECT
      sm.recipe_item_id,
      COALESCE(SUM(-sm.qty_base) FILTER (WHERE sm.movement_type = 'merma'), 0) AS waste_qty,
      -- ENCARGO 23/09 punto 4 — lo que entra por un albaran cuenta como entrada
      -- aunque la oficina lo haya corregido despues, y resta cuando el albaran se
      -- anula. adjust_goods_receipt_line escribe 'recepcion' la primera vez y
      -- 'ajuste' al corregir (decision de Julio, 14/08, A.3.bis); void_goods_receipt
      -- escribe 'ajuste' negativo al anular. Las tres son la misma puerta. Sumar
      -- solo 'recepcion' dejaba la entrada de la Milanesa en CERO habiendo -22,44 kg.
      COALESCE(SUM(sm.qty_base)  FILTER (WHERE sm.movement_type = 'recepcion'
                                            OR sm.source_type   = 'goods_receipt_line'), 0) AS receipts_qty,
      COALESCE(SUM(-sm.qty_base) FILTER (WHERE sm.movement_type = 'traspaso_salida'), 0) AS transfers_out_qty
    FROM public.stock_movement sm
    JOIN lines ON lines.recipe_item_id = sm.recipe_item_id
    WHERE sm.location_id = v_location_id
      AND sm.occurred_at >  v_prev_closed_at
      AND sm.occurred_at <= v_closed_at
    GROUP BY sm.recipe_item_id
  ),
  -- ¿El artículo es ingrediente (child) de algún escandallo?
  in_recipes AS (
    SELECT DISTINCT rl.child_item_id AS recipe_item_id
      FROM public.recipe_line rl
      JOIN lines ON lines.recipe_item_id = rl.child_item_id
  )
  SELECT
    lines.recipe_item_id,
    COALESCE(movs.waste_qty, 0),
    COALESCE(movs.receipts_qty, 0),
    COALESCE(movs.transfers_out_qty, 0),
    (in_recipes.recipe_item_id IS NOT NULL),
    EXISTS (
      SELECT 1 FROM public.recipe_item ri
       WHERE ri.id = lines.recipe_item_id AND ri.needs_review = true
    )
  FROM lines
  LEFT JOIN movs ON movs.recipe_item_id = lines.recipe_item_id
  LEFT JOIN in_recipes ON in_recipes.recipe_item_id = lines.recipe_item_id;
END;
$function$;
