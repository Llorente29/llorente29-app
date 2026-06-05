-- =====================================================================
-- Migración: Catálogo de Marca — Fase A (modelo base + ingesta)
-- Fecha: 2026-06-05
-- Descripción: Tablas de catálogo de marca, modificadores y combos.
--   Evolución de menu_item y sale_line. RLS para todas las tablas nuevas.
--   Habilita el motor de consumo (Capa 2 del MRP II) con modifiers/combos.
-- Tramos: A1 (catálogo) + A2 (modifiers) + A3 (combos) + A4 (sale_line) + A5 (RLS)
-- =====================================================================

-- ---------------------------------------------------------------------
-- A1 — menu_category + menu_item_override + evolución menu_item
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS menu_category (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  brand_id        uuid NOT NULL REFERENCES brand(id),
  name            text NOT NULL,
  slug            text,
  emoji           text,
  position        integer NOT NULL DEFAULT 0,
  parent_id       uuid REFERENCES menu_category(id),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id, slug)
);

ALTER TABLE menu_category ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS menu_item_override (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  menu_item_id    uuid NOT NULL REFERENCES menu_item(id),
  location_id     uuid REFERENCES locations(id),
  channel_id      uuid REFERENCES sales_channel(id),
  name            text,
  short_name      text,
  description     text,
  photo_url       text,
  price           numeric,
  is_available    boolean,
  category_name   text,
  external_id     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Clave compuesta por especificidad: menu_item + location + channel.
-- COALESCE a UUID nulo para tratar NULL como "todas" en el índice único.
CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_item_override_scope
  ON menu_item_override (
    menu_item_id,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'),
    COALESCE(channel_id, '00000000-0000-0000-0000-000000000000')
  );

ALTER TABLE menu_item_override ENABLE ROW LEVEL SECURITY;

ALTER TABLE menu_item
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'item'
    CHECK (product_type IN ('item', 'combo')),
  ADD COLUMN IF NOT EXISTS menu_category_id uuid REFERENCES menu_category(id),
  ADD COLUMN IF NOT EXISTS short_name text,
  ADD COLUMN IF NOT EXISTS kitchen_name text;

-- ---------------------------------------------------------------------
-- A2 — modifier_group + modifier_option + assignment + recipe_impact
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS modifier_group (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  brand_id          uuid NOT NULL REFERENCES brand(id),
  name              text NOT NULL,
  internal_name     text,
  min_selections    integer NOT NULL DEFAULT 0,
  max_selections    integer NOT NULL DEFAULT 1,
  allow_repetition  boolean NOT NULL DEFAULT false,
  group_type        text NOT NULL DEFAULT 'choice'
    CHECK (group_type IN ('choice','extras','removal','side','cross_sell','info')),
  position          integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE modifier_group ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS modifier_option (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  modifier_group_id uuid NOT NULL REFERENCES modifier_group(id) ON DELETE CASCADE,
  name              text NOT NULL,
  recipe_item_id    uuid REFERENCES recipe_item(id),
  price_impact      numeric NOT NULL DEFAULT 0,
  is_default        boolean NOT NULL DEFAULT false,
  position          integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE modifier_option ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS modifier_group_assignment (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  modifier_group_id uuid NOT NULL REFERENCES modifier_group(id) ON DELETE CASCADE,
  menu_item_id      uuid NOT NULL REFERENCES menu_item(id) ON DELETE CASCADE,
  position          integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(modifier_group_id, menu_item_id)
);

ALTER TABLE modifier_group_assignment ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS modifier_recipe_impact (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts(id),
  modifier_option_id    uuid NOT NULL REFERENCES modifier_option(id) ON DELETE CASCADE,
  impact_type           text NOT NULL
    CHECK (impact_type IN ('replace_item','add_item','remove_item','multiply','bundle','none')),
  target_recipe_item_id uuid REFERENCES recipe_item(id),
  quantity              numeric,
  unit_id               uuid REFERENCES kitchen_unit(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE modifier_recipe_impact ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- A3 — combo_slot + combo_slot_option
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS combo_slot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  combo_item_id   uuid NOT NULL REFERENCES menu_item(id) ON DELETE CASCADE,
  name            text NOT NULL,
  min_selections  integer NOT NULL DEFAULT 1,
  max_selections  integer NOT NULL DEFAULT 1,
  position        integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE combo_slot ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS combo_slot_option (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  combo_slot_id     uuid NOT NULL REFERENCES combo_slot(id) ON DELETE CASCADE,
  menu_item_id      uuid REFERENCES menu_item(id),
  modifier_group_id uuid REFERENCES modifier_group(id),
  price_impact      numeric NOT NULL DEFAULT 0,
  is_default        boolean NOT NULL DEFAULT false,
  position          integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slot_option_target CHECK (
    (menu_item_id IS NOT NULL AND modifier_group_id IS NULL) OR
    (menu_item_id IS NULL AND modifier_group_id IS NOT NULL)
  )
);

ALTER TABLE combo_slot_option ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- A4 — evolución de sale_line (normalización de modifiers/combos)
-- ---------------------------------------------------------------------

ALTER TABLE sale_line
  ADD COLUMN IF NOT EXISTS parent_sale_line_id uuid REFERENCES sale_line(id),
  ADD COLUMN IF NOT EXISTS line_type text NOT NULL DEFAULT 'product'
    CHECK (line_type IN ('product', 'modifier', 'combo_item')),
  ADD COLUMN IF NOT EXISTS modifier_option_id uuid REFERENCES modifier_option(id),
  ADD COLUMN IF NOT EXISTS combo_slot_id uuid REFERENCES combo_slot(id);

-- ---------------------------------------------------------------------
-- A5 — RLS policies (patrón belongs_to_account, idéntico a menu_item)
--   read:  account_id = ANY (current_user_account_ids())
--   write: current_user_is_admin_of(account_id)
-- ---------------------------------------------------------------------

-- menu_category
DROP POLICY IF EXISTS menu_category_read ON menu_category;
DROP POLICY IF EXISTS menu_category_write ON menu_category;
CREATE POLICY menu_category_read ON menu_category FOR SELECT
  USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY menu_category_write ON menu_category FOR ALL
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

-- menu_item_override
DROP POLICY IF EXISTS menu_item_override_read ON menu_item_override;
DROP POLICY IF EXISTS menu_item_override_write ON menu_item_override;
CREATE POLICY menu_item_override_read ON menu_item_override FOR SELECT
  USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY menu_item_override_write ON menu_item_override FOR ALL
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

-- modifier_group
DROP POLICY IF EXISTS modifier_group_read ON modifier_group;
DROP POLICY IF EXISTS modifier_group_write ON modifier_group;
CREATE POLICY modifier_group_read ON modifier_group FOR SELECT
  USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY modifier_group_write ON modifier_group FOR ALL
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

-- modifier_option
DROP POLICY IF EXISTS modifier_option_read ON modifier_option;
DROP POLICY IF EXISTS modifier_option_write ON modifier_option;
CREATE POLICY modifier_option_read ON modifier_option FOR SELECT
  USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY modifier_option_write ON modifier_option FOR ALL
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

-- modifier_group_assignment
DROP POLICY IF EXISTS modifier_group_assignment_read ON modifier_group_assignment;
DROP POLICY IF EXISTS modifier_group_assignment_write ON modifier_group_assignment;
CREATE POLICY modifier_group_assignment_read ON modifier_group_assignment FOR SELECT
  USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY modifier_group_assignment_write ON modifier_group_assignment FOR ALL
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

-- modifier_recipe_impact
DROP POLICY IF EXISTS modifier_recipe_impact_read ON modifier_recipe_impact;
DROP POLICY IF EXISTS modifier_recipe_impact_write ON modifier_recipe_impact;
CREATE POLICY modifier_recipe_impact_read ON modifier_recipe_impact FOR SELECT
  USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY modifier_recipe_impact_write ON modifier_recipe_impact FOR ALL
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

-- combo_slot
DROP POLICY IF EXISTS combo_slot_read ON combo_slot;
DROP POLICY IF EXISTS combo_slot_write ON combo_slot;
CREATE POLICY combo_slot_read ON combo_slot FOR SELECT
  USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY combo_slot_write ON combo_slot FOR ALL
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

-- combo_slot_option
DROP POLICY IF EXISTS combo_slot_option_read ON combo_slot_option;
DROP POLICY IF EXISTS combo_slot_option_write ON combo_slot_option;
CREATE POLICY combo_slot_option_read ON combo_slot_option FOR SELECT
  USING (account_id = ANY (current_user_account_ids()));
CREATE POLICY combo_slot_option_write ON combo_slot_option FOR ALL
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

-- =====================================================================
-- FIN Fase A — verificar con:
--   information_schema.tables (8 tablas nuevas)
--   pg_policy (16 policies)
--   information_schema.columns (menu_item +4, sale_line +4)
-- =====================================================================
