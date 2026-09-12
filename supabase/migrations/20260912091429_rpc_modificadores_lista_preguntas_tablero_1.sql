-- ════════════════════════════════════════════════════════════════════════════
-- TABLERO 1 · la lista de preguntas · la RPC
--
-- DEVUELVE CLAVES, NO FRASES (§1 del encargo): `tipo` es 'elige'/'anade'/
-- 'quita', `accion` es 'juntar'/'revisar'/'abrir'. El castellano lo pone
-- `lib/`. Aqui no hay ni una palabra de pantalla.
--
-- UN SOLO RELOJ (regla 36): la ventana viaja en dias enteros de MADRID, con
-- su `desde` y su `hasta`. La pantalla los escribe, no los calcula.
--
-- LA LISTA ENSENA LAS 65, NO LAS 56. Las apagadas viajan con `activa:false`
-- para que la pantalla las etiquete y las ordene abajo; no se filtran aqui.
-- Un umbral ordena, no esconde (regla 7). El ensayo lo comprueba sumando:
-- 50 en la lista + 15 sin plato = 65.
--
-- «EDITABLE» NO ES «MARCA PROPIA», Y ESTO COSTO MEDIRLO. El importador de
-- Last (`lastapp-catalog-import`) casa por (cuenta, external_source,
-- external_id) y REESCRIBE `name`, `min_selections` y `max_selections` de
-- toda pregunta que Last mande — le da igual de quien sea la marca; de hecho
-- la marca se la asigna el. Medido el 12/09 en Foodint:
--     marca propia  + pregunta propia .... 14   -> editable
--     marca propia  + pregunta de Last ... 40   -> NO editable
--     marca cedida  + pregunta de Last ... 11   -> NO editable
-- Si la pantalla dejara editar esas 40, el nombre y el minimo/maximo
-- volverian atras solos en el siguiente volcado, sin avisar. Asi que la lista
-- se AGRUPA por marca (`cedida`, de `brand.ownership_type`) y el CANDADO va
-- por origen (`editable`, de `modifier_group.external_source`). Son dos ejes
-- distintos y los dos viajan.
--
-- LA FRANJA VA SIN PORCENTAJE, a proposito. De 1.378 lineas de extra vendidas
-- en 30 dias, 859 tienen decidido que llevan y solo 281 descuentan. Los 578
-- de diferencia pueden ser el corte, un precio indefendible o un extra que
-- SUSTITUYE en vez de sumar — o una averia. Mientras el tablero 7 no pueda
-- explicarlo, un «20 %» asusta sin ensenar: eso es inventar una averia, que
-- es lo que prohibe el §5. Viajan las cuatro cifras medidas y ya.
--
-- Y NO VIAJA «N vendidas antes de llegar»: esta en la maqueta y no se puede
-- definir sin inventarsela. Sin destino, no se pinta (regla 35).
--
-- ENSAYADO ANTES DE APLICAR, en transaccion revertida, 0 fallos:
--   G1 sin JWT, la guarda niega · G2 la cuenta de otro, negada (regla 9)
--   55 ms · las nueve cifras clavan lo medido en el §0.4
--   50 + 15 = 65: ninguna pregunta se esconde
-- ════════════════════════════════════════════════════════════════════════════

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
           lower(btrim(COALESCE(g.name,''))) AS nombre_norm
      FROM public.modifier_group g WHERE g.account_id = p_account_id
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
             'origen', f.origen, 'editable', (f.origen = 'propia'),
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

-- ── HUELLA · una sola firma, y la puerta cerrada ──────────────────────────
DO $huellas$
DECLARE v_firmas int; v_acl text;
BEGIN
  SELECT count(*) INTO v_firmas FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='modificadores_lista_preguntas';
  IF v_firmas <> 1 THEN RAISE EXCEPTION 'la RPC tiene % firmas, no 1', v_firmas; END IF;

  SELECT array_to_string(p.proacl, ' ') INTO v_acl FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='modificadores_lista_preguntas';
  IF v_acl LIKE '%anon=%' OR v_acl LIKE '%=X/%postgres%' AND v_acl LIKE '% =X%' THEN
    RAISE EXCEPTION 'la RPC sigue abierta a anon o a PUBLIC: %', v_acl;
  END IF;
END $huellas$;