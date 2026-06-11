-- ============================================================
-- Migración: 20260611T2230_contrato_ingesta_pending_brands
-- Contrato único de ingesta — Eslabón 3
-- RPC list_pending_external_brands: lista los ids de marca EXTERNOS que han
-- llegado en ventas y AÚN NO están vinculados en external_brand_map, con DOS
-- pistas para que el humano reconozca cada marca:
--   pista_catalogo  = nombre real de marca via catalogProductId→lastapp_catalog_product
--                     (propias: nombre limpio; cedidas sin catalogo importado: null)
--   pista_productos = nombres de producto mas frecuentes de ese id (el "(DC)"/"(KDB)")
-- Agnostica de fuente. Fuente del id: log crudo (todo el historico) + columna nueva.
-- Devuelve por (source, external_location_id, external_brand_id) NO vinculados.
-- RECON 11/06 verificado: catalogProductId cruza con lastapp_catalog_product y da
--   el lastapp_brand_name correcto por locationBrandId (propias). Cedidas → null.
-- SECURITY DEFINER. Diseño: docs/folvy_contrato_ingesta_diseno.md
-- Aplicada: 2026-06-11 (Folvy Interno)
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_pending_external_brands(p_account_id uuid)
 RETURNS TABLE (
   source               text,
   external_location_id text,
   external_brand_id     text,
   ventas               bigint,
   pista_catalogo       text,
   pista_productos      text
 )
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  WITH lineas AS (
    -- una fila por producto de cada ticket que trae marca, con su catalogProductId
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
      cp.lastapp_brand_name AS nombre_catalogo
    FROM lineas ln
    JOIN lastapp_catalog_product cp
      ON cp.account_id = p_account_id
     AND cp.catalog_product_id = ln.cat_prod
     AND cp.lastapp_brand_name IS NOT NULL
    ORDER BY ln.source, ln.ext_loc, ln.ext_brand
  ),
  marca_productos AS (
    -- pista de productos: los 4 nombres mas frecuentes de ese id
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
    a.ventas,
    mn.nombre_catalogo                       AS pista_catalogo,
    mp.pista_productos
  FROM agg a
  LEFT JOIN marca_nombre   mn USING (source, ext_loc, ext_brand)
  LEFT JOIN marca_productos mp USING (source, ext_loc, ext_brand)
  WHERE NOT EXISTS (
    SELECT 1 FROM external_brand_map m
    WHERE m.account_id = p_account_id
      AND m.source = a.source
      AND m.external_location_id = a.ext_loc
      AND m.external_brand_id = a.ext_brand
  )
  ORDER BY a.ventas DESC;
$function$;
