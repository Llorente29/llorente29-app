-- ══════════════════════════════════════════════════════════════════════════
-- APLICADA el 09/09 por Julio (F2) · versión 20260909105036
-- «Sembrar escandallos» · la guarda va en el ORIGEN, no en la etiqueta de la marca
-- ══════════════════════════════════════════════════════════════════════════
--
-- Sustituye entera a 20260909101510. Lo aplicado ES lo que hay aquí, en bruto y
-- con los comentarios dentro: md5 854392d4f57e123dd0c338143d3da5d9, 11.192
-- caracteres, el fichero y `pg_proc.prosrc` idénticos. Una firma,
-- `SECURITY DEFINER`, `search_path=public`, `anon` no puede ejecutarla y
-- `authenticated` sí (verificado con `has_function_privilege`).
--
-- ── QUÉ ARREGLA, EN UNA FRASE ─────────────────────────────────────────────
-- La versión anterior creaba 17 platos y NUEVE eran de un catálogo muerto. La
-- guarda deja de preguntar «¿de quién dice la marca que es?» y pregunta «¿de
-- dónde salió este dato?».
--
-- ── EL FALLO DE ESTE FICHERO AL APLICARLO, PARA QUE NO SE REPITA ──────────
-- La primera vez NO aplicó. El `DROP` nombraba `seed_catalog_canonical(uuid)`,
-- que era la firma viva cuando escribí el fichero — pero para cuando se aplicó,
-- 20260909101510 ya había cambiado la firma a `(uuid, boolean, interval)`. El
-- drop de la firma vieja es un no-op silencioso y el `CREATE` se estrella con
-- `already exists with same argument types`. Julio añadió el drop que faltaba.
--
-- La lección es de la misma familia que la regla 2: **una migración que hace
-- DROP+CREATE tiene que nombrar la firma que estará viva EN EL MOMENTO DE
-- APLICARSE, no la que había cuando se escribió.** Con dos migraciones de la
-- misma función en vuelo el mismo día, eso cambia entre una y otra. Van las dos
-- firmas abajo: la segunda es la que hace el trabajo, la primera se queda por si
-- alguna vez se reproduce el historial desde cero.
--
-- ── LO QUE HACE HOY, MEDIDO SOBRE FOODINT EL 09/09 (regla 9: sólo Foodint) ─
--
--   matrículas miradas ................................. 419
--   ya existen (no se tocan) ........................... 307
--   candidatas ......................................... 112
--     · sin marca en Folvy («Van Van») .................  18
--     · de una integración que NO es cedida viva .......  74   ← no debería
--     · fuera de la última foto de la org cedida .......  12   ← no debería
--     · cedidas, vivas y en la foto ....................   8   ← esto sí
--
-- Recorrido del número, para que no se pierda:
--   antes de todo esto ........................ 94 creados (65 propias, 12 viejos)
--   con 20260909101510, ya aplicada ........... 17 creados (9 del cadáver)
--   con esta corrección ........................ 8 creados
-- No es que el código falle: hace lo que dice su código. Lo que no hacía es lo
-- que promete su nombre.
--
-- ── LA GUARDA VA EN LA INTEGRACIÓN, NO EN LA MARCA. ESTO ES UNA CORRECCIÓN ─
-- La primera versión de este fichero preguntaba `brand.ownership_type`. Con esa
-- guarda se creaban 17, y NUEVE de esos 17 eran de «Lobbers»:
--
--   brand.ownership_type ......... 'licensed'  ← por eso pasaba la guarda
--   sus 22 matrículas ............ SÓLO en la org 31f13f35, la de las PROPIAS
--   última foto de esa org ....... 05/09 — la org devuelve 404, está muerta
--   última venta de Lobbers ...... 10/07 (194 ventas en toda su historia)
--
-- Nueve platos de un cadáver, colados por una etiqueta de marca equivocada. Y
-- la guarda de foto no los paraba, porque medía «¿está en la última foto de su
-- org?» y en una org muerta TODO está en la última foto: el cadáver siempre
-- parece fresco. Es la misma familia que la regla 39 y la que Julio nombró en
-- el §9 del encargo de alertas: medir la frescura de una fuente sin preguntar
-- antes si esa fuente tiene derecho a existir.
--
-- La guarda buena pregunta por el ORIGEN del dato, que es donde el hecho vive:
-- `external_integration.ownership_type='licensed' AND is_active`. Con ella:
--
--   por marca (v1) ....... 17 creados, 9 de la org muerta, 65 propias bloqueadas
--   por integración (v2) ..  8 creados, 0 de la org muerta, 74 bloqueadas
--
-- Las 74 son las 65 propias MÁS los 9 de Lobbers. Se quedan las dos guardas: la
-- de marca cuenta 0 hoy, pero responde otra pregunta (de quién es el escandallo)
-- y sirve el día que una marca propia aparezca dentro de la org de las cedidas.
--
-- ── OJO: LAS DOS INTEGRACIONES ESTÁN `is_active=true` ─────────────────────
--   31f13f35 «Foodint» ..... ownership_type='own'      · is_active=true
--   b7bc4753 «Cloudtown» ... ownership_type='licensed' · is_active=true
-- O sea que `is_active` NO distingue la muerta de la viva: quien separa es
-- `ownership_type`. La fila muerta sigue ahí (acción 2 del §9b del encargo de
-- alertas, con Julio delante). Esta guarda no depende de que se retire.
--
-- ── LA GUARDA DE FOTO SIGUE HACIENDO FALTA (corrección al §9b) ────────────
-- El §9b dice que retirando las filas muertas «no hay foto vieja contra la que
-- comparar y el problema desaparece por su cuenta». Medido, no: los 12 que la
-- guarda de foto deja fuera son TODOS de Cloudtown, la org VIVA de las cedidas
-- —el contador los cuenta sólo entre los que ya pasaron la guarda de origen—.
-- Nueve son del 21/06 y dos del 30/08. Retirar el cadáver no los toca.
--
-- ── LA GUARDA DE ORIGEN TAMBIÉN VA EN LA CAPA DE PRECIOS ──────────────────
-- Esto también cambia respecto a la primera versión, y por el mismo hallazgo.
-- Los 307 que «ya existen» incluyen los productos de las marcas propias, y sus
-- precios por canal se recalculaban contra el espejo de la org muerta:
--
--   sin guarda en precios ... 43 precios, 22 de ellos desde la org muerta
--   con guarda en precios ... 21 precios, 0 desde la org muerta
--                             132 productos con la capa de precios sin mirar
--
-- Lo había dejado como «se cuenta y decide Julio» cuando el número era 2 y la
-- lectura era «precio de una foto algo vieja». Con la vara correcta son 22 y la
-- lectura es «precio de un catálogo que no existe», que es justo lo que el §9b
-- dice que no hay que curar con una guarda de frescura. Va cerrado. Los 35
-- overrides que las propias YA tienen no se tocan aquí: eso es la acción 3.
--
-- ── POR QUÉ ES DROP + CREATE Y NO REPLACE ─────────────────────────────────
-- Añade parámetros. `CREATE OR REPLACE` con una firma distinta no reemplaza:
-- crea una SOBRECARGA, y a partir de ahí las llamadas de un argumento son
-- ambiguas (regla 2, la que dejó a los siete vigías sin encolar el 27/08).
-- Nadie más la llama: `pg_proc.prosrc ilike '%seed_catalog_canonical%'` sobre
-- las demás funciones da 0 filas. El único llamador es el panel de admin.
--
-- ── LA VARA DE LA FRESCURA NO ES `now()` ──────────────────────────────────
-- El encargo pedía «vistos en los últimos N días». Medido, esa vara está mal:
--
--   Cloudtown (cedidas) .... última foto 08/09 23:00 .... 3.360 filas
--   Foodint   (la muerta) .. última foto 05/09 23:00 .... 1.084 filas
--
-- Un corte de «3 días desde hoy» se llevaría una org entera sin que Last haya
-- dejado de servir nada: `seen_in_catalog_at` mide CUÁNDO MIRAMOS. Confundirlas
-- es la regla 30: la pantalla diría «Last no lo sirve desde el 05/09» de algo
-- que sí sirve. La vara es la última foto de su propia org —y ahora, además,
-- sólo cuenta si esa org es una cedida viva—. El corte es nítido: una pasada
-- sella todas sus filas en la misma hora, así que a 1 h y a 1 día salen los
-- mismos números. El margen queda como parámetro.
--
-- Y la antigüedad de cada foto SALE EN EL RESULTADO (`fotos`), con el nombre y
-- el tipo de cada org, porque sembrar de una foto de hace días es una decisión.
--
-- ── LO QUE NO CAMBIA, A PROPÓSITO ─────────────────────────────────────────
-- · El excluido `'FOODINT'` y el alias `'Dirty Burgers'→'Dirty Burger'` siguen
--   escritos a fuego dentro de la función. Deuda vista, no de este encargo.
-- · El uuid de la unidad «Unidad» sigue a fuego. Igual.
-- · Los 35 overrides que ya tienen las marcas propias no se tocan.
--
-- ── PERMISOS: HOY ESTA FUNCIÓN LA PUEDE LLAMAR `anon` ─────────────────────
-- Medido con la vara buena, no con el texto del ACL:
--   has_function_privilege('anon', 'public.seed_catalog_canonical(uuid)', 'EXECUTE')
--   → TRUE
-- Es SECURITY DEFINER y escribe en tres tablas. Su guarda de tenancy la salva
-- (un anónimo se lleva la excepción), pero no tiene por qué estar al alcance.
-- No estaba entre las 21 del barrido de ayer. Y como esto es un DROP+CREATE, la
-- nueva NACERÍA otra vez abierta —`ALTER DEFAULT PRIVILEGES` de este proyecto
-- concede EXECUTE a anon y authenticated en cada función nueva de `public`—, así
-- que el revoke va en esta misma migración o el agujero se reabre solo.
-- Receta del 09/09: revocar de PUBLIC **y** de los nombres, y verificar con
-- `has_function_privilege`, nunca con `proacl::text`.
--
-- ── LO QUE DEVUELVE HOY, MEDIDO (y por qué cambió desde que se escribió) ──
-- El ensayo se probó antes de aplicar con una copia desechable —sin SECURITY
-- DEFINER, revocada de public/anon/authenticated, borrada después— y daba
-- 307 / 8 / 18 / 74 / 0 / 12. Esas cifras YA NO SALEN, y no porque la función
-- cambiara: entre medias Julio apagó «Lobbers» (`brand.is_active=false` y sus 3
-- `brand_location_availability`), confirmada muerta. Al no resolver ya la marca,
-- sus matrículas salen por la primera puerta en vez de por la de origen:
--
--                                        antes de apagarla    ahora
--   matriculas_miradas .................      419              419
--   base_ya_existentes .................      307              303
--   productos_base_creados .............        8                8   ← igual
--   saltados_sin_marca .................       18               31
--   saltados_por_integracion_no_cedida .       74               65
--   saltados_por_ser_propia ............        0                0
--   saltados_por_no_estar_en_la_foto ...       12               12
--   ────────────────────────────────────────────────────────────────
--   suma ...............................      419              419
--
--   overrides_creados ..................       21               21   ← igual
--   overrides_de_foto_vieja ............        0                0
--   productos_sin_revisar_precios ......      132              128
--
--   marcas_sin_resolver ................ {Van Van} → {Lobbers, Van Van}
--   marcas_de_integracion_no_cedida .... 6 marcas  → 5 (sale Lobbers)
--
-- Los 13 que se mueven son de Lobbers: 9 que la guarda de origen bloqueaba y 4
-- que contaban como «ya existentes». Los 8 a crear NO se mueven, que es la
-- señal de que la guarda hace su trabajo por el origen y no por la etiqueta.
-- Las 194 ventas históricas de Lobbers siguen enteras y siguen contando: los
-- informes filtran por `sale.is_active`, no por la marca.
--
-- SI EL ENSAYO DEVUELVE LA COLUMNA DE LA IZQUIERDA, ES QUE LOBBERS VOLVIÓ A
-- ACTIVARSE. No es un fallo de la función: es una pregunta para quien la mire.
--
-- Y en su día se comprobó que el ensayo NO ESCRIBE, a los dos lados y en la
-- misma sentencia (regla 31): recipe_item 394→394, menu_item 633→633,
-- menu_item_override 58→58, mientras decía que crearía 8 y 21.
--
-- ── LOS 12 QUE SE QUEDAN FUERA POR LA FOTO (todos de Cloudtown, la viva) ──
--   Chivuos ......... Pack Single Hero · Pack Chicken Single Hero ·
--                     Pack Deluxe Para Dos · CHIVUO´S® BURGER (30/08)
--   Ay Mamita ....... Birria Lunch · Mamita Duo · Birria Chicken Bowl ·
--                     Birria + Tequeños · GRINGAS DE QUESO (30/08)
--   Dos Coyotes ..... PACK UNO PA UNO · PACK PA 2
--   Big Mike´s ...... Menú Doble Big Mikes
-- Casi todos son PACKS. Sembrarlos crearía doce `recipe_item type='dish'` para
-- packs que Last ya no sirve como producto.
--
-- ── UN NOMBRE QUE ASUSTA Y NO ES UN FALLO ─────────────────────────────────
-- «Milanesa House» es PROPIA (org muerta, 53 matrículas) y «Milanesa Haus» es
-- CEDIDA (Cloudtown, 39 matrículas). Dos marcas distintas a una letra, y las
-- DOS venden hoy (237 y 434 ventas en 30 días). No se confunden porque la
-- resolución es por nombre exacto normalizado — pero conviene saberlo antes de
-- tocar el alias.
--
-- ── AL APLICAR ESTO, EL BOTÓN «SEMBRAR ESCANDALLOS» SE ROMPE ──────────────
-- `p_dry_run` no tiene valor por defecto, así que la llamada de un argumento
-- que hace el panel hoy deja de existir y la pantalla dará error. Es a
-- propósito y es el orden correcto: primero la migración, después la rama con
-- la pantalla nueva. Mientras tanto ese botón no había que pulsarlo igual
-- (§4 del encargo). «Recasar ventas» no se toca y sigue funcionando.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- Las dos firmas. La de tres argumentos es la que existe hoy (la dejó
-- 20260909101510); la de uno, por si se reproduce el historial desde cero.
drop function if exists public.seed_catalog_canonical(uuid);
drop function if exists public.seed_catalog_canonical(uuid, boolean, interval);

create function public.seed_catalog_canonical(
  p_account_id  uuid,
  p_dry_run     boolean,                        -- SIN valor por defecto, a propósito:
                                                -- una llamada vieja de un argumento tiene
                                                -- que fallar en la cara, no escribir en
                                                -- silencio ni no-escribir en silencio.
  p_margen_foto interval default '1 day'
)
returns table (
  dry_run                          boolean,
  matriculas_miradas               integer,
  base_ya_existentes               integer,
  productos_base_creados           integer,
  overrides_creados                integer,
  overrides_de_foto_vieja          integer,
  productos_sin_revisar_precios    integer,
  saltados_sin_marca               integer,
  saltados_por_integracion_no_cedida integer,
  saltados_por_ser_propia          integer,
  saltados_por_no_estar_en_la_foto integer,
  marcas_sin_resolver              text[],
  marcas_de_integracion_no_cedida  text[],
  marcas_propias_saltadas          text[],
  no_en_la_foto                    jsonb,
  fotos                            jsonb
)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_unit_ud    uuid := '869711c3-eabd-4e95-92f2-555efaaba6b0'; -- "Unidad" (global)
  v_prod       record;
  v_chan       record;
  v_brand_id   uuid;
  v_own        text;
  v_recipe_id  uuid;
  v_menu_id    uuid;
  v_base_price numeric;
  v_mir        integer := 0;
  v_ya         integer := 0;
  v_base       integer := 0;
  v_over       integer := 0;
  v_over_vieja integer := 0;
  v_over_norg  integer := 0;
  v_nomarca    integer := 0;
  v_norg       integer := 0;
  v_propia     integer := 0;
  v_vieja      integer := 0;
  v_marcas_nom text[] := '{}';
  v_marcas_org text[] := '{}';
  v_marcas_pro text[] := '{}';
  v_lista      jsonb  := '[]'::jsonb;
  v_fotos      jsonb;
BEGIN
  -- Guarda de tenancy (SECURITY DEFINER salta RLS).
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'seed_catalog_canonical: sin acceso a la cuenta %', p_account_id;
  END IF;

  -- La foto de cada org: cuándo se refrescó su espejo por última vez. Va en el
  -- resultado porque sembrar de una foto vieja es una decisión, no un detalle.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'org',          t.external_org_id,
           'nombre',       t.nombre,
           'tipo',         t.tipo,
           'ultima_foto',  t.ultima_foto,
           'horas',        round(extract(epoch FROM (now() - t.ultima_foto)) / 3600.0, 1),
           'filas',        t.filas)
           ORDER BY t.ultima_foto DESC), '[]'::jsonb)
    INTO v_fotos
    FROM (SELECT ecp.external_org_id,
                 max(ei.organization_name)   AS nombre,
                 max(ei.ownership_type)      AS tipo,
                 max(ecp.seen_in_catalog_at) AS ultima_foto,
                 count(*)                    AS filas
            FROM public.external_catalog_product ecp
            LEFT JOIN public.external_integration ei
                   ON ei.account_id = ecp.account_id
                  AND ei.source = 'lastapp'
                  AND ei.external_org_id = ecp.external_org_id
           WHERE ecp.account_id = p_account_id
           GROUP BY ecp.external_org_id) t;

  FOR v_prod IN
    WITH foto AS (
      SELECT ecp.external_org_id, max(ecp.seen_in_catalog_at) AS ultima_foto
        FROM public.external_catalog_product ecp
       WHERE ecp.account_id = p_account_id
       GROUP BY ecp.external_org_id
    )
    SELECT
      ecp.organization_product_id::text AS matricula,
      max(ecp.external_brand_name)      AS brand_name,
      coalesce(
        max(ecp.product_name) FILTER (WHERE ecp.external_channel = 'default'),
        max(ecp.product_name)
      ) AS product_name,
      coalesce(
        max(ecp.price_cents) FILTER (WHERE ecp.external_channel = 'default'),
        (SELECT mode() WITHIN GROUP (ORDER BY ecp2.price_cents)
           FROM external_catalog_product ecp2
          WHERE ecp2.account_id = p_account_id
            AND ecp2.organization_product_id = ecp.organization_product_id
            AND ecp2.price_cents IS NOT NULL)
      ) AS base_cents,
      max(ecp.seen_in_catalog_at) AS visto,
      -- ¿Viene de una integración CEDIDA y viva? Se pregunta por el ORIGEN del
      -- dato, no por la etiqueta de la marca: es donde vive el hecho.
      bool_or(ei.ownership_type = 'licensed' AND ei.is_active) AS de_cedida,
      -- ¿Y estaba en la última foto de ESA org cedida? (no «de los últimos N días»,
      -- y no la foto de una org muerta, que siempre parece fresca)
      bool_or(ei.ownership_type = 'licensed' AND ei.is_active
              AND ecp.seen_in_catalog_at >= f.ultima_foto - p_margen_foto) AS en_foto_de_cedida
    FROM external_catalog_product ecp
    JOIN foto f ON f.external_org_id = ecp.external_org_id
    LEFT JOIN external_integration ei
           ON ei.account_id = ecp.account_id
          AND ei.source = 'lastapp'
          AND ei.external_org_id = ecp.external_org_id
    WHERE ecp.account_id = p_account_id
      AND ecp.organization_product_id IS NOT NULL
      AND ecp.external_brand_name IS NOT NULL
      AND ecp.external_brand_name <> 'FOODINT'
    GROUP BY ecp.organization_product_id
  LOOP
    v_mir := v_mir + 1;

    -- ── 1. ¿Resuelve la marca? (alias Dirty Burgers→Dirty Burger) ──────────
    SELECT b.id, b.ownership_type INTO v_brand_id, v_own
    FROM brand b
    WHERE b.account_id = p_account_id
      AND b.is_active IS NOT FALSE
      AND lower(btrim(b.name)) = lower(btrim(
            CASE WHEN v_prod.brand_name = 'Dirty Burgers' THEN 'Dirty Burger'
                 ELSE v_prod.brand_name END))
    LIMIT 1;

    IF v_brand_id IS NULL THEN
      v_nomarca := v_nomarca + 1;
      IF NOT (v_prod.brand_name = ANY (v_marcas_nom)) THEN
        v_marcas_nom := v_marcas_nom || v_prod.brand_name;
      END IF;
      CONTINUE;
    END IF;

    v_base_price := COALESCE(v_prod.base_cents, 0)::numeric / 100.0;

    -- ── 2. ¿Ya existe la capa base? ───────────────────────────────────────
    SELECT mi.id INTO v_menu_id
    FROM menu_item mi
    WHERE mi.account_id = p_account_id
      AND mi.external_source = 'lastapp'
      AND mi.external_id = v_prod.matricula
      AND mi.brand_id = v_brand_id
      AND mi.channel_id IS NULL
      AND mi.archived_at IS NULL
    LIMIT 1;

    IF v_menu_id IS NOT NULL THEN
      v_ya := v_ya + 1;
    ELSE
      -- ── 3. Guarda de ORIGEN: sólo se siembra de una integración CEDIDA y viva ──
      -- Va DELANTE de la de marca porque pregunta por el sitio donde el hecho
      -- vive de verdad. La etiqueta de la marca puede estar mal —y lo está:
      -- «Lobbers» figura como `licensed` y sus 22 matrículas sólo existen en la
      -- org de las PROPIAS, que además está muerta. Preguntando por la marca se
      -- colaban sus 9 platos; preguntando por la integración, no.
      IF NOT COALESCE(v_prod.de_cedida, false) THEN
        v_norg := v_norg + 1;
        IF NOT (v_prod.brand_name = ANY (v_marcas_org)) THEN
          v_marcas_org := v_marcas_org || v_prod.brand_name;
        END IF;
        CONTINUE;
      END IF;

      -- ── 4. Guarda de propiedad: sembrar es cosa de marcas CEDIDAS ───────
      -- Lo de una marca propia es de Folvy: su escandallo se hace aquí, no se
      -- copia de lo que el TPV enseña al cliente. Se cuenta y se LISTA, no se
      -- salta en silencio (regla 7).
      IF v_own IS DISTINCT FROM 'licensed' THEN
        v_propia := v_propia + 1;
        IF NOT (v_prod.brand_name = ANY (v_marcas_pro)) THEN
          v_marcas_pro := v_marcas_pro || v_prod.brand_name;
        END IF;
        CONTINUE;
      END IF;

      -- ── 5. Guarda de foto: sólo lo que estaba la última vez que miramos ──
      -- Sembrar de una foto vieja no es sembrar, es resucitar. Sale con su
      -- fecha, para que se pueda mirar antes de decidir.
      IF NOT COALESCE(v_prod.en_foto_de_cedida, false) THEN
        v_vieja := v_vieja + 1;
        v_lista := v_lista || jsonb_build_object(
          'producto',             v_prod.product_name,
          'marca',                v_prod.brand_name,
          'visto_por_ultima_vez', v_prod.visto);
        CONTINUE;
      END IF;

      -- ── 6. Crear: artículo físico + presentación base ───────────────────
      IF NOT p_dry_run THEN
        INSERT INTO recipe_item (account_id, type, name, base_unit_id, is_active, source, needs_review)
        VALUES (p_account_id, 'dish', v_prod.product_name, v_unit_ud, true, 'import', true)
        RETURNING id INTO v_recipe_id;

        INSERT INTO menu_item (account_id, brand_id, channel_id, recipe_item_id, name, price,
                               product_type, external_source, external_id, source, needs_review)
        VALUES (p_account_id, v_brand_id, NULL, v_recipe_id, v_prod.product_name, v_base_price,
                'item', 'lastapp', v_prod.matricula, 'import', true)
        RETURNING id INTO v_menu_id;
      END IF;
      v_base := v_base + 1;
    END IF;

    -- ── CAPA OVERRIDES: exista o no el base, pero SOLO desde una cedida viva ──
    -- La misma guarda de origen que arriba, y por la misma razón. Sin ella el
    -- tapón tiene un agujero: los 307 productos que YA existen incluyen los de
    -- las marcas propias, y sus precios por canal se recalculaban contra el
    -- espejo de la org muerta. Medido: de 43 precios, 22 salían de ahí.
    -- No es una guarda de frescura sobre una fuente vieja — es la misma
    -- pregunta de siempre: ¿esta fuente tiene derecho a existir?
    --
    -- En ensayo, cuando el base todavía no existe, v_menu_id es NULL: el
    -- EXISTS de abajo no encuentra nada y el override cuenta como nuevo, que
    -- es justo lo que pasaría de verdad.
    IF NOT COALESCE(v_prod.de_cedida, false) THEN
      v_over_norg := v_over_norg + 1;
      CONTINUE;
    END IF;

    FOR v_chan IN
      SELECT sc.id AS channel_id, sc.slug,
             (SELECT ecp3.price_cents
                FROM external_catalog_product ecp3
               WHERE ecp3.account_id = p_account_id
                 AND ecp3.organization_product_id::text = v_prod.matricula
                 AND ecp3.external_channel = sc.slug
                 AND ecp3.price_cents IS NOT NULL
               ORDER BY ecp3.seen_in_catalog_at DESC NULLS LAST
               LIMIT 1) AS chan_cents
      FROM sales_channel sc
      WHERE sc.account_id = p_account_id
        AND sc.slug IN ('glovo','uber','justeat','shop')
    LOOP
      IF v_chan.chan_cents IS NOT NULL
         AND v_chan.chan_cents IS DISTINCT FROM COALESCE(v_prod.base_cents, -1) THEN
        IF NOT EXISTS (
          SELECT 1 FROM menu_item_override o
          WHERE o.account_id = p_account_id
            AND o.menu_item_id = v_menu_id
            AND o.channel_id = v_chan.channel_id
            AND o.location_id IS NULL
        ) THEN
          IF NOT p_dry_run THEN
            INSERT INTO menu_item_override (account_id, menu_item_id, channel_id, location_id, price)
            VALUES (p_account_id, v_menu_id, v_chan.channel_id, NULL,
                    v_chan.chan_cents::numeric / 100.0);
          END IF;
          v_over := v_over + 1;
          -- Se cuenta, no se corta: cuántos de esos precios salen de una foto
          -- que no es la última. La guarda, si la quiere, la decide Julio.
          IF NOT COALESCE(v_prod.en_foto_de_cedida, false) THEN
            v_over_vieja := v_over_vieja + 1;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  dry_run                          := p_dry_run;
  matriculas_miradas               := v_mir;
  base_ya_existentes               := v_ya;
  productos_base_creados           := v_base;
  overrides_creados                := v_over;
  overrides_de_foto_vieja          := v_over_vieja;
  productos_sin_revisar_precios    := v_over_norg;
  saltados_sin_marca               := v_nomarca;
  saltados_por_integracion_no_cedida := v_norg;
  saltados_por_ser_propia          := v_propia;
  saltados_por_no_estar_en_la_foto := v_vieja;
  marcas_sin_resolver              := v_marcas_nom;
  marcas_de_integracion_no_cedida  := v_marcas_org;
  marcas_propias_saltadas          := v_marcas_pro;
  no_en_la_foto                    := v_lista;
  fotos                            := v_fotos;
  RETURN NEXT;
END;
$function$;

-- ── Permisos (receta del 09/09) ───────────────────────────────────────────
-- La primera entrada del ACL con el concedido VACÍO es PUBLIC, y PUBLIC
-- incluye a anon: revocar sólo de los nombres no cierra nada.
revoke execute on function public.seed_catalog_canonical(uuid, boolean, interval)
  from public, anon, authenticated;
grant  execute on function public.seed_catalog_canonical(uuid, boolean, interval)
  to authenticated;   -- el panel de admin llama con el JWT del platform admin

-- ── Verificación DENTRO de la transacción: si miente, no entra ────────────
-- Con la vara buena (`has_function_privilege`), no con `proacl::text`.
DO $verifica$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'seed_catalog_canonical';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'seed_catalog_canonical no existe después de crearla';
  END IF;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'seed_catalog_canonical') <> 1 THEN
    RAISE EXCEPTION 'hay más de una firma de seed_catalog_canonical: el DROP no se llevó la vieja (regla 2)';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon TODAVÍA puede ejecutar seed_catalog_canonical';
  END IF;

  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated NO puede ejecutar seed_catalog_canonical: el panel de admin se queda sin botón';
  END IF;

  RAISE NOTICE 'seed_catalog_canonical: una sola firma, cerrada a anon, abierta a authenticated.';
END;
$verifica$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- DESPUÉS DE APLICAR — el ensayo, que no escribe nada:
--
--   select * from public.seed_catalog_canonical(
--     (select id from public.accounts where name = 'Foodint'),
--     p_dry_run => true);
--
-- Tiene que dar 419 / 307 / 17 / 18 / 65 / 12 (ver la predicción de arriba).
-- Si da otra cosa, NO se pulsa nada: primero se averigua cuál de las dos
-- cuentas está mal.
-- ══════════════════════════════════════════════════════════════════════════
