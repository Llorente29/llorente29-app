-- 20260910091000_conteo_p3_columnas_y_umbrales.sql
--
-- CONTAR POR FORMATOS · PASO 3 (§2.3 y §2.4) — las columnas del freno y de la
-- aprobación, y los umbrales fuera del código.
--
-- 1) `needs_review`: la línea que ya se contó DOS veces y sigue sin cuadrar. No
--    se aplica sola nunca (paso 5): espera a una persona. Es distinto de
--    `within_tolerance = false`, que es «se desvía»: esto es «se desvía y ya
--    hemos gastado el segundo intento».
--
-- 2) `reason_note`: la nota de «Otro». Sin ella, «otro» es un motivo que no
--    dice nada — y hoy son 212 de las 240 líneas con motivo de septiembre en
--    Foodint. Con nota obligatoria, «otro» vuelve a costar lo que cuesta.
--
-- 3) Dos motivos nuevos en palabras de cocina. `uso_sin_apuntar` y
--    `error_conteo` existían en la cabeza de todo el mundo y no en la lista, y
--    lo que no está en la lista acaba en «otro».
--
-- 4) Los umbrales del freno, en `supply_settings` y no escritos en el código:
--    quien los cambie no debería necesitar un despliegue.

BEGIN;

-- ── 1 y 2 · columnas de la línea ──────────────────────────────────────────
ALTER TABLE public.inventory_count_line
  ADD COLUMN IF NOT EXISTS needs_review     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reason_note      text,
  ADD COLUMN IF NOT EXISTS recount_asked_at timestamptz;

COMMENT ON COLUMN public.inventory_count_line.needs_review IS
  'Se contó dos veces y sigue fuera de rango. autoclose_daily_count NO la '
  'aplica: espera a quien aprueba (§2.3/§2.4, 10/09/2026).';
COMMENT ON COLUMN public.inventory_count_line.reason_note IS
  'La nota que acompaña al motivo. OBLIGATORIA cuando el motivo es «otro».';
COMMENT ON COLUMN public.inventory_count_line.recount_asked_at IS
  'Cuándo se le pidió a quien contaba que volviera a mirarlo. Con esto puesto, '
  'el siguiente guardado de la línea se acepta siempre: el freno frena UNA vez, '
  'no deja a nadie atrapado delante de una nevera.';

-- ── 3 · los dos motivos nuevos ────────────────────────────────────────────
-- Un CHECK se reemplaza soltando y volviendo a poner. `error_escandallo` se
-- queda: lo usa Cocina, y hoy tiene 11 líneas vivas en septiembre.
ALTER TABLE public.inventory_count_line
  DROP CONSTRAINT IF EXISTS inventory_count_line_reason_code_check;

ALTER TABLE public.inventory_count_line
  ADD CONSTRAINT inventory_count_line_reason_code_check
  CHECK (reason_code = ANY (ARRAY[
    'merma',            -- se tiró
    'caducado',         -- pasó de fecha
    'rotura',           -- se rompió o derramó
    'uso_sin_apuntar',  -- NUEVO · se usó y no se apuntó
    'traspaso',         -- se llevó a otro local
    'error_recepcion',  -- no se apuntó una entrega
    'error_conteo',     -- NUEVO · se contó mal
    'robo_desconocido', -- falta y no se sabe por qué
    'error_escandallo', -- la receta consume distinto de lo real (Cocina)
    'otro'              -- con nota obligatoria
  ]));

-- «Otro» sin nota deja de poder guardarse. NOT VALID a propósito: las 212
-- líneas de «otro» ya aprobadas de septiembre son historia y no se reescriben
-- —reescribirlas sería inventarles un motivo que nadie dijo—, pero ninguna
-- fila nueva ni ninguna que se toque puede volver a entrar así.
ALTER TABLE public.inventory_count_line
  DROP CONSTRAINT IF EXISTS inventory_count_line_otro_con_nota;
ALTER TABLE public.inventory_count_line
  ADD CONSTRAINT inventory_count_line_otro_con_nota
  CHECK (reason_code <> 'otro' OR btrim(coalesce(reason_note, '')) <> '')
  NOT VALID;

-- ── 4 · los umbrales, fuera del código ────────────────────────────────────
ALTER TABLE public.supply_settings
  -- Freno contra el teórico vivo: ≥ ×3 o ≤ ⅓ manda «vuelve a mirarlo».
  ADD COLUMN IF NOT EXISTS count_recount_factor numeric NOT NULL DEFAULT 3,
  -- Freno contra el último recuento aprobado + lo que se ha movido desde
  -- entonces: apartarse un 40 % sin recepciones de por medio manda lo mismo.
  ADD COLUMN IF NOT EXISTS count_contradiction_pct numeric NOT NULL DEFAULT 40,
  -- En el segundo intento, «repetir el mismo total» con este margen sella la
  -- línea como confirmada dos veces en vez de dejarla para revisar.
  ADD COLUMN IF NOT EXISTS count_repeat_tolerance_pct numeric NOT NULL DEFAULT 5,
  -- Lo que la pantalla de aprobación llama «revisa antes de aprobar»: una
  -- desviación tiene que ser grande EN LOS DOS EJES para pedir atención.
  ADD COLUMN IF NOT EXISTS count_review_pct numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS count_review_eur numeric NOT NULL DEFAULT 5,
  -- Banda de cordura del COSTE de una recepción contra el coste de ficha. Una
  -- recepción fuera de banda no mueve el coste medio hasta que alguien la
  -- corrija: el 07/07 alguien puso 56,02 €/ud en CAJA GENERICA 780 Ml —el
  -- precio de la caja entera, por unidad— y esa sola línea vale 3.193 € de
  -- valor de stock inventado.
  ADD COLUMN IF NOT EXISTS cost_band_factor numeric NOT NULL DEFAULT 5;

COMMENT ON COLUMN public.supply_settings.count_recount_factor IS
  'Factor del freno a ciegas contra el teórico vivo (3 = ≥×3 o ≤⅓ → recount).';
COMMENT ON COLUMN public.supply_settings.count_contradiction_pct IS
  'Cuánto puede apartarse un recuento del anterior aprobado, ajustado por los '
  'movimientos de por medio, antes de considerarse contradicción (%).';
COMMENT ON COLUMN public.supply_settings.cost_band_factor IS
  'Cuántas veces puede apartarse el coste de una recepción del coste de ficha '
  'antes de que deje de mover el coste medio (5 = ×5 arriba o abajo). No la '
  'rechaza ni la borra: la deja fuera de la media y la lista para corregir.';
COMMENT ON COLUMN public.supply_settings.count_review_pct IS
  'Umbral de la pantalla de aprobación: desviación ≥ este % Y ≥ count_review_eur '
  'a coste fiable manda la línea a «Revisa antes de aprobar». ORDENA Y ETIQUETA, '
  'NO ESCONDE: las que no llegan salen igual, en «Cuadran» (regla 7).';

COMMIT;
