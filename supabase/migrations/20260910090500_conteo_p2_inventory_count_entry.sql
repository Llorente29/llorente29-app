-- 20260910090500_conteo_p2_inventory_count_entry.sql
--
-- CONTAR POR FORMATOS · PASO 2a (§2.2) — CÓMO SE CONTÓ
--
-- Hasta hoy `inventory_count_line.counted_qty` guardaba un número pelado en
-- unidad base y nada más. «9000» no dice si son nueve paquetes de un kilo, una
-- caja, o un kilo mal tecleado. Sin eso, quien aprueba no puede juzgar, y la
-- pantalla de aprobación no tiene qué enseñar en la columna «cómo se contó».
--
-- Una línea tiene VARIAS entradas: dos bolsas cerradas + 750 g pesados son dos
-- filas aquí y un solo `counted_qty = 5750` allí. El total lo calcula el
-- servidor sumando esto (paso 2b), nunca el móvil.
--
-- LOS CUATRO MÉTODOS, y el porqué de que 'cero' sea uno de ellos:
--   formato  · N unidades de un formato de conteo   → qty × format.qty_in_base
--   peso     · gramos/ml/unidades en la báscula     → qty (ya en base)
--   fraccion · cuánto hay de un formato, a ojo       → fraction × format.qty_in_base
--              (¼, ½, ¾ · o «Otra», que puede pasar de 1)
--   cero     · «no queda nada de este producto»     → 0, dicho a propósito
--
-- Un campo vacío NO es cero. Es la diferencia entre «he mirado y no hay» y «no
-- lo he mirado», y hasta hoy Folvy las guardaba igual. Por eso 'cero' es un
-- método con su fila, no la ausencia de filas.

BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_count_entry (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  line_id     uuid NOT NULL REFERENCES public.inventory_count_line(id) ON DELETE CASCADE,

  -- El formato con el que se contó. NULL cuando se pesó o cuando es un cero:
  -- ahí no hay envase de referencia. NO lleva ON DELETE CASCADE a propósito —
  -- un formato no se borra, se archiva (§2.1), y si algún día alguien lo
  -- borrase a mano preferimos que la BBDD lo impida a perder el cómo se contó.
  format_id   uuid REFERENCES public.recipe_item_purchase_format(id),

  -- Lo que tecleó la persona, en SU unidad: 2 (bolsas), 750 (gramos).
  qty         numeric,
  -- Solo para 'fraccion': 0.25, 0.5 o 0.75 del formato.
  fraction    numeric,
  -- Lo mismo, ya en unidad base del artículo. Es lo único que se suma.
  qty_in_base numeric NOT NULL,

  method      text NOT NULL CHECK (method IN ('formato','peso','fraccion','cero')),

  -- Qué intento es. 1 el primero; 2 el de después de «vuelve a mirarlo». Los
  -- intentos NO se pisan: se guardan los dos. Sin esto, la pantalla de
  -- aprobación no puede decir «primero puso 0 y al volver a mirarlo puso 8,5 kg»,
  -- que es exactamente la frase que hacía falta la noche del peperoni.
  attempt     smallint NOT NULL DEFAULT 1 CHECK (attempt >= 1),

  counted_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Coherencia de cada método, en la BBDD y no en el front: la puerta de
  -- escritura del paso 2b es la única que escribe aquí, pero la tabla no se
  -- fía de ella. Un CHECK que sobra no cuesta nada; el que falta, sí.
  CONSTRAINT ice_metodo_coherente CHECK (
    CASE method
      WHEN 'formato'  THEN format_id IS NOT NULL AND qty      IS NOT NULL AND qty      > 0 AND fraction IS NULL
      -- `fraction` es CUÁNTOS de ese formato hay, a ojo. Normalmente ¼, ½ o ¾,
      -- pero puede pasar de 1: «Otra · + bolsa» de la pantalla 2 es el caso de
      -- que haya dos bolsas abiertas y media. Lo que la marca como estimada es
      -- el método, no que sea menor que uno.
      WHEN 'fraccion' THEN format_id IS NOT NULL AND fraction IS NOT NULL AND fraction > 0
      WHEN 'peso'     THEN qty IS NOT NULL AND qty >= 0 AND fraction IS NULL
      WHEN 'cero'     THEN qty_in_base = 0 AND fraction IS NULL
    END
  ),
  CONSTRAINT ice_base_no_negativa CHECK (qty_in_base >= 0)
);

CREATE INDEX IF NOT EXISTS idx_ice_line ON public.inventory_count_entry (line_id, attempt);
CREATE INDEX IF NOT EXISTS idx_ice_account ON public.inventory_count_entry (account_id);

COMMENT ON TABLE public.inventory_count_entry IS
  'Cómo se contó cada línea de inventario: una fila por formato, peso, fracción '
  'a ojo o cero explícito. counted_qty de la línea es la SUMA de qty_in_base de '
  'las entradas del ÚLTIMO intento, y la calcula save_count_line en servidor '
  '(§2.2, 10/09/2026). Los intentos anteriores se conservan.';

ALTER TABLE public.inventory_count_entry ENABLE ROW LEVEL SECURITY;

-- Misma política que `inventory_count_line`: la cuenta manda. Quien puede ver
-- la línea puede ver cómo se contó.
DROP POLICY IF EXISTS inventory_count_entry_all ON public.inventory_count_entry;
CREATE POLICY inventory_count_entry_all ON public.inventory_count_entry
  FOR ALL
  USING (public.belongs_to_account(account_id))
  WITH CHECK (public.belongs_to_account(account_id));

COMMIT;
