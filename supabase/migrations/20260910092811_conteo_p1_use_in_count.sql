-- 20260910092811_conteo_p1_use_in_count.sql
--
-- CONTAR POR FORMATOS · PASO 1 (§2.1 del encargo del 10/09/2026)
--
-- QUÉ HACE: marca qué formatos de compra salen en el móvil de quien cuenta.
-- Un formato de compra («Caja de 6 kg») y un formato de conteo («Bolsa · 2,5 kg»)
-- no son lo mismo: el primero es cómo se pide al proveedor, el segundo es cómo
-- está el producto en la cámara. Hasta hoy Folvy usaba el de compra para las
-- dos cosas, y por eso el móvil ofrecía «Bolsa» tres veces con tres pesos
-- distintos sin decir cuál era cuál.
--
-- EL VALOR INICIAL NO LO DECIDE ESTA MIGRACIÓN, LO DECIDE EL HECHO. Sale
-- `true` únicamente el formato ACTIVO cuyo nombre normalizado no choca con
-- otro peso en el mismo artículo y que no se llama «ud/uni/unidad/u». Todo lo
-- demás nace en `false` y ESPERA a que una persona diga cuál es el bueno
-- (pantalla 5). Elegir yo cuál de las tres bolsas de Pulled Pork es la que
-- llega hoy sería inventarme un hecho del negocio.
--
-- ENSAYO ANTES DE APLICAR (medido el 10/09/2026 con esta misma condición,
-- filtrado por cuenta — regla 9, que las dos cuentas comparten NOMBRES):
--
--   Foodint        275 formatos activos → 189 true · 86 false
--                    (23 false por llamarse «ud/uni/unidad/u», 63 por chocar de peso)
--                    138 de los 194 artículos contados desde el 10/08 quedan con
--                    al menos un formato de conteo.
--   Folvy Interno  306 formatos activos → 206 true · 100 false
--                    (24 por nombre de unidad, 76 por choque de peso)
--
--   Los que más se cuentan y quedan esperando decisión, con nombre:
--     Milanesa Ternera Rebozado (39 conteos)  «Ud» = 0,25 ud  ← un cuarto de unidad
--     Queso Gouda Loncheado     (33)          Paquete 500 g / Paquete 1.000 g
--     Pulled Pork               (31)          Bolsa 1 / 1,3 / 4 kg · Caja 6 / 6,5 kg
--     Queso Mozarela            (30)          Bolsa 1 / 1,5 / 2 kg
--     Pan Hamburguesa           (28)          Caja 60 ud / Caja 80 ud
--     Tortilla Maíz 12 cm       (27)          «Ud» = 20 tortillas
--     Lechuga Romana            (26)          bolsa 1 kg / Bolsa 400 g / Bolsa 650 g
--
-- La guarda `qty_in_base > 0` NO sale del encargo: la pongo porque un formato
-- de peso cero convierte cualquier cantidad contada en 0 sin avisar. Hoy no
-- cambia nada — medido: 0 formatos activos con `qty_in_base <= 0` en las tres
-- cuentas—, y es la red para el día que alguien cree uno.
--
-- ARCHIVAR NO ES BORRAR: esta columna no toca `is_active` ni `archived_at`.
-- Los albaranes y pedidos antiguos siguen apuntando al id del formato que sea.

BEGIN;

ALTER TABLE public.recipe_item_purchase_format
  ADD COLUMN IF NOT EXISTS use_in_count boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.recipe_item_purchase_format.use_in_count IS
  '¿Sale este formato en el móvil de quien cuenta? Lo decide una persona en '
  'Almacén › Cómo se cuenta cada producto. Nace en false cuando el nombre choca '
  'con otro peso o suena a unidad suelta sin serlo (§2.1 del encargo 10/09/2026).';

-- Valor inicial. Solo toca formatos ACTIVOS: los archivados se quedan en false.
WITH activos AS (
  SELECT id, item_id, account_id, qty_in_base, lower(btrim(name)) AS nn
    FROM public.recipe_item_purchase_format
   WHERE is_active AND archived_at IS NULL
),
choca AS (
  -- Mismo artículo, mismo nombre normalizado, más de un peso: nadie sabe cuál es.
  SELECT item_id, nn
    FROM activos
   GROUP BY item_id, nn
  HAVING count(DISTINCT qty_in_base) > 1
)
UPDATE public.recipe_item_purchase_format f
   SET use_in_count = true,
       updated_at   = now()
  FROM activos a
 WHERE f.id = a.id
   AND a.qty_in_base > 0
   AND a.nn NOT IN ('ud', 'uni', 'unidad', 'u')
   AND NOT EXISTS (SELECT 1 FROM choca c WHERE c.item_id = a.item_id AND c.nn = a.nn);

-- Índice del camino caliente: «dame los formatos de conteo de este artículo».
CREATE INDEX IF NOT EXISTS idx_ripf_conteo
  ON public.recipe_item_purchase_format (item_id, account_id)
  WHERE use_in_count AND is_active AND archived_at IS NULL;

COMMIT;
