-- ==========================================================================
-- EL CANDADO DEL TABLERO 4: CEDIDA SE MIDE POR LA MARCA, NO POR LA FILA
--
-- Lo de antes estaba mal, y es correccion de Julio (11:25). Yo lei el codigo
-- del importador de Last, vi que reescribe `name`, `min_selections` y
-- `max_selections` de lo que casa, y DEDUJE que reescribiria las 40 preguntas
-- de marca propia que arrastran `external_source = 'lastapp'`. No lo medi.
--
-- Medido, no pasa: esa etiqueta es de la importacion del 12/06 y nadie la ha
-- vuelto a tocar. La prueba son las fechas de la ultima escritura y la pasada
-- real del importador del 11/09 a las 12:11:
--     Ay Mamita, Dos Coyotes, Milanesa Haus, Big Mike's -> cedidas, opciones
--                                                          reescritas a esa hora
--     ninguna marca propia                              -> 0 tocadas
--     las propias que cambiaron el 11/09 (10:26, 15:05) -> trabajo humano
--
-- Bloquear esas 40 habria dejado a Julio sin poder editar 40 preguntas SUYAS,
-- que es exactamente la pantalla que ha pedido. La vara buena es la de
-- siempre: CEDIDA ES LA MARCA (`brand.ownership_type = 'licensed'`).
--
--     marca cedida -> candado. Last manda: se ve, no se edita.
--     marca propia -> editable, sean 14 o 54. La verdad es Folvy.
--
-- Medido hoy en Foodint: 11 cedidas y 54 propias; de las propias, 40
-- arrastran la etiqueta vieja. Viaja como `etiqueta_vieja` para que la
-- pantalla diga su linea y para que el servicio de guardado sepa que tiene
-- que limpiarla. Nunca en cedidas: alli la llave es lo que deja que el
-- importador case, y borrarla romperia el enlace.
--
-- La cabecera va en ASCII a proposito: hoy, al traer un texto registrado para
-- escribir su fichero, se perdieron dos caracteres de las lineas de caja. Lo
-- que no esta, no se pierde.
--
-- ENSAYADO ANTES DE APLICAR, en transaccion revertida, 0 fallos:
--   H1 md5 del cuerpo = el del fichero
--   57 ms
--   C1 54 editables · C2 11 con candado · C3 40 con etiqueta vieja, editables
--   C4 65 en total: ninguna se esconde
--   C5 ninguna cedida marcada como etiqueta vieja
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.modificadores_lista_preguntas(
  p_account_id uuid,
  p_dias       integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_hoy date; v_dias integer; v_desde date; v_out jsonb;
BEGIN
  IF NOT public.belongs_to_account(p_account_id) THEN
    RAISE EXCEPTION 'modificadores_lista_preguntas: sin acceso a la cuenta %', p_account_id;
  END IF;
  v_dias  := GREATEST(LEAST(COALESCE(p_dias, 30), 365), 1);
  v_hoy   := (now() AT TIME ZONE 'Europe/Madrid')::date;
  v_desde := v_hoy - v_dias;

  WITH pregunta AS (
    SELECT g.id, g.brand_id, g.name, g.group_type, g.min_selections, g.max_selections,
           COALESCE(g.allow_repetition,false) AS repetible,
           COALESCE(g.is_active,true) AS activa,
           COALESCE(g.external_source,'propia') AS origen,
           -- CEDIDA SE MIDE POR LA MARCA, no por el origen de la fila.
           (COALESCE(b.ownership_type,'own') <> 'own') AS cedida,
           lower(btrim(COALESCE(g.name,''))) AS nombre_norm
      FROM public.modifier_group g
      LEFT JOIN public.brand b ON b.id = g.brand_id
     WHERE g.account_id = p_account_id
  ),
  opcion AS (
    SELECT o.id, o.modifier_group_id, COALESCE(o.price_impact,0) AS precio,
           -- DECIDIDA = tiene impacto confirmado, INCLUIDO `none` («no lleva
           -- nada»), que es una respuesta y no un hueco. Sin ninguna fila, es
           -- que nadie lo ha decidido todavia.
           EXISTS (SELECT 1 FROM public.modifier_recipe_impact i
                    WHERE i.modifier_option_id = o.id AND i.account_id = p_account_id
                      AND i.status = 'confirmed') AS decidida
      FROM public.modifier_option o WHERE o.account_id = p_account_id
  ),
  plato_activo AS (
    SELECT mi.id FROM public.menu_item mi
     WHERE mi.account_id = p_account_id AND COALESCE(mi.is_active,true)
  ),
  puesta AS (
    SELECT DISTINCT ga.modifier_group_id, ga.menu_item_id
      FROM public.modifier_group_assignment ga
      JOIN plato_activo pa ON pa.id = ga.menu_item_id
     WHERE ga.account_id = p_account_id
  ),
  copias AS (
    -- `IS NOT DISTINCT FROM` mas abajo, no `=`: una pregunta sin marca tiene
    -- `brand_id` nulo y con `=` se quedaria sin su grupo de copias.
    SELECT brand_id, nombre_norm, count(*) AS n,
           (count(DISTINCT COALESCE(min_selections,0)) > 1
         OR count(DISTINCT COALESCE(max_selections,0)) > 1) AS reglas_distintas
      FROM pregunta GROUP BY 1,2
  ),
  fila AS (
    SELECT q.*,
           (SELECT count(*) FROM opcion o WHERE o.modifier_group_id=q.id)                    AS opciones,
           (SELECT count(*) FROM opcion o WHERE o.modifier_group_id=q.id AND o.precio > 0)   AS cobran,
           (SELECT count(*) FROM opcion o WHERE o.modifier_group_id=q.id AND NOT o.decidida) AS sin_decidir,
           (SELECT count(*) FROM puesta a WHERE a.modifier_group_id=q.id)                    AS platos,
           c.n AS copias, c.reglas_distintas
      FROM pregunta q
      JOIN copias c ON c.brand_id IS NOT DISTINCT FROM q.brand_id AND c.nombre_norm = q.nombre_norm
  ),
  fila_json AS (
    SELECT f.*, jsonb_build_object(
             'id', f.id, 'nombre', f.name,
             'tipo', CASE f.group_type WHEN 'choice' THEN 'elige' WHEN 'extras' THEN 'anade'
                                       WHEN 'removal' THEN 'quita' ELSE COALESCE(f.group_type,'elige') END,
             'de_pago', (f.cobran > 0),
             'min', COALESCE(f.min_selections,0), 'max', COALESCE(f.max_selections,1),
             'obligatoria', (COALESCE(f.min_selections,0) > 0),
             'repetible', f.repetible, 'activa', f.activa,
             'origen', f.origen,
             'cedida', f.cedida,
             'editable', (NOT f.cedida),
             -- Para la linea de la pantalla: «esta pregunta venia de una
             -- importacion antigua; al guardarla pasa a ser tuya». Hoy, 40.
             'etiqueta_vieja', (f.origen = 'lastapp' AND NOT f.cedida),
             'opciones', f.opciones, 'opciones_cobran', f.cobran,
             'sin_decidir', f.sin_decidir, 'platos', f.platos,
             'copias', f.copias, 'reglas_distintas', f.reglas_distintas,
             -- Copias con las MISMAS reglas se pueden juntar; con reglas
             -- distintas no se junta a ciegas, se revisa.
             'accion', CASE WHEN f.copias > 1 AND f.reglas_distintas THEN 'revisar'
                            WHEN f.copias > 1                        THEN 'juntar'
                            ELSE 'abrir' END) AS j
      FROM fila f
  ),
  marca AS (
    SELECT b.id, b.name, (COALESCE(b.ownership_type,'own') <> 'own') AS cedida
      FROM public.brand b WHERE b.account_id = p_account_id
  ),
  vendidas AS (
    SELECT sl.id, o.id AS opcion, COALESCE(mg.external_source,'propia') AS origen,
           (SELECT i.target_recipe_item_id FROM public.modifier_recipe_impact i
             WHERE i.modifier_option_id = o.id AND i.account_id = p_account_id
               AND i.status='confirmed' AND i.target_recipe_item_id IS NOT NULL LIMIT 1) AS extra
      FROM public.sale_line sl
      JOIN public.sale s ON s.id = sl.sale_id
      LEFT JOIN public.modifier_option o ON o.id = sl.modifier_option_id AND o.account_id = p_account_id
      LEFT JOIN public.modifier_group mg ON mg.id = o.modifier_group_id
     WHERE sl.account_id = p_account_id AND sl.modifier_option_id IS NOT NULL
       AND sl.ignored_at IS NULL AND s.created_at >= v_desde
  )
  SELECT jsonb_build_object(
    'ventana', jsonb_build_object('dias', v_dias, 'desde', v_desde, 'hasta', v_hoy),
    'franja', jsonb_build_object(
      'vendidas',      (SELECT count(*) FROM vendidas),
      'con_que_lleva', (SELECT count(*) FROM vendidas WHERE extra IS NOT NULL),
      'sin_decidir',   (SELECT count(*) FROM vendidas WHERE opcion IS NOT NULL AND extra IS NULL),
      'desconocidas',  (SELECT count(*) FROM vendidas WHERE opcion IS NULL),
      'cedidas',       (SELECT count(*) FROM vendidas WHERE origen <> 'propia'),
      'propias',       (SELECT count(*) FROM vendidas WHERE origen = 'propia')),
    'cifras', jsonb_build_object(
      'preguntas',           (SELECT count(*) FROM pregunta),
      'opciones',            (SELECT count(*) FROM opcion),
      'platos_con_pregunta', (SELECT count(DISTINCT menu_item_id) FROM puesta),
      'platos_activos',      (SELECT count(*) FROM plato_activo),
      'repetidas_nombres',   (SELECT count(*) FROM copias WHERE n > 1),
      'repetidas_preguntas', (SELECT COALESCE(sum(n),0) FROM copias WHERE n > 1),
      'extras_distintos',    (SELECT count(DISTINCT i.target_recipe_item_id)
                                FROM public.modifier_recipe_impact i
                               WHERE i.account_id = p_account_id AND i.status='confirmed'
                                 AND i.target_recipe_item_id IS NOT NULL),
      'opciones_sin_decidir',        (SELECT count(*) FROM opcion WHERE NOT decidida),
      'opciones_sin_decidir_cobran', (SELECT count(*) FROM opcion WHERE NOT decidida AND precio > 0)),
    -- Propias primero y cedidas despues: 'false' < 'true' como texto.
    'marcas', COALESCE((
      SELECT jsonb_agg(x.m ORDER BY (x.m->>'cedida'), (x.m->>'nombre'))
        FROM (SELECT jsonb_build_object(
                'id', mb.id, 'nombre', mb.name, 'cedida', mb.cedida,
                'preguntas', (SELECT jsonb_agg(fj.j ORDER BY
                                (fj.sin_decidir > 0 OR fj.copias > 1) DESC,
                                fj.sin_decidir DESC, fj.copias DESC, fj.name)
                                FROM fila_json fj WHERE fj.brand_id = mb.id AND fj.platos > 0)) AS m
                FROM marca mb
               WHERE EXISTS (SELECT 1 FROM fila_json fj WHERE fj.brand_id = mb.id AND fj.platos > 0)) x
      ), '[]'::jsonb),
    -- Las que no estan en ningun plato ACTIVO van aparte, no desaparecen.
    'sin_plato', jsonb_build_object(
      'preguntas', (SELECT count(*) FROM fila_json WHERE platos = 0),
      'opciones',  (SELECT COALESCE(sum(opciones),0) FROM fila_json WHERE platos = 0),
      'filas', COALESCE((SELECT jsonb_agg(fj.j || jsonb_build_object(
                            'marca', (SELECT mb.name FROM marca mb WHERE mb.id = fj.brand_id)) ORDER BY fj.name)
                           FROM fila_json fj WHERE fj.platos = 0), '[]'::jsonb))
  ) INTO v_out;
  RETURN v_out;
END;
$fn$;

-- Sin anon ni PUBLIC (§1).
REVOKE ALL ON FUNCTION public.modificadores_lista_preguntas(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.modificadores_lista_preguntas(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.modificadores_lista_preguntas(uuid, integer) TO authenticated;

-- -- HUELLA: una sola firma, el cuerpo esperado, y la puerta cerrada ---------
DO $huellas$
DECLARE v_firmas int; v_md5 text; v_acl text;
BEGIN
  SELECT count(*) INTO v_firmas FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='modificadores_lista_preguntas';
  IF v_firmas <> 1 THEN RAISE EXCEPTION 'la RPC tiene % firmas, no 1', v_firmas; END IF;

  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='modificadores_lista_preguntas';
  IF v_md5 <> 'ea27cb063c68dc3eebf054480ee18c30' THEN
    RAISE EXCEPTION 'md5 del cuerpo = %, esperaba ea27cb063c68dc3eebf054480ee18c30', v_md5;
  END IF;

  SELECT array_to_string(p.proacl, ' ') INTO v_acl FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='modificadores_lista_preguntas';
  IF v_acl LIKE '%anon=%' THEN
    RAISE EXCEPTION 'la RPC sigue abierta a anon: %', v_acl;
  END IF;
END $huellas$;