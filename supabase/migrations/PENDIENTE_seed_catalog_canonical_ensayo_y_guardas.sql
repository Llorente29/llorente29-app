-- ══════════════════════════════════════════════════════════════════════════
-- «Sembrar escandallos» · paso 2 — ensayo, guarda de propiedad y guarda de foto
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIN APLICAR. Nombre provisional: se renombra a la versión que registre la
-- base (regla 17). Transaccional: o entra entera o no entra.
--
-- ── POR QUÉ ES DROP + CREATE Y NO REPLACE ─────────────────────────────────
-- Añade parámetros. `CREATE OR REPLACE` con una firma distinta no reemplaza:
-- crea una SOBRECARGA, y a partir de ahí las llamadas de un argumento son
-- ambiguas (regla 2, la que dejó a los siete vigías sin encolar el 27/08).
-- Nadie más la llama: `pg_proc.prosrc ilike '%seed_catalog_canonical%'` sobre
-- las demás funciones da 0 filas. El único llamador es el panel de admin.
--
-- ── LO QUE HACE HOY, MEDIDO SOBRE FOODINT EL 09/09 ────────────────────────
--
--   matrículas miradas ................................. 419
--   ya existen (no se tocan) ........................... 307
--   candidatas ......................................... 112
--     · sin marca en Folvy («Van Van») .................  18
--     · de marca PROPIA ................................  65   ← no debería
--     · fuera de la última foto de su org ..............  12   ← no debería
--     · cedidas y en la foto ...........................  17   ← esto sí
--
-- O sea: el botón que hoy dice «Sembrar escandallos» crearía 94, y 77 de esas
-- 94 están mal. No es que el código falle: hace lo que dice su código. Lo que
-- no hace es lo que promete su nombre.
--
-- ── LA GUARDA DE FRESCURA NO SE MIDE CONTRA `now()` ───────────────────────
-- El encargo pedía «vistos en los últimos N días». Medido, esa vara está mal,
-- y el fallo es silencioso (regla 39: se mide con la vara del sistema que se
-- va a gobernar). Las dos orgs de Foodint tienen fotos de fechas distintas:
--
--   Cloudtown (cedidas) .... última foto 08/09 23:00 .... 3.360 filas
--   Foodint   (propias) .... última foto 05/09 23:00 .... 1.084 filas
--
-- Un corte de «3 días desde hoy» se llevaría por delante la org de Foodint
-- ENTERA, y no porque Last haya dejado de servir nada: porque nadie ha
-- refrescado ese espejo desde el 05. `seen_in_catalog_at` mide CUÁNDO MIRAMOS,
-- no cuándo lo sirvió Last. Confundirlas es la regla 30: la pantalla diría
-- «Last no lo sirve desde el 05/09» de algo que sí sirve.
--
-- Así que la vara es la ÚLTIMA FOTO DE SU PROPIA ORG: ¿estaba este producto la
-- última vez que miramos ESE catálogo? El corte es nítido — una pasada sella
-- todas sus filas en la misma hora, así que a 1 hora y a 1 día salen los mismos
-- números (2.749 dentro / 611 fuera en Cloudtown; 574 / 510 en Foodint) — y el
-- margen queda como parámetro por si algún día una pasada se alarga.
--
-- Y la antigüedad de cada foto SALE EN EL RESULTADO (`fotos`), porque sembrar
-- de una foto de hace cuatro días es una decisión, no un detalle.
--
-- ── LO QUE NO CAMBIA, A PROPÓSITO ─────────────────────────────────────────
-- · La capa de overrides sigue exactamente como está para los 307 que ya
--   existen. Sí se CUENTA aparte cuántos de los overrides saldrían de una foto
--   que no es la última (`overrides_de_foto_vieja`): la cifra se enseña y la
--   decisión de ponerle guarda es de Julio, no mía.
-- · El excluido `'FOODINT'` y el alias `'Dirty Burgers'→'Dirty Burger'` siguen
--   escritos a fuego dentro de la función. Es deuda vista, no de este encargo.
-- · El uuid de la unidad «Unidad» sigue a fuego. Igual.
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
-- ── LA PREDICCIÓN, PARA QUE EL ENSAYO PUEDA LLEVARME LA CONTRARIA ─────────
-- Con `p_dry_run => true` sobre Foodint, esta función tiene que devolver
-- EXACTAMENTE:
--
--   matriculas_miradas ................ 419
--   base_ya_existentes ................ 307
--   productos_base_creados ............  17
--   saltados_sin_marca ................  18   (marcas_sin_resolver = {Van Van})
--   saltados_por_ser_propia ...........  65
--   saltados_por_no_estar_en_la_foto ..  12
--
--   y 419 = 307 + 17 + 18 + 65 + 12. Si sale otra cosa, o mi cuenta está mal o
--   la función no hace lo que creo: en cualquiera de los dos casos NO se pulsa
--   nada hasta saber cuál de las dos. `overrides_creados` no lo predigo — es
--   justo para lo que sirve el ensayo.
--
-- ── YA ESTÁ PROBADA. NO A MANO: LA FUNCIÓN, CORRIENDO ─────────────────────
-- Este cuerpo exacto se creó como copia desechable —`_prueba_seed_ensayo`, sin
-- SECURITY DEFINER y revocada de public/anon/authenticated— se corrió en
-- ensayo sobre Foodint, y se borró (quedan 0 copias). Compila y devuelve:
--
--   matriculas_miradas ................ 419  ✓ predicho
--   base_ya_existentes ................ 307  ✓
--   productos_base_creados ............  17  ✓
--   saltados_sin_marca ................  18  ✓   marcas_sin_resolver = {Van Van}
--   saltados_por_ser_propia ...........  65  ✓
--   saltados_por_no_estar_en_la_foto ..  12  ✓
--   suma de las partes ................ 419  = matriculas_miradas
--
--   overrides_creados .................  43  (no predicho: para esto es el ensayo)
--   overrides_de_foto_vieja ...........   2  de esos 43
--
-- Y NO ESCRIBIÓ NADA, medido a los dos lados con la misma vara (regla 31), en
-- la misma sentencia que la llamó:
--
--   recipe_item .......... antes 394  después 394   (decía que crearía 17)
--   menu_item ............ antes 633  después 633
--   menu_item_override ... antes  58  después  58   (decía que crearía 43)
--
-- Prueba de más, y es la que menos se puede falsear: dos pasadas seguidas del
-- ensayo dieron las MISMAS 307 ya existentes y los MISMOS 17 a crear. Si la
-- primera hubiera escrito, la segunda habría dicho 324 y 0.
--
-- ── LAS 5 MARCAS PROPIAS QUE SE DEJAN DE SEMBRAR (regla 7: se listan) ─────
--   Milanesa House (24) · Meraki Pita (16) · Smash Brothers Burgers (14)
--   Dirty Burgers (6) · Bendito Burrito (5)
--
--   ⚠️ «Milanesa House» es PROPIA y «Milanesa Haus» es CEDIDA. Dos marcas
--   distintas a una letra. La resolución es por nombre exacto normalizado, así
--   que hoy no se confunden — pero conviene saberlo antes de tocar el alias.
--
-- ── LOS 12 QUE SE QUEDAN FUERA POR LA FOTO ────────────────────────────────
-- Nueve son del 21/06 y dos del 30/08. Y casi todos son PACKS:
--   Chivuos ......... Pack Single Hero · Pack Chicken Single Hero ·
--                     Pack Deluxe Para Dos · CHIVUO´S® BURGER (30/08)
--   Ay Mamita ....... Birria Lunch · Mamita Duo · Birria Chicken Bowl ·
--                     Birria + Tequeños · GRINGAS DE QUESO (30/08)
--   Dos Coyotes ..... PACK UNO PA UNO · PACK PA 2
--   Big Mike´s ...... Menú Doble Big Mikes
-- Sembrarlos crearía doce `recipe_item type='dish'` para packs que Last ya no
-- sirve como producto. Eso es exactamente lo que la guarda evita.
--
-- ── LA FOTO DE CADA ORG, EN EL MOMENTO DEL ENSAYO ─────────────────────────
--   Cloudtown (cedidas) ... 08/09 23:00 ... hace  10,5 h ... 3.360 filas
--   Foodint   (propias) ... 05/09 23:00 ... hace  82,5 h ... 1.084 filas
-- Sale en el resultado (`fotos`) para que se vea antes de decidir.
--
-- ── AL APLICAR ESTO, EL BOTÓN «SEMBRAR ESCANDALLOS» SE ROMPE ──────────────
-- `p_dry_run` no tiene valor por defecto, así que la llamada de un argumento
-- que hace el panel hoy deja de existir y la pantalla dará error. Es a
-- propósito y es el orden correcto: primero la migración, después la rama con
-- la pantalla nueva. Mientras tanto ese botón no había que pulsarlo igual
-- (§4 del encargo). «Recasar ventas» no se toca y sigue funcionando.
-- ══════════════════════════════════════════════════════════════════════════

begin;

drop function if exists public.seed_catalog_canonical(uuid);

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
  saltados_sin_marca               integer,
  saltados_por_ser_propia          integer,
  saltados_por_no_estar_en_la_foto integer,
  marcas_sin_resolver              text[],
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
  v_nomarca    integer := 0;
  v_propia     integer := 0;
  v_vieja      integer := 0;
  v_marcas_nom text[] := '{}';
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
           'ultima_foto',  t.ultima_foto,
           'horas',        round(extract(epoch FROM (now() - t.ultima_foto)) / 3600.0, 1),
           'filas',        t.filas)
           ORDER BY t.ultima_foto DESC), '[]'::jsonb)
    INTO v_fotos
    FROM (SELECT ecp.external_org_id,
                 max(ecp.seen_in_catalog_at) AS ultima_foto,
                 count(*)                    AS filas
            FROM public.external_catalog_product ecp
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
      -- ¿estaba en la última foto de SU org? (no «de los últimos N días»)
      bool_or(ecp.seen_in_catalog_at >= f.ultima_foto - p_margen_foto) AS en_la_foto
    FROM external_catalog_product ecp
    JOIN foto f ON f.external_org_id = ecp.external_org_id
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
      -- ── 3. Guarda de propiedad: sembrar es cosa de marcas CEDIDAS ───────
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

      -- ── 4. Guarda de foto: sólo lo que estaba la última vez que miramos ──
      -- Sembrar de una foto vieja no es sembrar, es resucitar. Sale con su
      -- fecha, para que se pueda mirar antes de decidir.
      IF NOT COALESCE(v_prod.en_la_foto, false) THEN
        v_vieja := v_vieja + 1;
        v_lista := v_lista || jsonb_build_object(
          'producto',             v_prod.product_name,
          'marca',                v_prod.brand_name,
          'visto_por_ultima_vez', v_prod.visto);
        CONTINUE;
      END IF;

      -- ── 5. Crear: artículo físico + presentación base ───────────────────
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

    -- ── CAPA OVERRIDES: igual que antes, exista o no el base ──────────────
    -- En ensayo, cuando el base todavía no existe, v_menu_id es NULL: el
    -- EXISTS de abajo no encuentra nada y el override cuenta como nuevo, que
    -- es justo lo que pasaría de verdad.
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
          IF NOT COALESCE(v_prod.en_la_foto, false) THEN
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
  saltados_sin_marca               := v_nomarca;
  saltados_por_ser_propia          := v_propia;
  saltados_por_no_estar_en_la_foto := v_vieja;
  marcas_sin_resolver              := v_marcas_nom;
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
