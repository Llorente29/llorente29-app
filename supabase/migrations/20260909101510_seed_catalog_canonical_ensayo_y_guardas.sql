-- ══════════════════════════════════════════════════════════════════════════
-- APLICADA el 09/09 por Julio (F2) · versión 20260909101510
-- ══════════════════════════════════════════════════════════════════════════
--
-- Este es el fichero que se revisó y se aplicó. Se guarda en el repo con la
-- versión que registró la base (regla 17) y con su cuerpo íntegro (regla 1: una
-- corrección que sólo vive en el desplegado tiene fecha de caducidad).
--
-- ── LO APLICADO ES LO REVISADO, COMPROBADO ────────────────────────────────
-- El cuerpo vivo llegó con los comentarios recortados (7.422 caracteres frente
-- a los 8.691 de aquí), así que las huellas en bruto NO coinciden y eso por sí
-- solo no dice nada. Quitando comentarios y normalizando espacios con la MISMA
-- vara a los dos lados —regexp en la base, regexp en el fichero— sale idéntico:
--
--   md5 sin comentarios ... 7dee5da51c17e98ebdaa7d0bea1be6ae   (los dos)
--   caracteres ............ 5.692                              (los dos)
--
-- Una sola firma, `SECURITY DEFINER` y `search_path` conservados, `anon` no
-- puede ejecutarla y `authenticated` sí. Todo verificado con
-- `has_function_privilege`, no con el texto del ACL.
--
-- POR QUÉ FALTABAN LOS COMENTARIOS: los perdió Julio al reescribir esta
-- migración a mano antes de aplicarla, no la herramienta al aplicarla. Escribí
-- lo contrario y estaba mal. La siguiente (20260909105036) se aplicó fiel y su
-- cuerpo vivo es idéntico EN BRUTO al fichero, comentarios incluidos.
--
-- ⚠️ ESTA VERSIÓN TIENE UN AGUJERO, ENCONTRADO DESPUÉS DE APLICARLA. La guarda
-- de propiedad pregunta `brand.ownership_type`, y esa etiqueta puede estar mal:
-- «Lobbers» figura como `licensed` y sus 22 matrículas sólo existen en la org
-- de las PROPIAS, que además está muerta (404). Con esta versión, «Sembrar
-- escandallos» crearía 17 platos y NUEVE serían de ese cadáver; y de los 43
-- precios por canal, 22 se calcularían contra ese mismo espejo muerto.
-- La corrección está en `PENDIENTE_seed_catalog_canonical_guarda_por_origen.sql`
-- y baja los 17 a 8. Hasta aplicarla: SIMULAR sí, SEMBRAR no.
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
