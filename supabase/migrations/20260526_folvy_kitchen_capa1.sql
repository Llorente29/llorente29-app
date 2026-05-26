-- =====================================================================
-- MIGRATION: Módulo Cocina — Capa 1 (columna vertebral del escandallo)
-- Folvy V1 · cuenta multi-tenant · RLS por account_id (patrón Bloque S)
--
-- Tablas: kitchen_unit, kitchen_cut_type, recipe_item, recipe_line
-- NO incluye: menu_item (Capa 2), allergen/supplier (huecos), ventas (TPV).
--
-- REVISAR ANTES DE EJECUTAR. Propuesta del coordinador; ejecuta Julio.
-- Prefijo kitchen_ en unit/cut_type para evitar colisión con posibles
-- 'unit' genéricos. recipe_* sin prefijo porque son inequívocos.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. kitchen_unit — unidades de medida y sus conversiones
--    factor_to_base: cuántas unidades-base hay en 1 de esta unidad.
--    dimension agrupa lo convertible entre sí (no se mezcla peso y vol).
--    is_seed: fila sembrada de fábrica (account_id NULL = global).
-- ---------------------------------------------------------------------
CREATE TABLE public.kitchen_unit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  name            text NOT NULL,
  abbreviation    text NOT NULL,
  dimension       text NOT NULL,
  factor_to_base  numeric NOT NULL,
  is_base         boolean NOT NULL DEFAULT false,
  is_seed         boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  created_by_name text,
  CONSTRAINT kitchen_unit_dimension_valid
    CHECK (dimension IN ('weight', 'volume', 'unit')),
  CONSTRAINT kitchen_unit_factor_positive
    CHECK (factor_to_base > 0),
  CONSTRAINT kitchen_unit_seed_consistency
    CHECK ( (is_seed AND account_id IS NULL) OR (NOT is_seed AND account_id IS NOT NULL) )
);

CREATE INDEX idx_kitchen_unit_account   ON public.kitchen_unit(account_id);
CREATE INDEX idx_kitchen_unit_dimension ON public.kitchen_unit(dimension);

-- ---------------------------------------------------------------------
-- 2. kitchen_cut_type — tipos de corte/despiece (limpio, fileteado…)
-- ---------------------------------------------------------------------
CREATE TABLE public.kitchen_cut_type (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  created_by_name text
);

CREATE INDEX idx_kitchen_cut_type_account ON public.kitchen_cut_type(account_id);

-- ---------------------------------------------------------------------
-- 3. recipe_item — el componente unificado (ingrediente, receta, plato)
-- ---------------------------------------------------------------------
CREATE TABLE public.recipe_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  type            text NOT NULL,
  name            text NOT NULL,
  alt_name        text,
  code            text,
  base_unit_id    uuid NOT NULL REFERENCES public.kitchen_unit(id) ON DELETE RESTRICT,
  cost_strategy   text NOT NULL DEFAULT 'fixed',
  fixed_cost      numeric,
  computed_cost   numeric,
  cost_updated_at timestamptz,
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  created_by_name text,
  CONSTRAINT recipe_item_type_valid
    CHECK (type IN ('raw', 'recipe', 'tool', 'dish')),
  CONSTRAINT recipe_item_cost_strategy_valid
    CHECK (cost_strategy IN ('fixed', 'average')),
  CONSTRAINT recipe_item_fixed_cost_nonneg
    CHECK (fixed_cost IS NULL OR fixed_cost >= 0),
  CONSTRAINT recipe_item_computed_cost_nonneg
    CHECK (computed_cost IS NULL OR computed_cost >= 0)
);

CREATE INDEX idx_recipe_item_account ON public.recipe_item(account_id);
CREATE INDEX idx_recipe_item_type    ON public.recipe_item(account_id, type);

-- ---------------------------------------------------------------------
-- 4. recipe_line — una línea de la receta (padre usa hijo; autorref = sub-recetas)
-- ---------------------------------------------------------------------
CREATE TABLE public.recipe_line (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  parent_item_id  uuid NOT NULL REFERENCES public.recipe_item(id) ON DELETE CASCADE,
  child_item_id   uuid NOT NULL REFERENCES public.recipe_item(id) ON DELETE RESTRICT,
  quantity_net    numeric NOT NULL,
  quantity_gross  numeric,
  unit_id         uuid NOT NULL REFERENCES public.kitchen_unit(id) ON DELETE RESTRICT,
  cut_type_id     uuid REFERENCES public.kitchen_cut_type(id) ON DELETE SET NULL,
  comment         text,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipe_line_no_self_reference
    CHECK (parent_item_id <> child_item_id),
  CONSTRAINT recipe_line_qty_net_positive
    CHECK (quantity_net > 0),
  CONSTRAINT recipe_line_qty_gross_positive
    CHECK (quantity_gross IS NULL OR quantity_gross >= quantity_net)
);

CREATE INDEX idx_recipe_line_parent ON public.recipe_line(parent_item_id);
CREATE INDEX idx_recipe_line_child  ON public.recipe_line(child_item_id);
CREATE UNIQUE INDEX uq_recipe_line_parent_child
  ON public.recipe_line(parent_item_id, child_item_id, position);

-- ---------------------------------------------------------------------
-- 5. Triggers de updated_at
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_kitchen_unit_updated_at
  BEFORE UPDATE ON public.kitchen_unit
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_kitchen_cut_type_updated_at
  BEFORE UPDATE ON public.kitchen_cut_type
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_recipe_item_updated_at
  BEFORE UPDATE ON public.recipe_item
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_recipe_line_updated_at
  BEFORE UPDATE ON public.recipe_line
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- 6. RLS — patrón Bloque S
-- ---------------------------------------------------------------------
ALTER TABLE public.kitchen_unit     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_cut_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_item      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_line      ENABLE ROW LEVEL SECURITY;

CREATE POLICY kitchen_unit_select ON public.kitchen_unit
  FOR SELECT USING (
    account_id IS NULL OR public.belongs_to_account(account_id)
  );
CREATE POLICY kitchen_unit_insert ON public.kitchen_unit
  FOR INSERT WITH CHECK (
    account_id IS NOT NULL AND public.current_user_is_admin_or_manager_of(account_id)
  );
CREATE POLICY kitchen_unit_update ON public.kitchen_unit
  FOR UPDATE USING (
    account_id IS NOT NULL AND public.current_user_is_admin_or_manager_of(account_id)
  );
CREATE POLICY kitchen_unit_delete ON public.kitchen_unit
  FOR DELETE USING (
    account_id IS NOT NULL AND public.current_user_is_admin_or_manager_of(account_id)
  );

CREATE POLICY kitchen_cut_type_select ON public.kitchen_cut_type
  FOR SELECT USING ( public.belongs_to_account(account_id) );
CREATE POLICY kitchen_cut_type_insert ON public.kitchen_cut_type
  FOR INSERT WITH CHECK ( public.current_user_is_admin_or_manager_of(account_id) );
CREATE POLICY kitchen_cut_type_update ON public.kitchen_cut_type
  FOR UPDATE USING ( public.current_user_is_admin_or_manager_of(account_id) );
CREATE POLICY kitchen_cut_type_delete ON public.kitchen_cut_type
  FOR DELETE USING ( public.current_user_is_admin_or_manager_of(account_id) );

CREATE POLICY recipe_item_select ON public.recipe_item
  FOR SELECT USING ( public.belongs_to_account(account_id) );
CREATE POLICY recipe_item_insert ON public.recipe_item
  FOR INSERT WITH CHECK ( public.current_user_is_admin_or_manager_of(account_id) );
CREATE POLICY recipe_item_update ON public.recipe_item
  FOR UPDATE USING ( public.current_user_is_admin_or_manager_of(account_id) );
CREATE POLICY recipe_item_delete ON public.recipe_item
  FOR DELETE USING ( public.current_user_is_admin_or_manager_of(account_id) );

CREATE POLICY recipe_line_select ON public.recipe_line
  FOR SELECT USING ( public.belongs_to_account(account_id) );
CREATE POLICY recipe_line_insert ON public.recipe_line
  FOR INSERT WITH CHECK ( public.current_user_is_admin_or_manager_of(account_id) );
CREATE POLICY recipe_line_update ON public.recipe_line
  FOR UPDATE USING ( public.current_user_is_admin_or_manager_of(account_id) );
CREATE POLICY recipe_line_delete ON public.recipe_line
  FOR DELETE USING ( public.current_user_is_admin_or_manager_of(account_id) );

-- ---------------------------------------------------------------------
-- 7. Semilla de unidades estándar
-- ---------------------------------------------------------------------
INSERT INTO public.kitchen_unit (name, abbreviation, dimension, factor_to_base, is_base, is_seed) VALUES
  ('Gramo',      'g',  'weight', 1,    true,  true),
  ('Kilogramo',  'kg', 'weight', 1000, false, true),
  ('Mililitro',  'ml', 'volume', 1,    true,  true),
  ('Litro',      'L',  'volume', 1000, false, true),
  ('Unidad',     'ud', 'unit',   1,    true,  true);

COMMIT;
