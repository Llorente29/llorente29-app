-- supabase/migrations/20260620T1500_converge_c3_seed_canonico.sql
-- ============================================================================
-- CONVERGENCIA DE INGESTA — Capa 3: SEED CANÓNICO del catálogo (modelo por marca
-- + overrides por canal). Reemplaza el modelo viejo "1 menu_item por canal".
-- ============================================================================
-- v2 (20/06): IDEMPOTENCIA POR CAPA (corrige bug detectado en dry-run).
--   El v1 hacía CONTINUE si el base existía → se saltaba también los overrides,
--   dejando 40 productos con precio por canal y 0 overrides. Ahora:
--     · base: crear solo si no existe (no recrear).
--     · overrides: SIEMPRE revisar y crear los que falten, EXISTA O NO el base.
--   Así el seed converge al estado correcto desde cualquier punto de partida
--   (sembrar de cero O completar lo ya sembrado).
--
-- MODELO (decidido con datos reales 20/06):
--   · 1 menu_item BASE por (marca × producto), channel_id NULL, external_id=matrícula.
--     Su precio = PRECIO BASE (ancla del margen).
--   · Precio base = fila external_channel='default' (o moda de respaldo).
--   · menu_item_override por CANAL REAL (glovo/uber/justeat/shop) cuyo precio DIFIERA
--     del base. 'deliveroo' descartado (0 ventas). 'default' = fuente del base, no override.
--
-- AGNÓSTICO: lee external_catalog_product. IDEMPOTENTE por capa. Marca por nombre
-- (alias Dirty Burgers→Dirty Burger), FOODINT excluido. SECURITY DEFINER + guard.
-- Se entrega SOLA (DROP/CREATE + COMMENT), sin SELECT de prueba dentro.
-- ============================================================================

DROP FUNCTION IF EXISTS public.seed_catalog_canonical(uuid);

CREATE FUNCTION public.seed_catalog_canonical(p_account_id uuid)
RETURNS TABLE(
  productos_base_creados integer,
  overrides_creados       integer,
  saltados_sin_marca      integer,
  base_ya_existentes      integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_unit_ud   uuid := '869711c3-eabd-4e95-92f2-555efaaba6b0'; -- "Unidad" (global)
  v_prod      record;
  v_brand_id  uuid;
  v_recipe_id uuid;
  v_menu_id   uuid;
  v_base_price numeric;
  v_chan      record;
  v_base      integer := 0;
  v_over      integer := 0;
  v_nomarca   integer := 0;
  v_existe    integer := 0;
BEGIN
  -- Guard de tenancy (SECURITY DEFINER salta RLS).
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'seed_catalog_canonical: sin acceso a la cuenta %', p_account_id;
  END IF;

  FOR v_prod IN
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
      ) AS base_cents
    FROM external_catalog_product ecp
    WHERE ecp.account_id = p_account_id
      AND ecp.organization_product_id IS NOT NULL
      AND ecp.external_brand_name IS NOT NULL
      AND ecp.external_brand_name <> 'FOODINT'
    GROUP BY ecp.organization_product_id
  LOOP
    -- Resolver marca (alias Dirty Burgers→Dirty Burger).
    SELECT b.id INTO v_brand_id
    FROM brand b
    WHERE b.account_id = p_account_id
      AND b.is_active IS NOT FALSE
      AND lower(btrim(b.name)) = lower(btrim(
            CASE WHEN v_prod.brand_name = 'Dirty Burgers' THEN 'Dirty Burger'
                 ELSE v_prod.brand_name END))
    LIMIT 1;

    IF v_brand_id IS NULL THEN
      v_nomarca := v_nomarca + 1;
      CONTINUE;
    END IF;

    v_base_price := COALESCE(v_prod.base_cents, 0)::numeric / 100.0;

    -- ── CAPA BASE: crear solo si no existe; si existe, reutilizar su id ──
    SELECT mi.id INTO v_menu_id
    FROM menu_item mi
    WHERE mi.account_id = p_account_id
      AND mi.external_source = 'lastapp'
      AND mi.external_id = v_prod.matricula
      AND mi.brand_id = v_brand_id
      AND mi.channel_id IS NULL
      AND mi.archived_at IS NULL
    LIMIT 1;

    IF v_menu_id IS NULL THEN
      -- artículo físico + presentación base
      INSERT INTO recipe_item (account_id, type, name, base_unit_id, is_active, source, needs_review)
      VALUES (p_account_id, 'dish', v_prod.product_name, v_unit_ud, true, 'import', true)
      RETURNING id INTO v_recipe_id;

      INSERT INTO menu_item (account_id, brand_id, channel_id, recipe_item_id, name, price,
                             product_type, external_source, external_id, source, needs_review)
      VALUES (p_account_id, v_brand_id, NULL, v_recipe_id, v_prod.product_name, v_base_price,
              'item', 'lastapp', v_prod.matricula, 'import', true)
      RETURNING id INTO v_menu_id;
      v_base := v_base + 1;
    ELSE
      v_existe := v_existe + 1;
    END IF;

    -- ── CAPA OVERRIDES: SIEMPRE revisar (exista o no el base) ──
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
        -- idempotencia de override: solo si no existe ya uno para (menu_item, canal, sin local)
        IF NOT EXISTS (
          SELECT 1 FROM menu_item_override o
          WHERE o.account_id = p_account_id
            AND o.menu_item_id = v_menu_id
            AND o.channel_id = v_chan.channel_id
            AND o.location_id IS NULL
        ) THEN
          INSERT INTO menu_item_override (account_id, menu_item_id, channel_id, location_id, price)
          VALUES (p_account_id, v_menu_id, v_chan.channel_id, NULL,
                  v_chan.chan_cents::numeric / 100.0);
          v_over := v_over + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  productos_base_creados := v_base;
  overrides_creados      := v_over;
  saltados_sin_marca     := v_nomarca;
  base_ya_existentes     := v_existe;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.seed_catalog_canonical(uuid) IS
  'Seed canónico del catálogo (modelo por marca + overrides por canal). Idempotente POR CAPA: base solo si falta, overrides siempre revisados. Lee external_catalog_product. Precio base desde external_channel=default (o moda). Sustituye seed_lastapp_catalog y seed_catalog_from_lastapp.';
