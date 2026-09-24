-- ENCARGO DEL VIGIA — PUNTO 1 · «la tabla de descartes»
--
-- LA PREMISA SE CUMPLE A MEDIAS, Y HAY QUE DECIRLO. La tabla de descartes YA
-- EXISTE: `sale_consumption_skip`, escrita por generate_sale_consumption en tres
-- sitios, con 4.570 filas vivas de Foodint:
--
--   por debajo del corte ......... 4.504 filas · 544 ventas · 89 ingredientes
--   anulacion bajo el corte .......... 54 filas ·   9 ventas
--   precio indefendible ............... 6 filas ·   3 ventas
--   «ya no lo pide» ................... 6 filas ·   6 ventas
--
-- Lo que NO guarda nadie, en ninguna tabla, es LO ESPERADO: la lista de
-- (linea de venta, ingrediente, cantidad) que el motor iba a consumir. Y ese es
-- el agujero de verdad, porque obliga a RECALCULAR el pasado con el motor de hoy.
--
-- LA MEDIDA QUE LO DEMUESTRA, y es la que el recon del 22/09 no pudo sacar.
-- Misma consulta de cierre, misma ventana (12-22/09), mismo universo:
--
--   casilla                              22/09            24/09
--   1 · sin casar con la carta        29 /   206,13    12 /    25,80
--   2 · sin ficha y sin descontar      7 /    75,10     4 /    40,60
--   3 · con ficha y cero movimientos   6 /    81,60     9 /   116,10
--   3b · recasada en frio                    --        17 /   180,33
--   4 · le falta un ingrediente       93 / 1.897,42  2.154 / 33.070,53
--   5 · el envase nunca            1.710 /24.486,51     0 /     0,00
--   6 · completo                     497 / 7.498,70   146 /   812,10
--   TOTAL                          2.342 /34.245,46  2.342 /34.245,46
--
-- El total cuadra al centimo a los dos lados: el universo es el mismo y no se ha
-- vendido nada nuevo. Pero 2.061 lineas y 31.173 EUR han cambiado de casilla
-- SOLAS, en 48 horas, porque el 23/09 a las 00:01 `explode_recipe_to_raws` empezo
-- a devolver 'packaging'. Ahora el motor «espera» envase en ventas de agosto que
-- nunca lo movieron, y la casilla 4 se las traga antes de que lleguen a la 5.
--
-- Es la misma familia que la deriva de receta que ya estaba anotada, un piso mas
-- arriba: no es que cambie la RECETA, es que cambia el MOTOR. Y contra eso no
-- protege versionar escandallos. Solo protege escribir lo esperado cuando se
-- consume y no volver a calcularlo nunca.
--
-- LO QUE HACE ESTO: congela `base` —la CTE que el motor YA calcula, su propia
-- verdad, no una replica (regla 39)— en una tabla. A partir de ahi la casilla 4
-- es una resta entre dos tablas escritas, inmune a que cambien el motor o la
-- receta. Es literalmente lo que pedia el recon: «solo anade registro, no toca
-- el calculo».
--
-- LO QUE NO HACE: no reprocesa ni una venta, no rellena el pasado (antes de
-- aplicar esto no hay esperado guardado y no se puede inventar) y no cambia ni
-- un movimiento. La casilla 4 seguira sin poderse partir para las ventas
-- anteriores; para las de despues, se contesta leyendo.
--
-- ============================================================================
-- AVISO, Y ES LO PRIMERO: ESTO TOCA `generate_sale_consumption`, que es EL
-- CAMINO DEL PEDIDO. Es la funcion que el 10/09 se llevo por delante 79 entregas
-- por token, 33 cambios de estado, 10 mermas y 7 cierres de venta. Por eso:
--   · va ensayada por los CUATRO CAMINOS (regla 10), no por SELECT;
--   · la tabla nueva no tiene ni un CHECK ni un NOT NULL que pueda saltar con
--     datos que el motor considera validos —ese fue exactamente el 23502 del
--     10/09—; `location_id` es nullable porque v_sale.location_id puede serlo;
--   · las dos escrituras son DISJUNTAS por construccion, como las que ya hay
--     sobre sale_consumption_skip: se borra solo lo que NO esta en `base` y se
--     mete solo lo que SI esta. Dos filas con la misma clave rompen la venta
--     entera con 21000, y eso ya paso una vez.
--   · y NO LA APLICO YO. Se propone; la ejecuta y la verifica Julio.
-- ============================================================================

-- ── 1 · La tabla ────────────────────────────────────────────────────────────
-- Misma forma que sale_consumption_skip: FKs con ON DELETE CASCADE y RLS por
-- cuenta. Si se borra la venta o la ficha, su esperado se va con ella.
CREATE TABLE IF NOT EXISTS public.sale_line_consumo_esperado (
  account_id      uuid        NOT NULL REFERENCES public.accounts(id)    ON DELETE CASCADE,
  sale_id         uuid        NOT NULL REFERENCES public.sale(id)        ON DELETE CASCADE,
  sale_line_id    uuid        NOT NULL REFERENCES public.sale_line(id)   ON DELETE CASCADE,
  recipe_item_id  uuid        NOT NULL REFERENCES public.recipe_item(id) ON DELETE CASCADE,
  location_id     uuid,
  qty_base        numeric     NOT NULL,
  fecha_venta     timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sale_line_id, recipe_item_id)
);

CREATE INDEX IF NOT EXISTS idx_sale_line_consumo_esperado_venta
  ON public.sale_line_consumo_esperado (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_line_consumo_esperado_fecha
  ON public.sale_line_consumo_esperado (account_id, fecha_venta);

ALTER TABLE public.sale_line_consumo_esperado ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_line_consumo_esperado_por_cuenta ON public.sale_line_consumo_esperado;
CREATE POLICY sale_line_consumo_esperado_por_cuenta
  ON public.sale_line_consumo_esperado
  USING (belongs_to_account(account_id));

GRANT SELECT ON public.sale_line_consumo_esperado TO authenticated;

-- ── 2 · El motor escribe lo esperado ────────────────────────────────────────
-- NO SE TRANSCRIBE LA FUNCION. Son 344 lineas y copiarlas a mano para cambiar
-- tres es justo como se cuelan los errores que ni tsc ni las pruebas ven
-- (regla 40, su familia). Se lee lo DESPLEGADO, se le injerta la CTE nueva
-- justo detras de `items`, y se comprueba que el injerto ha entrado: si el
-- ancla no aparece exactamente una vez, esto ABORTA y no deja la funcion a
-- medias.
DO $migracion$
DECLARE
  v_src   text;
  v_new   text;
  v_ancla text := 'items AS (SELECT DISTINCT item FROM base),';
  v_injerto text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'generate_sale_consumption';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'punto 1: generate_sale_consumption no existe';
  END IF;

  IF (length(v_src) - length(replace(v_src, v_ancla, ''))) / length(v_ancla) <> 1 THEN
    RAISE EXCEPTION 'punto 1: el ancla «%» aparece % veces, esperaba 1. La funcion desplegada no es la que se leyo: no se toca.',
      v_ancla, (length(v_src) - length(replace(v_src, v_ancla, ''))) / length(v_ancla);
  END IF;

  IF position('sale_line_consumo_esperado' in v_src) > 0 THEN
    RAISE NOTICE 'punto 1: ya estaba injertado, no se toca';
    RETURN;
  END IF;

  -- LO ESPERADO, CONGELADO. Cuelga de `base`, que es la propia verdad del motor
  -- en ese instante: ni se recalcula ni se replica.
  v_injerto := v_ancla || E'\n' ||
'    -- ── LO ESPERADO, ESCRITO EN EL MOMENTO (punto 1 del encargo del vigia) ──
    -- `base` es lo que el motor va a consumir, ya deduplicado y ya sin los ceros
    -- que se anulan. Guardarlo aqui es lo unico que evita que manana alguien
    -- vuelva a preguntarle al motor de manana por una venta de hoy — que es lo
    -- que movio 2.061 lineas de casilla el 23/09 al empezar a explotar envase.
    -- Las dos escrituras son DISJUNTAS: se borra lo que NO esta en `base`, se
    -- mete lo que SI esta. Nunca tocan la misma fila en la misma sentencia.
    esperado_stale AS (
      DELETE FROM public.sale_line_consumo_esperado e
       USING public.sale_line sl
       WHERE sl.sale_id = p_sale_id
         AND e.sale_line_id = sl.id
         AND NOT EXISTS (SELECT 1 FROM base b
                          WHERE b.line = e.sale_line_id AND b.item = e.recipe_item_id)
      RETURNING 1
    ),
    esperado AS (
      INSERT INTO public.sale_line_consumo_esperado
        (account_id, sale_id, sale_line_id, recipe_item_id, location_id, qty_base, fecha_venta)
      SELECT v_sale.account_id, p_sale_id, b.line, b.item, v_sale.location_id, b.qty, v_fecha
        FROM base b
      ON CONFLICT (sale_line_id, recipe_item_id) DO UPDATE
        SET qty_base = EXCLUDED.qty_base,
            fecha_venta = EXCLUDED.fecha_venta,
            location_id = EXCLUDED.location_id,
            created_at = now()
      RETURNING 1
    ),';

  v_new := replace(v_src, v_ancla, v_injerto);

  IF v_new = v_src OR position('sale_line_consumo_esperado' in v_new) = 0 THEN
    RAISE EXCEPTION 'punto 1: el injerto no ha entrado. No se toca la funcion.';
  END IF;

  EXECUTE v_new;

  -- Y se comprueba LO QUE HA QUEDADO, no el color de la sentencia.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'generate_sale_consumption'
       AND p.prosrc LIKE '%sale_line_consumo_esperado%'
  ) THEN
    RAISE EXCEPTION 'punto 1: la funcion desplegada no lleva el injerto despues del EXECUTE';
  END IF;
END
$migracion$;
