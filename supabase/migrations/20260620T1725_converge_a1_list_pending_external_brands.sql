-- supabase/migrations/20260620T1725_converge_a1_list_pending_external_brands.sql
-- ============================================================================
-- CONVERGENCIA DE INGESTA — Bloque A.1: list_pending_external_brands canónica.
-- ============================================================================
-- ⚠️ CORRIGE un error de una versión anterior de esta migración (la borrada
-- 20260620T1710): aquella basó el retorno en la versión DESFASADA del repo
-- (20260611T2230, 6 columnas) y eliminó folvy_location_id / folvy_location_name,
-- que la función VIVA sí devuelve (8 columnas; confirmado en database.ts y en el
-- mapper listPendingExternalBrands del servicio, que las lee). Eso habría dejado
-- el local vacío en SalesExceptionsPage. La BBDD es la verdad: el repo estaba mal.
--
-- QUÉ CAMBIA DE VERDAD respecto a la función viva:
--   · Catálogo: lastapp_catalog_product → external_catalog_product
--     (+ columna lastapp_brand_name → external_brand_name).
--   · Local: el JOIN que rellena folvy_location_id/_name pasa de lastapp_location_map
--     a external_location_map (que tras E.1 tiene las 6 tiendas), + locations.
--   NO se pierde ninguna columna de retorno: se mantienen las 8, solo cambia la
--   FUENTE del dato del local. Firma y semántica intactas.
--
-- ⚠️ ORDEN: aplicar DESPUÉS de E.1 (20260620T1720), porque ahora el local se
-- resuelve desde external_location_map (sin las 6 filas, folvy_location_* saldría
-- null). Por eso esta migración es 1725 (post-1720), no 1710.
--
-- DROP previo: el retorno NO cambia respecto a la viva (8 col), pero el DROP deja
-- la migración robusta si en algún entorno quedó la versión de 6 col del repo
-- (Postgres no permite cambiar el retorno con CREATE OR REPLACE).
--
-- SECURITY DEFINER, LANGUAGE sql. Sin BEGIN/COMMIT.
-- ============================================================================

DROP FUNCTION IF EXISTS public.list_pending_external_brands(uuid);

CREATE FUNCTION public.list_pending_external_brands(p_account_id uuid)
 RETURNS TABLE (
   source               text,
   external_location_id text,
   external_brand_id     text,
   folvy_location_id    uuid,
   folvy_location_name  text,
   ventas               bigint,
   pista_catalogo       text,
   pista_productos      text
 )
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  WITH lineas AS (
    SELECT
      'lastapp'::text                              AS source,
      l.payload->'data'->>'locationId'             AS ext_loc,
      l.payload->'data'->>'locationBrandId'        AS ext_brand,
      l.id                                         AS log_id,
      p->>'name'                                   AS producto,
      nullif(p->>'catalogProductId','')::uuid      AS cat_prod
    FROM lastapp_webhook_log l
    CROSS JOIN LATERAL jsonb_array_elements(l.payload->'data'->'products') p
    WHERE l.payload->'data'->>'locationBrandId' IS NOT NULL
  ),
  marca_nombre AS (
    -- nombre real de marca: el primer catalogProductId de ese id que resuelve a un nombre
    SELECT DISTINCT ON (ln.source, ln.ext_loc, ln.ext_brand)
      ln.source, ln.ext_loc, ln.ext_brand,
      cp.external_brand_name AS nombre_catalogo
    FROM lineas ln
    JOIN external_catalog_product cp
      ON cp.account_id = p_account_id
     AND cp.catalog_product_id = ln.cat_prod
     AND cp.external_brand_name IS NOT NULL
    ORDER BY ln.source, ln.ext_loc, ln.ext_brand
  ),
  marca_productos AS (
    SELECT source, ext_loc, ext_brand,
           string_agg(producto, ' · ' ORDER BY n DESC) AS pista_productos
    FROM (
      SELECT source, ext_loc, ext_brand, producto, count(*) AS n,
             row_number() OVER (PARTITION BY source, ext_loc, ext_brand ORDER BY count(*) DESC) AS rn
      FROM lineas
      WHERE producto IS NOT NULL
      GROUP BY source, ext_loc, ext_brand, producto
    ) t
    WHERE rn <= 4
    GROUP BY source, ext_loc, ext_brand
  ),
  agg AS (
    SELECT source, ext_loc, ext_brand, count(DISTINCT log_id) AS ventas
    FROM lineas
    GROUP BY source, ext_loc, ext_brand
  )
  SELECT
    a.source,
    a.ext_loc                                AS external_location_id,
    a.ext_brand                              AS external_brand_id,
    lm.location_id                           AS folvy_location_id,
    loc.name                                 AS folvy_location_name,
    a.ventas,
    mn.nombre_catalogo                       AS pista_catalogo,
    mp.pista_productos
  FROM agg a
  LEFT JOIN marca_nombre   mn USING (source, ext_loc, ext_brand)
  LEFT JOIN marca_productos mp USING (source, ext_loc, ext_brand)
  -- Local: CONVERGIDO a external_location_map (antes lastapp_location_map). Ambos
  -- external_location_id son text -> comparación directa, sin ::text.
  LEFT JOIN external_location_map lm
    ON lm.account_id = p_account_id
   AND lm.source = 'lastapp'
   AND lm.external_location_id = a.ext_loc
  LEFT JOIN locations loc
    ON loc.id = lm.location_id
  WHERE NOT EXISTS (
    SELECT 1 FROM external_brand_map m
    WHERE m.account_id = p_account_id
      AND m.source = a.source
      AND m.external_location_id = a.ext_loc
      AND m.external_brand_id = a.ext_brand
  )
  ORDER BY loc.name NULLS LAST, a.ventas DESC;
$function$;
