-- ==========================================================================
-- EL CONTADOR Y «LAS IGUALES», CON UNA SOLA DEFINICION DE «DECIDIDA»
--
-- Segunda pieza de la tanda. La primera pone el candado en la tabla; esta
-- pone la MISMA frase en los dos sitios que la leen, para que no haya dos
-- verdades sobre lo que significa que una respuesta este decidida.
--
-- LA FRASE, que ya vive en `public._impacto_completo(text, uuid, numeric)`
-- desde esta manana:
--
--   DECIDIDA = TIENE FICHA QUE DESCUENTA ALGO   (no: «tiene ficha»)
--
-- Quien la usaba ya: las tres puertas de escritura --`kitchen_guardar_pregunta`,
-- `kitchen_aplicar_a_las_iguales` y `kitchen_extras_poner_lo_que_lleva`-- y,
-- desde la pieza 1, la propia tabla. Quien NO la usaba, y por eso mentia:
--
--   `modificadores_lista_preguntas` · el contador del tablero 1
--      1. `decidida`: decia «tiene impacto confirmado» a secas. Esta manana
--         dio por decididas dos respuestas con ficha y sin cantidad, que
--         descuentan CERO. Julio lo vio en la pantalla antes que yo.
--      2. `extra` (dentro de `vendidas`): `extra IS NULL` es lo que cuenta las
--         vendidas «sin decidir». Una ficha sin cantidad nombra un articulo y
--         no descuenta nada: mentia igual. Se arregla en la misma tanda
--         porque si no, el mismo bicho sobrevive en la cifra de al lado.
--
--   `kitchen_las_iguales` · el selector de «decidir una vez para todas»
--      Sus TRES predicados. Una respuesta con impacto confirmado pero
--      incompleto se quedaba FUERA como «ya_decidida»: o sea que la unica
--      pantalla capaz de arreglarla de un golpe era justo la que la escondia.
--      Ahora vuelve a ser candidata, que es lo que es.
--
--   `modificadores_lista_preguntas` · la franja que empuja a trabajar
--      3. UN PEDIDO ANULADO NO ES DEMANDA (Julio, 13/09). La franja contaba
--         las lineas de modificador de ventas ANULADAS como si alguien las
--         hubiera pedido. Medido hoy sobre los ultimos 30 dias de Foodint:
--         21 de 1.454 lineas. Las dos varas posibles --`status = 'cancelled'`
--         y `cancelled_at IS NOT NULL`-- coinciden en las 1.454, sin una sola
--         discrepancia en ningun sentido; se usa `cancelled_at`, que es la que
--         ya usan `kitchen_para_trabajar` y `kitchen_ficha_de_respuesta`.
--         No se filtran en el WHERE: se marcan y se cuentan APARTE, en
--         `franja.anuladas`, porque el 0 nunca va solo (regla 7).
--
-- LO QUE SE DEJA COMO ESTA, Y SE DICE (no es un olvido):
--   `extras_distintos` cuenta CUANTOS ARTICULOS DISTINTOS aparecen detras de
--   las opciones activas. Un impacto incompleto nombra un articulo aunque no
--   descuente nada, asi que ahi la pregunta es otra y la respuesta vieja es
--   la correcta.
--
-- LAS CONDICIONES DE LA BANDA, medidas hoy a las 19:50 (y aun asi va en la
-- tanda de las 23:45 porque la pieza 1 la arrastra: van juntas o el contador
-- y la tabla dirian cosas distintas durante unas horas):
--   1. Camino del pedido: CERO funciones, CERO crons y CERO disparadores
--      llaman a ninguna de las dos. Solo el front, por PostgREST.
--   2. Cierre exclusivo: `CREATE OR REPLACE FUNCTION` no toma ninguno.
--   3. Se dice antes, con la medida delante.
--
-- LA MEDIDA DE LOS DOS LADOS (regla 31). Misma llamada, misma cuenta, mismos
-- 30 dias, antes y despues. Como CERO filas confirmadas incumplen hoy
-- `_impacto_completo` --medido sobre la tabla entera--, las trece cifras
-- tienen que salir IDENTICAS. Si alguna se mueve, el cambio no es lo que creo
-- que es y hay que parar. El «antes», tomado a las 20:10:
--
--   opciones 244 · preguntas 67 · platos_activos 591 · extras_distintos 55
--   opciones_activas 164 · repetidas_nombres 4 · platos_con_pregunta 135
--   repetidas_preguntas 12 · opciones_sin_decidir 82
--   opciones_decididas_activas 145 · opciones_sin_decidir_cobran 32
--   opciones_sin_decidir_activas 19 · opciones_sin_decidir_cobran_activas 6
--
-- LA FRANJA SI SE MUEVE, y por eso va con PREVISION ESCRITA ANTES: prever el
-- numero y luego comprobarlo es la unica forma de que el «no he roto nada» no
-- sea una opinion (regla 31). Tomado y calculado a las 20:15:
--
--                    antes    despues previsto    diferencia
--   vendidas          1454          1433            -21
--   con_que_lleva     1191          1171            -20
--   sin_decidir        263           262             -1
--   desconocidas         0             0              0
--   cedidas           1104          1095             -9
--   propias            350           338            -12
--   anuladas             -            21          cifra nueva
--
-- Y cuadra por los cuatro lados: 1171+262 = 1433, 1095+338 = 1433,
-- 20+1 = 21, 9+12 = 21. Si al aplicarlo sale otra cosa, el cambio no es lo
-- que creo que es: se para y se cuenta.
-- ==========================================================================

BEGIN;

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
           -- UNA OPCION RETIRADA NO SE VENDE, asi que no hay nada que decidir
           -- en ella. Todo lo que empuja a trabajar cuenta solo las activas;
           -- el total viaja al lado, de contexto. (Julio, 12/09 12:10.)
           COALESCE(o.is_active,true) AS activa,
           -- DECIDIDA = TIENE FICHA QUE DESCUENTA ALGO. Incluido `none` («no
           -- lleva nada»), que es una respuesta y no un hueco. Hasta hoy aqui
           -- ponia solo «tiene impacto confirmado», y por eso el contador dio
           -- por decididas dos respuestas con ficha y SIN CANTIDAD, que
           -- descuentan cero. Que cuenta como completo lo dice
           -- `_impacto_completo`, en un solo sitio, el mismo que usan las tres
           -- puertas de escritura y el candado de la tabla.
           EXISTS (SELECT 1 FROM public.modifier_recipe_impact i
                    WHERE i.modifier_option_id = o.id AND i.account_id = p_account_id
                      AND i.status = 'confirmed'
                      AND public._impacto_completo(i.impact_type,
                                                   i.target_recipe_item_id,
                                                   i.quantity)) AS decidida
      FROM public.modifier_option o WHERE o.account_id = p_account_id
  ),
  plato_activo AS (
    -- `archived_at` TAMBIEN. Hay 2 platos con `is_active = true` y fecha de
    -- archivo: contarlos daba 595 donde Julio cuenta 593. Ninguno de los dos
    -- lleva preguntas, asi que esto solo mueve el denominador.
    SELECT mi.id FROM public.menu_item mi
     WHERE mi.account_id = p_account_id AND COALESCE(mi.is_active,true)
       AND mi.archived_at IS NULL
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
           (SELECT count(*) FROM opcion o WHERE o.modifier_group_id=q.id AND o.activa)      AS opciones,
           (SELECT count(*) FROM opcion o WHERE o.modifier_group_id=q.id AND NOT o.activa)  AS retiradas,
           (SELECT count(*) FROM opcion o WHERE o.modifier_group_id=q.id AND o.activa
                                            AND o.precio > 0)                               AS cobran,
           (SELECT count(*) FROM opcion o WHERE o.modifier_group_id=q.id AND o.activa
                                            AND NOT o.decidida)                             AS sin_decidir,
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
             'opciones_retiradas', f.retiradas,
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
           -- MISMA DEFINICION QUE ARRIBA. `extra IS NULL` es lo que cuenta
           -- las vendidas «sin decidir»: una ficha sin cantidad nombraba un
           -- articulo y no descontaba nada, o sea que contaba como decidida
           -- mintiendo igual que el otro predicado.
           (SELECT i.target_recipe_item_id FROM public.modifier_recipe_impact i
             WHERE i.modifier_option_id = o.id AND i.account_id = p_account_id
               AND i.status='confirmed' AND i.target_recipe_item_id IS NOT NULL
               AND public._impacto_completo(i.impact_type,
                                            i.target_recipe_item_id,
                                            i.quantity) LIMIT 1) AS extra,
           -- UN PEDIDO ANULADO NO ES DEMANDA (Julio, 13/09). No se filtra
           -- aqui: se MARCA, y cada cifra de la franja decide. Filtrarlo en el
           -- WHERE haria desaparecer las 21 lineas sin que nadie supiera que
           -- existen, y el 0 nunca va solo (regla 7).
           (s.cancelled_at IS NULL) AS viva
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
      'vendidas',      (SELECT count(*) FROM vendidas WHERE viva),
      'con_que_lleva', (SELECT count(*) FROM vendidas WHERE viva AND extra IS NOT NULL),
      'sin_decidir',   (SELECT count(*) FROM vendidas WHERE viva AND opcion IS NOT NULL AND extra IS NULL),
      'desconocidas',  (SELECT count(*) FROM vendidas WHERE viva AND opcion IS NULL),
      'cedidas',       (SELECT count(*) FROM vendidas WHERE viva AND origen <> 'propia'),
      'propias',       (SELECT count(*) FROM vendidas WHERE viva AND origen = 'propia'),
      -- Y las anuladas AL LADO, no escondidas: misma pareja y misma vara que
      -- usa la mitad que limpia (`cancelled_at IS NULL`).
      'anuladas',      (SELECT count(*) FROM vendidas WHERE NOT viva)),
    'cifras', jsonb_build_object(
      'preguntas',           (SELECT count(*) FROM pregunta),
      'opciones',            (SELECT count(*) FROM opcion),
      'opciones_activas',    (SELECT count(*) FROM opcion WHERE activa),
      'platos_con_pregunta', (SELECT count(DISTINCT menu_item_id) FROM puesta),
      'platos_activos',      (SELECT count(*) FROM plato_activo),
      'repetidas_nombres',   (SELECT count(*) FROM copias WHERE n > 1),
      'repetidas_preguntas', (SELECT COALESCE(sum(n),0) FROM copias WHERE n > 1),
      -- Extras que hay DETRAS DE LO QUE SE VENDE HOY: el impacto de una
      -- opcion retirada no descuenta nada de nadie.
      'extras_distintos',    (SELECT count(DISTINCT i.target_recipe_item_id)
                                FROM public.modifier_recipe_impact i
                                JOIN opcion o ON o.id = i.modifier_option_id AND o.activa
                               WHERE i.account_id = p_account_id AND i.status='confirmed'
                                 AND i.target_recipe_item_id IS NOT NULL),
      'opciones_decididas_activas',  (SELECT count(*) FROM opcion WHERE activa AND decidida),
      'opciones_sin_decidir',        (SELECT count(*) FROM opcion WHERE NOT decidida),
      'opciones_sin_decidir_activas',(SELECT count(*) FROM opcion WHERE NOT decidida AND activa),
      'opciones_sin_decidir_cobran', (SELECT count(*) FROM opcion WHERE NOT decidida AND precio > 0),
      'opciones_sin_decidir_cobran_activas',
                                     (SELECT count(*) FROM opcion
                                       WHERE NOT decidida AND precio > 0 AND activa)),
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
      'opciones_retiradas', (SELECT COALESCE(sum(retiradas),0) FROM fila_json WHERE platos = 0),
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

-- ── «LAS IGUALES»: sus TRES predicados, con la misma frase ────────────────
CREATE OR REPLACE FUNCTION public.kitchen_las_iguales(p_account uuid, p_option_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
declare
  v_clave text;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  select lower(btrim(o.name)) into v_clave
    from modifier_option o
   where o.id = p_option_id and o.account_id = p_account;
  if v_clave is null then
    return jsonb_build_object('iguales', '[]'::jsonb, 'fuera', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    -- LAS QUE SE PUEDEN RESOLVER: mismo nombre, activas, SIN decidir todavia y
    -- en marca propia. Las que ya tienen efecto no salen: pisar una decision
    -- que alguien tomo a mano, sin pedirlo, seria lo contrario de esto.
    --
    -- «SIN DECIDIR» = sin ficha QUE DESCUENTE ALGO (13/09). Antes bastaba una
    -- fila confirmada, y una respuesta con ficha sin cantidad se quedaba fuera
    -- como «ya decidida»: la unica pantalla que podia arreglarla de un golpe
    -- era justo la que la escondia.
    'iguales', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'nombre', o.name,
               'pregunta', g.name, 'marca', b.name,
               'precio', coalesce(o.price_impact,0))
             order by b.name, g.name), '[]'::jsonb)
        from modifier_option o
        join modifier_group g on g.id = o.modifier_group_id
        left join brand b on b.id = g.brand_id
       where o.account_id = p_account
         and o.id <> p_option_id
         and lower(btrim(o.name)) = v_clave
         and coalesce(o.is_active, true) and coalesce(g.is_active, true)
         and coalesce(b.ownership_type, 'own') = 'own'
         and not exists (select 1 from modifier_recipe_impact i
                          where i.modifier_option_id = o.id and i.status = 'confirmed'
                            and public._impacto_completo(i.impact_type,
                                                        i.target_recipe_item_id,
                                                        i.quantity))),
    -- LAS QUE SE QUEDAN FUERA, Y POR QUE. No se esconden (regla 7): quien mira
    -- tiene que poder ver que hay 3 mas que no se tocan, y el motivo.
    'fuera', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'nombre', o.name,
               'pregunta', g.name, 'marca', b.name,
               'motivo', case
                 when coalesce(b.ownership_type,'own') <> 'own' then 'cedida'
                 when exists (select 1 from modifier_recipe_impact i
                               where i.modifier_option_id = o.id and i.status='confirmed'
                                 and public._impacto_completo(i.impact_type,
                                                             i.target_recipe_item_id,
                                                             i.quantity))
                   then 'ya_decidida'
                 else 'apagada' end)
             order by b.name, g.name), '[]'::jsonb)
        from modifier_option o
        join modifier_group g on g.id = o.modifier_group_id
        left join brand b on b.id = g.brand_id
       where o.account_id = p_account
         and o.id <> p_option_id
         and lower(btrim(o.name)) = v_clave
         and (coalesce(b.ownership_type,'own') <> 'own'
              or not coalesce(o.is_active, true) or not coalesce(g.is_active, true)
              or exists (select 1 from modifier_recipe_impact i
                          where i.modifier_option_id = o.id and i.status='confirmed'
                            and public._impacto_completo(i.impact_type,
                                                        i.target_recipe_item_id,
                                                        i.quantity)))));
end;
$fn$;

REVOKE ALL ON FUNCTION public.kitchen_las_iguales(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kitchen_las_iguales(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.kitchen_las_iguales(uuid, uuid) TO authenticated;

-- -- HUELLA: una firma cada una, y la frase en los CINCO sitios ------------
DO $huellas$
DECLARE v_n int; v_src text;
BEGIN
  FOR v_src IN SELECT unnest(ARRAY['modificadores_lista_preguntas','kitchen_las_iguales']) LOOP
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname = v_src;
    IF v_n <> 1 THEN RAISE EXCEPTION '% tiene % firmas, no 1', v_src, v_n; END IF;
  END LOOP;

  -- Dos predicados en el contador, tres en las iguales. Contarlos es lo que
  -- impide que manana alguien arregle uno y se deje otro (que es exactamente
  -- lo que habia pasado).
  SELECT count(*) INTO v_n
    FROM regexp_matches(
           (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='modificadores_lista_preguntas'),
           '_impacto_completo', 'g');
  IF v_n <> 2 THEN RAISE EXCEPTION 'el contador usa la definicion % veces, no 2', v_n; END IF;

  SELECT count(*) INTO v_n
    FROM regexp_matches(
           (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='kitchen_las_iguales'),
           '_impacto_completo', 'g');
  IF v_n <> 3 THEN RAISE EXCEPTION 'las iguales usan la definicion % veces, no 3', v_n; END IF;

  RAISE NOTICE 'una sola definicion, en sus cinco sitios';
END;
$huellas$;

COMMIT;
