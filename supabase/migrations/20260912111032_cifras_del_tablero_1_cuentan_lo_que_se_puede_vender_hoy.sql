-- ==========================================================================
-- LAS CIFRAS QUE EMPUJAN A TRABAJAR CUENTAN LO QUE SE PUEDE VENDER HOY
--
-- Correccion de Julio, 12/09 12:10, sobre la captura del tablero 1.
--
-- La pantalla decia «Opciones sin decidir que llevan: 137 de 241». Dentro
-- habia opciones RETIRADAS. Una opcion retirada no se vende: no hay nada que
-- decidir en ella. Con esa cifra se manda a alguien a decidir cosas que no
-- existen, y cuando lo descubra dejara de creerse tambien las cifras buenas.
--
-- Medido a las 13:06 (misma llamada, mismo momento):
--
--                                  total    activas   retiradas
--   opciones                         241        211          30
--   sin decidir que llevan           131        111          20
--   ...y ademas cobran                39         31           8
--   decididas (con extra detras)     110        100          10
--
-- (En el parte de las 10:2x el total era 137/45. Entre medias se decidieron
--  seis. Las activas son 111 y 31 en las dos lecturas: es lo que cambia.)
--
-- LO QUE CAMBIA, uno a uno:
--   1. `opcion` sabe si sigue viva (`is_active`).
--   2. `plato_activo` excluye los ARCHIVADOS. Hay 2 platos con
--      `is_active = true` y `archived_at` puesto; contarlos daba 595 donde
--      Julio cuenta 593. Ninguno lleva preguntas: solo mueve el denominador,
--      ninguna pregunta cambia de seccion (medido: 0).
--   3. Las cuentas de cada fila --opciones, cobran, sin decidir-- pasan a ser
--      de activas, y la fila lleva ademas `opciones_retiradas`.
--   4. Las cifras de cabecera llevan las DOS bases, como las 65 y las 56.
--   5. `extras_distintos` cuenta los extras detras de opciones ACTIVAS: el
--      impacto de una opcion retirada no descuenta nada de nadie. Eso lo baja
--      de 55 a 46 -- nueve extras existen SOLO detras de opciones retiradas.
--
-- DIEZ preguntas tienen opciones retiradas. Seis se quedan en cero opciones
-- activas, y LAS SEIS ESTAN YA APAGADAS: ninguna pregunta viva se queda sin
-- opciones por este cambio. Las otras cuatro pierden alguna:
--   1. Escoge tu primer kebab 6->3 · Escoge la base de tu bocata 3->2
--   Escoge la base de tu milanesa. 3->2 · Y una bebida? 6->5
--
-- FUERA DE LA BANDA, y esto es medido, no opinado: la funcion es STABLE (no
-- puede escribir) y la llaman 0 funciones, 0 crons y 0 triggers. Solo la
-- pantalla del tablero 1, que todavia no esta publicada. No toca entrada de
-- pedidos, consumo ni stock.
--
-- Mismo numero de argumentos y mismos tipos: CREATE OR REPLACE no crea
-- sobrecarga aqui (regla 2 se aplica al ANADIR un parametro, y no se anade).
-- La huella del final comprueba que sigue habiendo UNA sola firma.
--
-- ENSAYADO ANTES DE APLICAR, en transaccion revertida, 0 fallos, 62,9 ms:
--   C1 241/211 · 131/111 · 39/31 · 110/100
--   C2 platos 593, con pregunta 137
--   C3 65 preguntas en 14 marcas: ninguna se esconde
--   C4 0 preguntas ACTIVAS se quedan con 0 opciones
--   C5 las filas suman 111 sin decidir y la cabecera dice 111
--   C6 primer kebab 3 activas + 3 retiradas · Y una bebida? 5 + 1
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
           -- UNA OPCION RETIRADA NO SE VENDE, asi que no hay nada que decidir
           -- en ella. Todo lo que empuja a trabajar cuenta solo las activas;
           -- el total viaja al lado, de contexto. (Julio, 12/09 12:10.)
           COALESCE(o.is_active,true) AS activa,
           -- DECIDIDA = tiene impacto confirmado, INCLUIDO `none` («no lleva
           -- nada»), que es una respuesta y no un hueco. Sin ninguna fila, es
           -- que nadie lo ha decidido todavia.
           EXISTS (SELECT 1 FROM public.modifier_recipe_impact i
                    WHERE i.modifier_option_id = o.id AND i.account_id = p_account_id
                      AND i.status = 'confirmed') AS decidida
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

-- -- HUELLA: una sola firma y la puerta cerrada -----------------------------
DO $huellas$
DECLARE v_firmas int; v_acl text;
BEGIN
  SELECT count(*) INTO v_firmas FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='modificadores_lista_preguntas';
  IF v_firmas <> 1 THEN RAISE EXCEPTION 'la RPC tiene % firmas, no 1', v_firmas; END IF;

  SELECT array_to_string(p.proacl, ' ') INTO v_acl FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='modificadores_lista_preguntas';
  IF v_acl ILIKE '%anon=%' THEN RAISE EXCEPTION 'anon sigue pudiendo ejecutarla: %', v_acl; END IF;
  IF v_acl NOT ILIKE '%authenticated=X%' THEN
    RAISE EXCEPTION 'authenticated no puede ejecutarla: %', v_acl;
  END IF;
END;
$huellas$;