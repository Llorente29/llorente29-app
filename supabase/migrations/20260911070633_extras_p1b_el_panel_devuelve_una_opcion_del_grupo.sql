-- 20260911070633_extras_p1b_el_panel_devuelve_una_opcion_del_grupo.sql
--
-- El panel de extras agotados devolvia la `clave` (el nombre normalizado) y
-- nada mas, y para reactivar hace falta el id de UNA opcion del grupo: el
-- servidor resuelve el resto por nombre. Sin esto, «Reactivar» en la tablet
-- mandaba un nombre donde se espera un uuid.
--
-- Lo cazo el propio cableado del front, no una prueba: el tipo de
-- `setExtraAvailability` pide `optionId: string` y la fila no tenia ninguno.
--
-- `option_id` sale FILTRADO a las copias con `external_id`: reactivar una que
-- no tiene ref no haria nada y el core fallaria en voz alta.
--
-- md5 de `prosrc`: 2c07c5f01e21512eb99f6484a340b643 (1.799 caracteres).

BEGIN;

CREATE OR REPLACE FUNCTION public.extras_availability_panel_by_token(p_device_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_device kds_device;
BEGIN
  v_device := public.kds_resolve_device(p_device_token);
  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'extras_availability_panel_by_token: token no válido';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'name')
    FROM (
      SELECT jsonb_build_object(
               'clave',           g.clave,
               'name',            min(g.name),
               'option_id',       min(g.option_id::text) FILTER (WHERE g.external_id IS NOT NULL),
               'opciones',        count(*),
               'agotadas',        count(*) FILTER (WHERE g.agotada),
               'marcas',          count(DISTINCT g.brand_id),
               'sin_ref',         count(*) FILTER (WHERE g.external_id IS NULL),
               'reason',          min(g.reason),
               'available_until', max(g.available_until),
               'set_at',          max(g.set_at)) AS x
        FROM (
          SELECT lower(btrim(mo.name)) AS clave, mo.name, mo.id AS option_id, mo.external_id,
                 mg.brand_id,
                 (pa.id IS NOT NULL) AS agotada,
                 pa.reason, pa.available_until, pa.set_at
            FROM public.modifier_option mo
            JOIN public.modifier_group mg ON mg.id = mo.modifier_group_id
            LEFT JOIN public.product_availability pa
              ON pa.account_id = mo.account_id
             AND pa.target_kind = 'modifier_option'
             AND pa.external_id = mo.external_id
             AND pa.is_available = false
             AND (pa.location_id IS NULL OR pa.location_id = v_device.location_id)
           WHERE mo.account_id = v_device.account_id AND mo.is_active
        ) g
       GROUP BY g.clave
      HAVING count(*) FILTER (WHERE g.agotada) > 0
    ) s
  ), '[]'::jsonb);
END;
$fn$;

COMMIT;
