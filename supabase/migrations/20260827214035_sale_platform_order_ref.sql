-- 20260827T2100_sale_platform_order_ref.sql
-- ============================================================================
-- El número largo de Glovo vuelve a tener dónde vivir
-- ============================================================================
-- Por Last.app el ticket llevaba impreso pequeño el número largo de Glovo
-- (101753216562) porque `platform_order_code` ERA ese número. Al pasar a
-- HubRise, `platform_order_code` pasó a ser el `collection_code`, que en Glovo
-- es un código de 3 dígitos. El largo sigue llegando —está en `raw_tab.ref`—
-- pero no se guardaba en ninguna columna, así que el ticket dejó de poder
-- imprimirlo. Es el número que hace falta para reclamar a Glovo.
--
-- Los TRES códigos, que no son lo mismo (verificado en los 11 pedidos de Glovo
-- por HubRise del 27/08):
--
--   columna                Glovo           Just Eat      Uber       para qué
--   pos_short_code         G954            J189793329    U52766     el grande de cocina
--   platform_order_code    954             189793329     52766      el corto que canta el rider
--   platform_order_ref     101755551192    189793329     (uuid)     el largo, reclamaciones
--
-- NO se mete el largo en `platform_order_code`. Ese campo es el código corto
-- que ve el cliente, verificado en 57 de 57 pedidos de Uber y Just Eat, y lo
-- usan el rider y la pantalla: machacarlo rompería dos canales para arreglar uno.
-- ============================================================================

begin;

ALTER TABLE public.sale ADD COLUMN IF NOT EXISTS platform_order_ref text;

COMMENT ON COLUMN public.sale.platform_order_ref IS
  'Referencia LARGA del pedido en la plataforma (HubRise: order.ref). En Glovo es '
  'el nº de 12 dígitos que se usa para reclamar; en Just Eat coincide con '
  'platform_order_code; en Uber es un uuid. NO sustituye a platform_order_code '
  '(el código corto que ve el cliente) ni a pos_short_code (el de cocina).';

-- Relleno de lo ya entrado. Idempotente por el `IS NULL`: se puede repetir.
--
-- Con safe_jsonb() y no con raw_tab::jsonb. Hoy los 231 raw_tab de HubRise
-- parsean (comprobado antes de aplicar: 0 no parseables, 224 con `ref`), pero
-- un cast directo lanza excepción ante un solo raw_tab mal formado y tumbaría
-- la migración ENTERA, columna incluida. safe_jsonb devuelve null y sigue.
UPDATE public.sale s
SET platform_order_ref = nullif(btrim(public.safe_jsonb(s.raw_tab)->>'ref'), '')
WHERE s.source = 'hubrise'
  AND s.raw_tab IS NOT NULL
  AND s.platform_order_ref IS NULL
  AND nullif(btrim(public.safe_jsonb(s.raw_tab)->>'ref'), '') IS NOT NULL;

commit;
