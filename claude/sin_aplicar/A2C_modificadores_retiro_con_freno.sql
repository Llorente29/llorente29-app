-- ════════════════════════════════════════════════════════════════════════
-- A2c · LO QUE LAST RETIRA SE RETIRA TAMBIÉN EN FOLVY, Y SE VE
--
-- SIN APLICAR. Este fichero vive en `claude/sin_aplicar/` a propósito: el
-- 11/09 Julio cerró la banda («nada que toque la entrada de pedidos, el
-- consumo o el stock se aplica en la base entre las 12:15 y las 23:45»).
-- Cuando se aplique, se mueve a `supabase/migrations/` CON LA VERSIÓN EXACTA
-- que registre la base (regla 17). Mientras esté aquí, no está vivo.
--
-- ── QUÉ HACE ────────────────────────────────────────────────────────────
-- El importador de Last construye, en cada pasada, la lista de opciones de
-- extra que Last sirve HOY. Esta pieza contesta la pregunta inversa: de las
-- opciones que Folvy tiene ENCENDIDAS en las marcas que la pasada ha
-- recorrido de verdad, ¿cuáles no vienen ya en esa lista? Y, con tres frenos
-- delante, las apaga.
--
-- No borra: `is_active = false`. Una opción apagada sigue existiendo, sigue
-- casando por código con los pedidos que la nombren (A2b la busca en último
-- lugar, no la descarta) y se vuelve a encender sola si Last la recupera.
--
-- ── LOS TRES FRENOS, Y POR QUÉ HAY TRES ─────────────────────────────────
--
-- 1) EL RAÍL: sólo se retira DENTRO de las marcas que la pasada ha visitado
--    (`p_brand_ids`). Fuera de esas marcas no se toca nada, aunque la opción
--    parezca huérfana.
--
-- 2) LA LISTA VACÍA NO RETIRA: si la pasada no trae ni una opción, o no trae
--    ni una marca, esto no apaga nada y lo dice. Una pasada que se queda a
--    medias por un 500 de Last construye cero filas; sin este freno, cero
--    filas significaría «Last ya no sirve nada» y apagaría el catálogo
--    entero. Es el mismo fallo que A3: contar antes de reemplazar.
--
-- 3) EL FRENO POR MARCA (Julio, 11/09 12:30): si en una marca visitada se
--    fueran a retirar más de `p_max_por_marca` opciones, o más del
--    `p_max_pct` % de las suyas, esa marca NO retira nada en esa pasada y
--    sale un aviso. Una marca que pierde de golpe la mitad de sus extras no
--    es una carta nueva: es una pasada rota.
--
-- ── MEDIDO SOBRE LA POBLACIÓN REAL (regla 31), 11/09 ────────────────────
-- Con lo que la pasada de las 12:11 dejó escrito en la base:
--
--   Marca               activas   sin código   %      qué pasa
--   Ay Mamita Bowls        11          0        0 %   nada que retirar
--   Big Mike´s Burger      14          0        0 %   nada que retirar
--   Milanesa Haus          16          0        0 %   nada que retirar
--   Dos Coyotes             9          1     11,1 %   RETIRA (1 ≤ 3, 11,1 ≤ 20)
--   Lobbers                 5          5      100 %   NO VISITADA
--
-- Los 5 de Lobbers son justo lo que el raíl existe para no tocar. Sus tres
-- marcas de Last cuelgan de locales (5fa6d8b0…, a4a87b8d…, 81519f20…) que no
-- están en ninguna de las dos organizaciones que este importador ve
-- (Cloudtown y JOSE Location): la pasada del 12:11 no las visitó ni puede
-- visitarlas, y sus opciones siguen con la fecha de la pasada de julio
-- (20/07 09:43). Sin raíl, la primera pasada habría apagado 5 de 5.
--
-- Y el freno del §3 las habría cogido igual, por su cuenta: 5 > 3 y 100 % >
-- 20 %. Dos guardas independientes cazan el mismo caso. La única que pasa es
-- la de verdad: «Sin Extras» de Dos Coyotes, sin vender desde el 27/07.
--
-- ── LO QUE ENCONTRÓ EL ENSAYO: RETIRAR PODÍA CORTAR LA HISTORIA ─────────
-- A2b dejó que el CÓDIGO siguiera casando con una opción retirada, justo para
-- que retirar no desenlazara las ventas viejas. Pero eso vale sólo si la
-- opción TIENE código. «Sin Extras» no lo tiene: la pasada del 12:11 no se lo
-- puso porque Last ya no la sirve, y su `external_id` (c3d9201a…) NO es lo que
-- llega en los pedidos. Lo que llega es c2126f6f…, el `organizationModifierId`.
-- Al apagarla, el paso 3 —por nombre, sólo activas— tampoco la encontraría: la
-- línea se quedaría en `extra_desconocido`.
--
-- Medido: 21 líneas ya enlazadas a esa opción, TODAS con la misma referencia
-- c2126f6f…, y ninguna otra opción de la cuenta lleva ese código. O sea que la
-- evidencia está en los propios pedidos y no es ambigua.
--
-- Por eso, antes de apagar, esto RESCATA el código: a cada opción que va a
-- retirar y no tiene `pos_modifier_id`, le pone el que traen sus propias
-- líneas, si y sólo si hay UNA sola referencia distinta y ninguna otra opción
-- la usa. Retirar deja de cortar la historia. Si la evidencia es ambigua o no
-- hay ninguna, no se inventa nada: se apaga igual y se cuenta aparte
-- (`retiradas_sin_codigo`), que es la cifra que dice cuántas líneas futuras
-- con ese nombre se quedarían sin enlazar.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.modificadores_plan_de_retiro(
  p_account_id     uuid,
  p_brand_ids      uuid[],
  p_option_ext_ids text[],
  p_aplicar        boolean DEFAULT false,
  p_max_por_marca  integer DEFAULT 3,
  p_max_pct        numeric DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_marcas    jsonb   := '[]'::jsonb;
  v_retiradas integer := 0;
  v_frenadas  integer := 0;
  v_visitadas integer := 0;
  v_sin_ref   integer := 0;
  v_avisados  integer := 0;
  v_callados  integer := 0;
  v_marca     jsonb;
  v_id        bigint;
  v_a_retirar uuid[] := '{}';
  v_rescatados integer := 0;
  v_rescatables integer := 0;
  v_sin_codigo integer := 0;
BEGIN
  -- FRENO 2 · la lista vacía no retira.
  IF p_account_id IS NULL
     OR COALESCE(array_length(p_brand_ids, 1), 0) = 0
     OR COALESCE(array_length(p_option_ext_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object(
      'ok',     false,
      'motivo', 'la pasada no trae marcas visitadas o no trae ni una opcion de Last: no se retira nada',
      'aplicado',           false,
      'marcas_visitadas',   COALESCE(array_length(p_brand_ids, 1), 0),
      'opciones_en_last',   COALESCE(array_length(p_option_ext_ids, 1), 0),
      'opciones_retiradas', 0,
      'marcas_frenadas',    0,
      'marcas',             '[]'::jsonb
    );
  END IF;

  -- ── EL PLAN. Sólo lee. Lo que decide aquí es lo que se ejecuta abajo, y
  -- es lo MISMO que devuelve el `dry_run`: una sola vara para los dos lados
  -- (regla 31).
  WITH vivas AS (
    -- FRENO 1 · el raíl: sólo marcas visitadas, sólo cedidas, sólo de esta
    -- cuenta (regla 9: el catálogo plantilla comparte tablas Y nombres).
    SELECT mo.id, mo.name AS opcion, mo.external_id, mo.pos_modifier_id,
           mg.brand_id, b.name AS marca, mg.name AS pregunta
      FROM public.modifier_option mo
      JOIN public.modifier_group  mg ON mg.id = mo.modifier_group_id
      JOIN public.brand           b  ON b.id  = mg.brand_id
     WHERE mo.account_id      = p_account_id
       AND b.account_id       = p_account_id
       AND mo.external_source = 'lastapp'
       AND mo.is_active
       AND mg.brand_id        = ANY(p_brand_ids)
       AND b.ownership_type   = 'licensed'
  ),
  cat AS (
    SELECT DISTINCT e AS ext FROM unnest(p_option_ext_ids) e WHERE e IS NOT NULL
  ),
  -- Una opción con origen `lastapp` y SIN referencia no se puede comparar con
  -- nada: no se retira, se cuenta aparte y se dice.
  con_ref AS (SELECT * FROM vivas WHERE external_id IS NOT NULL),
  sobra AS (
    SELECT v.* FROM con_ref v
     WHERE NOT EXISTS (SELECT 1 FROM cat c WHERE c.ext = v.external_id)
  ),
  por_marca AS (
    SELECT v.brand_id, max(v.marca) AS marca, count(*) AS activas,
           count(*) FILTER (
             WHERE NOT EXISTS (SELECT 1 FROM cat c WHERE c.ext = v.external_id)
           ) AS sobran
      FROM con_ref v
     GROUP BY v.brand_id
  ),
  decision AS (
    -- FRENO 3 · el de Julio. Se evalúa marca por marca, con SUS cifras: el
    -- freno de una no arrastra a las demás.
    SELECT pm.*,
           (pm.sobran > p_max_por_marca
            OR pm.sobran::numeric > (p_max_pct / 100.0) * pm.activas) AS frenada,
           round(100.0 * pm.sobran / NULLIF(pm.activas, 0), 1) AS pct
      FROM por_marca pm
     WHERE pm.sobran > 0
  )
  SELECT
    (SELECT COALESCE(array_agg(s.id), '{}')
       FROM sobra s JOIN decision d ON d.brand_id = s.brand_id WHERE NOT d.frenada),
    (SELECT count(*) FROM decision WHERE frenada),
    (SELECT count(DISTINCT brand_id) FROM vivas),
    (SELECT count(*) FROM vivas WHERE external_id IS NULL),
    (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'marca'), '[]'::jsonb) FROM (
       SELECT jsonb_build_object(
                'brand_id', d.brand_id,
                'marca',    d.marca,
                'activas',  d.activas,
                'sobran',   d.sobran,
                'pct',      d.pct,
                'frenada',  d.frenada,
                'motivo_del_freno', CASE
                  WHEN NOT d.frenada THEN NULL
                  WHEN d.sobran > p_max_por_marca
                    THEN format('%s opciones es mas de %s', d.sobran, p_max_por_marca)
                  ELSE format('%s %% es mas del %s %% de las suyas', d.pct, p_max_pct)
                END,
                'opciones', (
                  SELECT COALESCE(jsonb_agg(jsonb_build_object(
                           'opcion', s.opcion, 'pregunta', s.pregunta, 'ref', s.external_id,
                           'codigo', s.pos_modifier_id)
                         ORDER BY s.opcion), '[]'::jsonb)
                    FROM sobra s WHERE s.brand_id = d.brand_id
                )
              ) AS x
         FROM decision d
     ) q)
  INTO v_a_retirar, v_frenadas, v_visitadas, v_sin_ref, v_marcas;

  -- ── LO QUE EL RESCATE PUEDE SALVAR. Se cuenta ANTES de tocar nada, con la
  -- misma consulta que luego escribe, para que el `dry_run` y la pasada de
  -- verdad den el mismo número (regla 31: la misma vara a los dos lados).
  WITH evidencia AS (
    SELECT sl.modifier_option_id AS opt, min(sl.external_product_id) AS ref
      FROM public.sale_line sl
     WHERE sl.account_id = p_account_id
       AND sl.line_type = 'modifier'
       AND sl.external_source = 'lastapp'
       AND sl.external_product_id IS NOT NULL
       AND sl.modifier_option_id = ANY(v_a_retirar)
     GROUP BY sl.modifier_option_id
    HAVING count(DISTINCT sl.external_product_id) = 1
       AND NOT EXISTS (SELECT 1 FROM public.modifier_option o2
                        WHERE o2.account_id = p_account_id
                          AND o2.pos_modifier_id = min(sl.external_product_id))
  )
  SELECT count(*) FILTER (WHERE e.ref IS NOT NULL),
         count(*) FILTER (WHERE e.ref IS NULL)
    INTO v_rescatables, v_sin_codigo
    FROM public.modifier_option mo
    LEFT JOIN evidencia e ON e.opt = mo.id
   WHERE mo.id = ANY(v_a_retirar) AND mo.pos_modifier_id IS NULL;

  IF p_aplicar AND COALESCE(array_length(v_a_retirar, 1), 0) > 0 THEN
    -- EL RESCATE DEL CÓDIGO, antes de apagar. Sólo donde la evidencia de los
    -- propios pedidos es UNA y no la usa nadie más. Si no, no se inventa nada.
    WITH evidencia AS (
      SELECT sl.modifier_option_id AS opt, min(sl.external_product_id) AS ref
        FROM public.sale_line sl
       WHERE sl.account_id = p_account_id
         AND sl.line_type = 'modifier'
         AND sl.external_source = 'lastapp'
         AND sl.external_product_id IS NOT NULL
         AND sl.modifier_option_id = ANY(v_a_retirar)
       GROUP BY sl.modifier_option_id
      HAVING count(DISTINCT sl.external_product_id) = 1
         AND NOT EXISTS (SELECT 1 FROM public.modifier_option o2
                          WHERE o2.account_id = p_account_id
                            AND o2.pos_modifier_id = min(sl.external_product_id))
    )
    UPDATE public.modifier_option mo
       SET pos_modifier_id = e.ref, updated_at = now()
      FROM evidencia e
     WHERE mo.id = e.opt AND mo.pos_modifier_id IS NULL;
    GET DIAGNOSTICS v_rescatados = ROW_COUNT;

    UPDATE public.modifier_option mo
       SET is_active = false, updated_at = now()
     WHERE mo.id = ANY(v_a_retirar);
    GET DIAGNOSTICS v_retiradas = ROW_COUNT;

    -- Si lo hecho no es lo planeado, algo se movió por debajo: se para.
    IF v_rescatados <> v_rescatables
       OR v_retiradas <> COALESCE(array_length(v_a_retirar, 1), 0) THEN
      RAISE EXCEPTION 'A2c: el plan decia % rescates y % retiros; se hicieron % y %',
        v_rescatables, COALESCE(array_length(v_a_retirar, 1), 0), v_rescatados, v_retiradas;
    END IF;
  END IF;

  -- Regla 8: una marca frenada no se queda dentro de un JSON que a lo mejor
  -- nadie abre. Interrumpe, y con contenido: marca, cifras y nombres.
  --
  -- Va por `encolar_alerta` y no por `_queue_system_alert` por dos razones: el
  -- envoltorio deja `account_id` y `brand_id` en NULL —y esto es un aviso DE
  -- una cuenta y DE una marca (regla 9)—, y devuelve el id, que es lo que
  -- permite distinguir «encolado» de «callado a propósito» por el antirruido.
  --
  -- Un aviso POR MARCA, con su propia clave: si se frenan dos, el antirruido
  -- de una no tapa a la otra.
  IF p_aplicar AND v_frenadas > 0 THEN
    FOR v_marca IN
      SELECT m FROM jsonb_array_elements(v_marcas) m WHERE (m->>'frenada')::boolean
    LOOP
      v_id := public.encolar_alerta(
        p_kind    => 'catalogo_last_retiro_frenado',
        p_subject => format('Last: no se han retirado los extras de %s', v_marca->>'marca'),
        p_message => format(
            'El importador de Last iba a apagar %s de las %s opciones de extra de %s (%s %%) y no ha apagado ninguna: %s. '
         || 'O Last ha cambiado la carta de verdad, o la pasada vino incompleta. Hasta que se mire, esas opciones siguen encendidas. '
         || 'Son: %s.',
            v_marca->>'sobran', v_marca->>'activas', v_marca->>'marca', v_marca->>'pct',
            v_marca->>'motivo_del_freno',
            (SELECT string_agg(o->>'opcion', ', ') FROM jsonb_array_elements(v_marca->'opciones') o)),
        p_debounce_kind   => 'catalogo_last_retiro_frenado:' || (v_marca->>'marca'),
        p_debounce_window => interval '6 hours',
        p_account_id      => p_account_id,
        p_brand_id        => (v_marca->>'brand_id')::uuid,
        p_severity        => 'aviso'
      );
      IF v_id IS NULL THEN v_callados := v_callados + 1;
      ELSE                 v_avisados := v_avisados + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok',                 true,
    'aplicado',           p_aplicar,
    'marcas_visitadas',   v_visitadas,
    'opciones_en_last',   COALESCE(array_length(p_option_ext_ids, 1), 0),
    'opciones_retiradas', v_retiradas,
    'opciones_a_retirar', COALESCE(array_length(v_a_retirar, 1), 0),
    'codigos_rescatables',  v_rescatables,
    'codigos_rescatados',   v_rescatados,
    'retiradas_sin_codigo', v_sin_codigo,
    'marcas_frenadas',    v_frenadas,
    'avisos_encolados',   v_avisados,
    'avisos_callados_por_antirruido', v_callados,
    'sin_referencia_no_tocadas',      v_sin_ref,
    'freno',  jsonb_build_object('max_por_marca', p_max_por_marca, 'max_pct', p_max_pct),
    'marcas', v_marcas
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.modificadores_plan_de_retiro(uuid, uuid[], text[], boolean, integer, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.modificadores_plan_de_retiro(uuid, uuid[], text[], boolean, integer, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.modificadores_plan_de_retiro(uuid, uuid[], text[], boolean, integer, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.modificadores_plan_de_retiro(uuid, uuid[], text[], boolean, integer, numeric) TO service_role;

-- La comprobación de permisos va DENTRO de la migración, no después. El 11/09
-- p21 salió con la puerta abierta a `anon` porque `proacl` se miró cuando la
-- migración ya estaba aplicada, que es tarde.
DO $acl$
DECLARE v_acl text;
BEGIN
  SELECT array_to_string(p.proacl, ' | ') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'modificadores_plan_de_retiro';
  -- PUBLIC sale como `=X/postgres`, con el hueco del beneficiario vacío: hay
  -- que anclarlo al principio o detrás del separador, o `service_role=X/…` lo
  -- dispara también y la guarda se vuelve inútil.
  IF v_acl IS NULL
     OR v_acl LIKE '%anon=%'
     OR v_acl LIKE '%authenticated=%'
     OR v_acl LIKE '=X/%'
     OR v_acl LIKE '%| =X/%' THEN
    RAISE EXCEPTION 'A2c: permisos mal puestos en modificadores_plan_de_retiro -> %', COALESCE(v_acl, '(nulo)');
  END IF;
  RAISE NOTICE 'A2c permisos: %', v_acl;
END
$acl$;
