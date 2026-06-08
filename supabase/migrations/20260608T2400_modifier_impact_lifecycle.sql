-- 20260608T2400_modifier_impact_lifecycle.sql
-- Aplicada: 2026-06-08
--
-- G3 (editor de impacto de modificadores) — tramo 1: ciclo de vida del impacto.
--
-- modifier_recipe_impact pasa de "tabla de impactos" a "tabla con ciclo de vida":
--   status='proposed'  -> la IA (o un import) propuso este impacto. NO toca el coste.
--   status='confirmed' -> un humano lo validó (o auto-confirmado por confianza, Nivel 3
--                         cuando se active). El motor de coste SOLO usa estos.
--
-- Esto implementa el "el sistema aprende y no repite":
--   - Nivel 1 (memoria): un confirmed queda y se reutiliza siempre.
--   - Nivel 2 (propuesta IA): la IA escribe filas 'proposed'; el humano confirma -> 'confirmed'.
--     SIEMPRE hay un humano entre la IA y el coste (proposed no cuenta para coste).
--   - Nivel 3 (auto-confirmación, DORMIDO): escribir 'confirmed' con source='ai' directamente
--     cuando confidence sea muy alta. HOY el umbral hace que nada se auto-confirme (todo
--     'proposed' -> revisión humana). Se activa cuando haya histórico que lo justifique.
--
-- Anti-invención: una propuesta de IA NUNCA corrompe el coste, porque el motor filtra
-- status='confirmed'. Si la IA se equivoca, el humano lo ve y corrige antes de confirmar.

BEGIN;

ALTER TABLE public.modifier_recipe_impact
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS rationale text,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS confirmed_by_name text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Constraints de dominio (idempotentes)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='modifier_recipe_impact_status_valid') THEN
    ALTER TABLE public.modifier_recipe_impact
      ADD CONSTRAINT modifier_recipe_impact_status_valid
      CHECK (status IN ('proposed','confirmed','rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='modifier_recipe_impact_source_valid') THEN
    ALTER TABLE public.modifier_recipe_impact
      ADD CONSTRAINT modifier_recipe_impact_source_valid
      CHECK (source IN ('human','ai','import'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='modifier_recipe_impact_conf_range') THEN
    ALTER TABLE public.modifier_recipe_impact
      ADD CONSTRAINT modifier_recipe_impact_conf_range
      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
  END IF;
END $$;

-- Índice para listar lo pendiente de revisar por cuenta rápido
CREATE INDEX IF NOT EXISTS modifier_recipe_impact_status_idx
  ON public.modifier_recipe_impact (account_id, status);

-- El motor de coste SOLO debe usar impactos confirmados. Ajustamos los dos puntos de
-- compute_sale_line_cost (producto y combo) para filtrar status='confirmed'. El resto
-- de la función es idéntico a 20260608T2200.
CREATE OR REPLACE FUNCTION public.compute_sale_line_cost(p_sale_line_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_line        sale_line%ROWTYPE;
  v_account_id  uuid;
  v_mi          menu_item%ROWTYPE;
  v_base_cost   numeric;
  v_mod_total   numeric := 0;
  v_norm        text;
  v_elem        jsonb;
  v_mod         jsonb;
  v_comp        jsonb;
  v_impact      record;
  v_total       numeric;
  v_is_combo    boolean := false;
  v_combo_total numeric := 0;
  v_comp_cost   numeric;
  v_comp_recipe uuid;
  v_comp_base   numeric;
  v_comp_mod    numeric;
  v_incomplete  boolean := false;
BEGIN
  SELECT * INTO v_line FROM sale_line WHERE id = p_sale_line_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_account_id := v_line.account_id;

  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'compute_sale_line_cost: sin acceso a la cuenta %', v_account_id;
  END IF;

  IF v_line.menu_item_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_mi FROM menu_item WHERE id = v_line.menu_item_id;

  v_norm := regexp_replace(
              regexp_replace(btrim(lower(public.unaccent(coalesce(v_line.product_name,'')))), '\.$', ''),
              '\s+', ' ', 'g');
  SELECT rp.elem INTO v_elem
  FROM sale s, lateral jsonb_array_elements(s.raw_products::jsonb) rp(elem)
  WHERE s.id = v_line.sale_id
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(rp.elem->>'name','')))), '\.$', ''),
          '\s+', ' ', 'g') = v_norm
  LIMIT 1;

  v_is_combo := (v_elem IS NOT NULL
                 AND jsonb_typeof(v_elem->'comboProducts') = 'array'
                 AND jsonb_array_length(v_elem->'comboProducts') > 0);

  IF v_is_combo THEN
    FOR v_comp IN SELECT * FROM jsonb_array_elements(v_elem->'comboProducts')
    LOOP
      SELECT lpm.recipe_item_id INTO v_comp_recipe
      FROM lastapp_product_map lpm
      WHERE lpm.account_id = v_account_id
        AND lpm.organization_product_id = nullif(v_comp->>'organizationProductId','')::uuid
      LIMIT 1;
      IF v_comp_recipe IS NULL THEN v_incomplete := true; CONTINUE; END IF;

      SELECT COALESCE(ri.computed_cost, ri.fixed_cost) INTO v_comp_base
      FROM recipe_item ri WHERE ri.id = v_comp_recipe;
      IF v_comp_base IS NULL THEN v_incomplete := true; CONTINUE; END IF;

      v_comp_mod := 0;
      IF jsonb_typeof(v_comp->'modifiers') = 'array' THEN
        FOR v_mod IN SELECT * FROM jsonb_array_elements(v_comp->'modifiers')
        LOOP
          FOR v_impact IN
            SELECT mri.impact_type, mri.target_recipe_item_id, mri.quantity, mri.unit_id,
                   COALESCE((v_mod->>'quantity')::numeric, 1) AS mod_qty
            FROM modifier_option mo
            JOIN modifier_recipe_impact mri ON mri.modifier_option_id = mo.id
            WHERE mo.account_id = v_account_id
              AND mo.external_id = (v_mod->>'organizationModifierId')
              AND mri.status = 'confirmed'      -- SOLO confirmados tocan el coste
          LOOP
            IF v_impact.impact_type IN ('add_item','bundle','replace_item') THEN
              v_comp_mod := v_comp_mod + public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
            ELSIF v_impact.impact_type = 'remove_item' THEN
              v_comp_mod := v_comp_mod - public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
            ELSIF v_impact.impact_type = 'multiply' THEN
              v_comp_mod := v_comp_mod + v_comp_base * (COALESCE(v_impact.quantity,1) - 1);
            END IF;
          END LOOP;
        END LOOP;
      END IF;

      v_comp_cost := (v_comp_base + v_comp_mod) * COALESCE((v_comp->>'quantity')::numeric, 1);
      v_combo_total := v_combo_total + v_comp_cost;
    END LOOP;

    IF v_incomplete THEN
      UPDATE sale_line SET computed_cost = NULL, cost_computed_at = now() WHERE id = p_sale_line_id;
      RETURN NULL;
    END IF;
    v_total := ROUND(v_combo_total * COALESCE(v_line.quantity, 1), 6);
    UPDATE sale_line SET computed_cost = v_total, cost_computed_at = now() WHERE id = p_sale_line_id;
    RETURN v_total;
  END IF;

  IF v_mi.recipe_item_id IS NULL THEN
    UPDATE sale_line SET computed_cost = NULL, cost_computed_at = now() WHERE id = p_sale_line_id;
    RETURN NULL;
  END IF;

  SELECT COALESCE(ri.computed_cost, ri.fixed_cost) INTO v_base_cost
  FROM recipe_item ri WHERE ri.id = v_mi.recipe_item_id;
  IF v_base_cost IS NULL THEN
    UPDATE sale_line SET computed_cost = NULL, cost_computed_at = now() WHERE id = p_sale_line_id;
    RETURN NULL;
  END IF;

  IF v_elem IS NOT NULL AND jsonb_typeof(v_elem->'modifiers') = 'array' THEN
    FOR v_mod IN SELECT * FROM jsonb_array_elements(v_elem->'modifiers')
    LOOP
      FOR v_impact IN
        SELECT mri.impact_type, mri.target_recipe_item_id, mri.quantity, mri.unit_id,
               COALESCE((v_mod->>'quantity')::numeric, 1) AS mod_qty
        FROM modifier_option mo
        JOIN modifier_recipe_impact mri ON mri.modifier_option_id = mo.id
        WHERE mo.account_id = v_account_id
          AND mo.external_id = (v_mod->>'organizationModifierId')
          AND mri.status = 'confirmed'         -- SOLO confirmados tocan el coste
      LOOP
        IF v_impact.impact_type IN ('add_item','bundle','replace_item') THEN
          v_mod_total := v_mod_total + public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
        ELSIF v_impact.impact_type = 'remove_item' THEN
          v_mod_total := v_mod_total - public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
        ELSIF v_impact.impact_type = 'multiply' THEN
          v_mod_total := v_mod_total + v_base_cost * (COALESCE(v_impact.quantity,1) - 1);
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  v_total := ROUND((v_base_cost + v_mod_total) * COALESCE(v_line.quantity, 1), 6);
  UPDATE sale_line SET computed_cost = v_total, cost_computed_at = now() WHERE id = p_sale_line_id;
  RETURN v_total;
END;
$function$;

COMMIT;
