-- 20260911082619_extras_p3_la_referencia_del_86_es_la_del_publicador.sql
--
-- LA REFERENCIA CON LA QUE SE AGOTA ES LA MISMA CON LA QUE SE PUBLICA
--
-- `hubrise-catalog-publish` manda a HubRise:
--     optRef(o) = o.external_id ?? ("mo_" + o.id)
-- o sea: una opcion sin `external_id` SI llega al canal, con una referencia que
-- Folvy se inventa en cada publicacion y no apunta en ninguna parte.
--
-- Y el 86 hacia lo contrario: `_set_modifier_option_availability_core` exigia
-- `external_id` y fallaba en voz alta, con un comentario que decia «HubRise
-- publica optRef(o) = external_id». Ese comentario era FALSO para las marcas
-- propias — justo las que publica Folvy.
--
-- MEDIDO (Foodint, 11/09), partiendo por `brand.catalog_source`:
--   propias  (`folvy`, 9 marcas) ... 181 opciones activas, 31 sin external_id
--   cedidas  (`pos`,   5 marcas) ...  55 opciones activas,  0 sin external_id
-- Las 31 son todas de marcas propias. En las cedidas la carta la manda el
-- canal y exigir la referencia sigue siendo lo correcto: ahi no se toca nada.
--
-- La etiqueta `external_source = 'lastapp'` de las marcas propias es un resto
-- de la importacion de junio; Last no manda nada en esas marcas (Julio, 11/09).
-- Por eso el reparto se hace por `catalog_source` de la MARCA, no por ella.
--
-- ENSAYO, revertido:
--   Propia sin ref: «Salsa Tzatziki (Recomendada)» -> mo_ff4e5011-…
--   A · el core agota ......... option_refs = ["mo_ff4e5011-…"]
--   B · fila en product_availability ... 1
--   C · cedida «Sin pepinillos» ........ conserva su referencia de siempre
--
-- md5 de `prosrc`:
--   _modifier_option_ref ................... 9b0a22618a864482f10de69973662410 (377)
--   _set_modifier_option_availability_core . a808f59bff932e1899825afb891a5d30 (3.917)
--   extras_availability_panel_by_token ..... c2195372fdc4f1acf0c8f6631667d1fb (1.847)
--
-- El core va como TRANSFORMACION, no como cuerpo literal: se define en un
-- fichero del formato viejo.

BEGIN;

CREATE OR REPLACE FUNCTION public._modifier_option_ref(p_option_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT CASE
           WHEN mo.external_id IS NOT NULL THEN mo.external_id
           WHEN COALESCE(b.catalog_source, '') = 'folvy' THEN 'mo_' || mo.id::text
           ELSE NULL
         END
    FROM public.modifier_option mo
    JOIN public.modifier_group mg ON mg.id = mo.modifier_group_id
    LEFT JOIN public.brand b ON b.id = mg.brand_id
   WHERE mo.id = p_option_id;
$fn$;

COMMENT ON FUNCTION public._modifier_option_ref(uuid) IS
  'La referencia de canal de una opcion, LA MISMA que usa hubrise-catalog-publish: '
  'external_id si lo tiene, y si no y la marca es propia, mo_<id>. En marca '
  'cedida devuelve NULL: alli la carta la manda el canal.';

DO $patch$
DECLARE v_def text; v_a text; v_n int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='_set_modifier_option_availability_core';

  v_a := $q$  select mo.account_id, mo.external_id, mo.name
    into v_account_id, v_external_id, v_name
  from modifier_option mo where mo.id = p_option_id;$q$;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / greatest(length(v_a),1);
  IF v_n <> 1 THEN RAISE EXCEPTION 'bloque select: % coincidencias', v_n; END IF;
  v_def := replace(v_def, v_a, $q$  select mo.account_id, public._modifier_option_ref(mo.id), mo.name
    into v_account_id, v_external_id, v_name
  from modifier_option mo where mo.id = p_option_id;$q$);

  v_a := $q$  if v_external_id is null then
    raise exception '_set_modifier_option_availability_core: la opcion "%" no tiene external_id, no se puede agotar en el canal', v_name;
  end if;$q$;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / greatest(length(v_a),1);
  IF v_n <> 1 THEN RAISE EXCEPTION 'bloque raise: % coincidencias', v_n; END IF;
  v_def := replace(v_def, v_a, $q$  if v_external_id is null then
    raise exception '_set_modifier_option_availability_core: la opcion "%" no tiene referencia de canal y su marca es cedida, no se puede agotar', v_name;
  end if;$q$);

  v_a := $q$  select array_agg(distinct mo.external_id)
    into v_refs
  from modifier_option mo
  where mo.account_id = v_account_id and mo.external_id = v_external_id;$q$;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / greatest(length(v_a),1);
  IF v_n <> 1 THEN RAISE EXCEPTION 'bloque refs: % coincidencias', v_n; END IF;
  v_def := replace(v_def, v_a, $q$  select array_agg(distinct mo.external_id)
    into v_refs
  from modifier_option mo
  where mo.account_id = v_account_id and mo.external_id = v_external_id;
  -- Una referencia inventada no tiene gemelas: es de UNA opcion.
  if v_refs is null then v_refs := ARRAY[v_external_id]; end if;$q$);

  EXECUTE v_def;
END;
$patch$;

-- El panel de la tablet cruzaba `pa.external_id = mo.external_id`, que para
-- estas es NULL: las habria agotado sin llegar a ensenarlas agotadas.
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
               'option_id',       min(g.option_id::text) FILTER (WHERE g.ref IS NOT NULL),
               'opciones',        count(*),
               'agotadas',        count(*) FILTER (WHERE g.agotada),
               'marcas',          count(DISTINCT g.brand_id),
               'sin_ref',         count(*) FILTER (WHERE g.ref IS NULL),
               'reason',          min(g.reason),
               'available_until', max(g.available_until),
               'set_at',          max(g.set_at)) AS x
        FROM (
          SELECT lower(btrim(mo.name)) AS clave, mo.name, mo.id AS option_id,
                 public._modifier_option_ref(mo.id) AS ref,
                 mg.brand_id,
                 (pa.id IS NOT NULL) AS agotada,
                 pa.reason, pa.available_until, pa.set_at
            FROM public.modifier_option mo
            JOIN public.modifier_group mg ON mg.id = mo.modifier_group_id
            LEFT JOIN public.product_availability pa
              ON pa.account_id = mo.account_id
             AND pa.target_kind = 'modifier_option'
             AND pa.external_id = public._modifier_option_ref(mo.id)
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

-- ARCHIVAR, NO BORRAR (Julio, 11/09): tres grupos «Nuevo grupo» sin un solo
-- plato asignado. El de Milanesa House `ba0d1650` arrastra sus dos «Nueva
-- opcion», que son 2 de las 31 sin referencia.
UPDATE public.modifier_option SET is_active = false, updated_at = now()
 WHERE account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   AND modifier_group_id = 'ba0d1650-1b82-40f4-b66f-9651166495ab'
   AND is_active;

UPDATE public.modifier_group SET is_active = false, updated_at = now()
 WHERE account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   AND id IN ('ddaca0a0-3257-461d-b1ba-88ef28a6ad33',
              '3e5a5ae3-0b7a-4b56-b71c-c27b5029e858',
              'ba0d1650-1b82-40f4-b66f-9651166495ab')
   AND is_active;

COMMIT;
