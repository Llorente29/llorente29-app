-- Lo que el `dry_run` de A1 tiene que poder contestar antes de que nadie
-- ejecute nada: de TODAS las referencias de extras que han llegado en pedidos
-- de marcas CEDIDAS, ¿cuantas estan en el catalogo de la organizacion como
-- `om.modifierId`? Si no salen casi todas, se para (§4 de la respuesta de
-- Julio del 11/09).
--
-- Vive en SQL y no en la funcion de borde porque la pregunta «¿es cedida?» se
-- contesta con `brand.ownership_type`, y llegar a la marca desde una linea de
-- extra son tres saltos: linea -> linea padre -> menu_item -> brand. Hacerlo
-- por PostgREST seria reconstruir a mano un join que aqui es una linea.
--
-- CEDIDA ES LA MARCA, NO EL ORIGEN. El 11/09 lo medi por
-- `external_source = 'lastapp'` y me salieron 408 lineas donde hay 175: las
-- otras 233 son de marcas PROPIAS que entraron con origen `lastapp` (etiqueta
-- vieja de la importacion de junio, la ultima del 27/08). Anclar por el origen
-- en vez de por la marca da un numero que no es de nadie.
CREATE OR REPLACE FUNCTION public.modificadores_cobertura_de_codigos(
  p_account_id  uuid,
  p_catalog_ids text[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH refs AS (
    SELECT DISTINCT sl.external_product_id ref
      FROM public.sale_line sl
      JOIN public.sale s          ON s.id = sl.sale_id
      LEFT JOIN public.sale_line padre ON padre.id = sl.parent_sale_line_id
      LEFT JOIN public.menu_item mi    ON mi.id = padre.menu_item_id
      JOIN public.brand b         ON b.id = COALESCE(mi.brand_id, s.brand_id)
     WHERE sl.account_id = p_account_id
       AND sl.line_type  = 'modifier'
       AND sl.external_source = 'lastapp'
       AND sl.external_product_id IS NOT NULL
       AND b.ownership_type = 'licensed'
       AND COALESCE(s.status,'') <> 'cancelled'
       AND COALESCE(s.order_status,'') NOT IN ('cancelled','rejected')
       AND COALESCE(s.is_active, true)
  ),
  cat AS (SELECT DISTINCT unnest(COALESCE(p_catalog_ids, '{}'::text[])) id)
  SELECT jsonb_build_object(
    'refs_en_pedidos_cedidos', (SELECT count(*) FROM refs),
    'en_el_catalogo',          (SELECT count(*) FROM refs WHERE ref IN (SELECT id FROM cat)),
    'fuera_del_catalogo',      (SELECT count(*) FROM refs WHERE ref NOT IN (SELECT id FROM cat)),
    'ids_en_el_catalogo',      (SELECT count(*) FROM cat),
    'ejemplos_fuera', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
                 'ref', r.ref,
                 'visto_como', (SELECT string_agg(DISTINCT sl2.product_name, ' | ')
                                  FROM public.sale_line sl2
                                 WHERE sl2.account_id = p_account_id
                                   AND sl2.external_product_id = r.ref
                                   AND sl2.line_type = 'modifier'),
                 'ventas', (SELECT count(*) FROM public.sale_line sl3
                             WHERE sl3.account_id = p_account_id
                               AND sl3.external_product_id = r.ref
                               AND sl3.line_type = 'modifier')
               ) x
          FROM refs r
         WHERE r.ref NOT IN (SELECT id FROM cat)
         LIMIT 20
      ) q
    )
  );
$fn$;

REVOKE ALL ON FUNCTION public.modificadores_cobertura_de_codigos(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.modificadores_cobertura_de_codigos(uuid, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.modificadores_cobertura_de_codigos(uuid, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.modificadores_cobertura_de_codigos(uuid, text[]) TO service_role;
