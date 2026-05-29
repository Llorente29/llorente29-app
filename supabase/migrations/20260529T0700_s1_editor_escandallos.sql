-- ============================================================================
-- Migration: S1 — Schema V1 Editor de Escandallos
-- Fecha:     2026-05-29 (sesión técnica)
-- Aplicada:  Supabase project xzmpnchlguibclvxyynt (eu-west-1)
--
-- Contenido (4 bloques, ejecutados y verificados contra information_schema):
--   A) 14 tablas nuevas + RLS + ALTERs sobre recipe_item/kitchen_settings/kitchen_cut_type
--   B) 110 filas semilla (55 familias + 25 tags + 14 alérgenos + 16 cortes)
--   C) 2 funciones helper IA + 4 triggers (3× updated_at + anti-ciclos recipe_line)
--   D) Backfill cuenta interna (1 kitchen_settings + 55 familias + 214 versiones v1)
--
-- Notas / hallazgos de la sesión:
--   - recipe_item.type CHECK admite ('raw','recipe','tool','dish'). NO existe 'preparation'.
--     Las preparaciones intermedias se modelan como type='recipe'.
--   - Se reutiliza la columna 'code' existente (formato CBxxxxxx); NO se añade 'short_code'.
--   - NO se añade 'comment' a recipe_item (solapa con 'notes').
--   - FKs a user_profiles (plural). user_profiles.user_id = auth.uid().
--   - RLS: patrón belongs_to_account / current_user_is_admin_or_manager_of.
--     Catálogos globales = lectura abierta a authenticated, escritura solo service_role.
--   - icon: slug en allergen+tag (estándar sector / cara al cliente),
--           emoji en dish_family+cut_type (organizativo interno).
-- ============================================================================

BEGIN;

-- ############################################################################
-- BLOQUE A — Tablas nuevas + RLS + ALTERs
-- ############################################################################

-- ========== A.1 CATÁLOGOS GLOBALES ==========

CREATE TABLE dish_family_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name_es text NOT NULL,
  name_en text NOT NULL,
  icon text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tag_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name_es text NOT NULL,
  name_en text NOT NULL,
  color text,
  icon text,
  "group" text CHECK ("group" IN ('diet','flavor','origin','commercial','operational')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kitchen_cut_type_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name_es text NOT NULL,
  name_en text NOT NULL,
  icon text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE allergen (
  code text PRIMARY KEY,
  name_es text NOT NULL,
  name_en text NOT NULL,
  icon text NOT NULL,
  eu_reference text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dish_family_template      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_template              ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_cut_type_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE allergen                  ENABLE ROW LEVEL SECURITY;

CREATE POLICY dish_family_template_select      ON dish_family_template      FOR SELECT USING (true);
CREATE POLICY tag_template_select              ON tag_template              FOR SELECT USING (true);
CREATE POLICY kitchen_cut_type_template_select ON kitchen_cut_type_template FOR SELECT USING (true);
CREATE POLICY allergen_select                  ON allergen                  FOR SELECT USING (true);

GRANT SELECT ON dish_family_template      TO authenticated;
GRANT SELECT ON tag_template              TO authenticated;
GRANT SELECT ON kitchen_cut_type_template TO authenticated;
GRANT SELECT ON allergen                  TO authenticated;

-- ========== A.2 TABLAS POR CUENTA (referenciadas por ALTERs) ==========

CREATE TABLE dish_family (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  template_id uuid REFERENCES dish_family_template(id) ON DELETE SET NULL,
  name text NOT NULL,
  color text,
  icon text,
  position int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  template_id uuid REFERENCES tag_template(id) ON DELETE SET NULL,
  name text NOT NULL,
  color text,
  icon text,
  "group" text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dish_family ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag         ENABLE ROW LEVEL SECURITY;

CREATE POLICY dish_family_select ON dish_family FOR SELECT USING (belongs_to_account(account_id));
CREATE POLICY dish_family_insert ON dish_family FOR INSERT WITH CHECK (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY dish_family_update ON dish_family FOR UPDATE USING (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY dish_family_delete ON dish_family FOR DELETE USING (current_user_is_admin_or_manager_of(account_id));

CREATE POLICY tag_select ON tag FOR SELECT USING (belongs_to_account(account_id));
CREATE POLICY tag_insert ON tag FOR INSERT WITH CHECK (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY tag_update ON tag FOR UPDATE USING (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY tag_delete ON tag FOR DELETE USING (current_user_is_admin_or_manager_of(account_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON dish_family TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tag         TO authenticated;

-- ========== A.3 ALTERs sobre tablas existentes ==========

ALTER TABLE recipe_item
  ADD COLUMN family_id uuid REFERENCES dish_family(id),
  ADD COLUMN is_stockable boolean NOT NULL DEFAULT false,
  ADD COLUMN completeness jsonb,
  ADD COLUMN chef_notes text,
  ADD COLUMN prep_notes text,
  ADD COLUMN finishing_notes text,
  ADD COLUMN steps_auto_split boolean NOT NULL DEFAULT false,
  ADD COLUMN season_start date,
  ADD COLUMN season_end date,
  ADD COLUMN recyclable_packaging jsonb,
  ADD COLUMN supplier_codes jsonb,
  ADD COLUMN shelf_life_days int,
  ADD COLUMN label_override text,
  ADD COLUMN label_simplified boolean NOT NULL DEFAULT false,
  ADD COLUMN category text,
  ADD COLUMN supplier_name text,
  ADD COLUMN supplier_url text,
  ADD COLUMN last_purchase_date date,
  ADD COLUMN current_stock numeric,
  ADD COLUMN current_stock_unit_id uuid REFERENCES kitchen_unit(id),
  ADD COLUMN review_notes jsonb,
  ADD COLUMN review_dismissed_at timestamptz,
  ADD COLUMN review_dismissed_by uuid REFERENCES user_profiles(id),
  ADD COLUMN review_dismissed_reason text;

-- needs_review ya existía en BBDD (drift); documentado aquí (no-op seguro).
ALTER TABLE recipe_item
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

ALTER TABLE kitchen_settings
  ADD COLUMN audit_threshold_default numeric NOT NULL DEFAULT 0.70,
  ADD COLUMN audit_mode_default text NOT NULL DEFAULT 'shadow'
    CHECK (audit_mode_default IN ('shadow','notify_manager','notify_cook')),
  ADD COLUMN audit_shadow_min_samples int NOT NULL DEFAULT 14,
  ADD COLUMN photo_retention_days int NOT NULL DEFAULT 180,
  ADD COLUMN transcription_language text NOT NULL DEFAULT 'es-ES',
  ADD COLUMN ai_default_model text NOT NULL DEFAULT 'haiku',
  ADD COLUMN ai_escalation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN version_alert_pct numeric NOT NULL DEFAULT 10,
  ADD COLUMN cost_window_days_default int NOT NULL DEFAULT 30,
  ADD COLUMN allow_negative_yield boolean NOT NULL DEFAULT false,
  ADD COLUMN max_recipe_depth_warning int NOT NULL DEFAULT 4,
  ADD COLUMN price_rounding text NOT NULL DEFAULT 'none'
    CHECK (price_rounding IN ('none','psychological_99','half_euro','whole_euro')),
  ADD CONSTRAINT kitchen_settings_account_uniq UNIQUE (account_id);

ALTER TABLE kitchen_cut_type
  ADD COLUMN template_id uuid REFERENCES kitchen_cut_type_template(id),
  ADD COLUMN icon text;

-- ========== A.4 RESTO DE TABLAS NUEVAS ==========

CREATE TABLE recipe_item_ai_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_item_id uuid REFERENCES recipe_item(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('photo','voice','conversational','manual_assistance')),
  input_files jsonb,
  input_text text,
  transcription_raw text,
  raw_response jsonb,
  parsed_result jsonb,
  decisions jsonb,
  ai_model text,
  ai_cost_eur numeric,
  ai_latency_ms int,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','accepted','rejected','draft')),
  user_correction_count int NOT NULL DEFAULT 0,
  user_abandoned boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE recipe_item_ai_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY recipe_item_ai_session_select ON recipe_item_ai_session FOR SELECT USING (belongs_to_account(account_id));
CREATE POLICY recipe_item_ai_session_insert ON recipe_item_ai_session FOR INSERT WITH CHECK (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY recipe_item_ai_session_update ON recipe_item_ai_session FOR UPDATE USING (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY recipe_item_ai_session_delete ON recipe_item_ai_session FOR DELETE USING (current_user_is_admin_or_manager_of(account_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_item_ai_session TO authenticated;

CREATE TABLE recipe_item_tag (
  recipe_item_id uuid NOT NULL REFERENCES recipe_item(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_item_id, tag_id)
);

CREATE TABLE recipe_item_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_item_id uuid NOT NULL REFERENCES recipe_item(id) ON DELETE CASCADE,
  position int NOT NULL,
  text text NOT NULL,
  kind text NOT NULL DEFAULT 'cooking' CHECK (kind IN ('prep','cooking','finishing','serving')),
  duration_min int,
  temperature_c numeric,
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recipe_item_photo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_item_id uuid NOT NULL REFERENCES recipe_item(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  photo_url text NOT NULL,
  caption text,
  photo_kind text CHECK (photo_kind IN ('emplatado_oficial','ingredientes','paso_a_paso','packaging')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recipe_item_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_item_id uuid NOT NULL REFERENCES recipe_item(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  snapshot jsonb NOT NULL,
  computed_cost numeric,
  status text NOT NULL DEFAULT 'active',
  is_milestone boolean NOT NULL DEFAULT false,
  milestone_label text,
  change_note text,
  created_by uuid REFERENCES user_profiles(id),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recipe_item_allergen (
  recipe_item_id uuid NOT NULL REFERENCES recipe_item(id) ON DELETE CASCADE,
  allergen_code text NOT NULL REFERENCES allergen(code),
  state text NOT NULL CHECK (state IN ('contains','may_contain_traces','does_not_contain','unknown')),
  source text NOT NULL CHECK (source IN ('inherited','manual','automatic')),
  manual_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_item_id, allergen_code)
);

CREATE TABLE recipe_item_production_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_item_id uuid NOT NULL REFERENCES recipe_item(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id),
  photo_url text NOT NULL,
  reference_photo_url text,
  match_score numeric(3,2),
  issues jsonb,
  ai_model text,
  ai_cost_eur numeric,
  ai_latency_ms int,
  cook_decision text CHECK (cook_decision IN ('replated','passed_with_reason','passed_silently')),
  cook_reason text,
  is_false_positive boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES user_profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recipe_item_tag              ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_item_step             ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_item_photo            ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_item_version          ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_item_allergen         ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_item_production_check ENABLE ROW LEVEL SECURITY;

CREATE POLICY recipe_item_tag_select ON recipe_item_tag FOR SELECT
  USING (belongs_to_account((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_tag_insert ON recipe_item_tag FOR INSERT
  WITH CHECK (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_tag_update ON recipe_item_tag FOR UPDATE
  USING (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_tag_delete ON recipe_item_tag FOR DELETE
  USING (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));

CREATE POLICY recipe_item_step_select ON recipe_item_step FOR SELECT
  USING (belongs_to_account((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_step_insert ON recipe_item_step FOR INSERT
  WITH CHECK (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_step_update ON recipe_item_step FOR UPDATE
  USING (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_step_delete ON recipe_item_step FOR DELETE
  USING (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));

CREATE POLICY recipe_item_photo_select ON recipe_item_photo FOR SELECT
  USING (belongs_to_account((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_photo_insert ON recipe_item_photo FOR INSERT
  WITH CHECK (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_photo_update ON recipe_item_photo FOR UPDATE
  USING (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_photo_delete ON recipe_item_photo FOR DELETE
  USING (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));

CREATE POLICY recipe_item_version_select ON recipe_item_version FOR SELECT
  USING (belongs_to_account((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_version_insert ON recipe_item_version FOR INSERT
  WITH CHECK (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_version_update ON recipe_item_version FOR UPDATE
  USING (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_version_delete ON recipe_item_version FOR DELETE
  USING (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));

CREATE POLICY recipe_item_allergen_select ON recipe_item_allergen FOR SELECT
  USING (belongs_to_account((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_allergen_insert ON recipe_item_allergen FOR INSERT
  WITH CHECK (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_allergen_update ON recipe_item_allergen FOR UPDATE
  USING (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_allergen_delete ON recipe_item_allergen FOR DELETE
  USING (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));

CREATE POLICY recipe_item_production_check_select ON recipe_item_production_check FOR SELECT
  USING (belongs_to_account((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_production_check_insert ON recipe_item_production_check FOR INSERT
  WITH CHECK (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_production_check_update ON recipe_item_production_check FOR UPDATE
  USING (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));
CREATE POLICY recipe_item_production_check_delete ON recipe_item_production_check FOR DELETE
  USING (current_user_is_admin_or_manager_of((SELECT ri.account_id FROM recipe_item ri WHERE ri.id = recipe_item_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_item_tag              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_item_step             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_item_photo            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_item_version          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_item_allergen         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_item_production_check TO authenticated;

CREATE TABLE user_saved_view (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  scope text NOT NULL,
  name text NOT NULL,
  filters jsonb NOT NULL,
  sort_by text,
  sort_dir text CHECK (sort_dir IN ('asc','desc')),
  view_mode text CHECK (view_mode IN ('list','cards','table')),
  is_pinned boolean NOT NULL DEFAULT false,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_saved_view ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_saved_view_select ON user_saved_view FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = user_saved_view.user_id AND up.user_id = auth.uid()));
CREATE POLICY user_saved_view_insert ON user_saved_view FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = user_saved_view.user_id AND up.user_id = auth.uid()));
CREATE POLICY user_saved_view_update ON user_saved_view FOR UPDATE
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = user_saved_view.user_id AND up.user_id = auth.uid()));
CREATE POLICY user_saved_view_delete ON user_saved_view FOR DELETE
  USING (EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = user_saved_view.user_id AND up.user_id = auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON user_saved_view TO authenticated;


-- ############################################################################
-- BLOQUE B — Semillas catálogos globales (110 filas)
-- ############################################################################

-- ========== B.1 — 55 FAMILIAS (emoji) ==========
INSERT INTO dish_family_template (code, name_es, name_en, icon, position) VALUES
  ('aperitivo_snack','Aperitivo / Snack','Appetizer / Snack','🫒',1),
  ('tapa_pincho','Tapa / Pincho','Tapa / Pincho','🍢',2),
  ('racion','Ración','Sharing plate','🍽️',3),
  ('entrante_frio','Entrante frío','Cold starter','🥗',4),
  ('entrante_caliente','Entrante caliente','Hot starter','♨️',5),
  ('frito','Frito','Fried','🍤',6),
  ('sopa_crema','Sopa / Crema','Soup / Cream','🥣',7),
  ('ensalada','Ensalada','Salad','🥬',8),
  ('bowl_caliente','Bowl caliente','Hot bowl','🍲',9),
  ('pasta','Pasta','Pasta','🍝',10),
  ('arroz','Arroz','Rice','🍚',11),
  ('pizza','Pizza','Pizza','🍕',12),
  ('burger','Hamburguesa','Burger','🍔',13),
  ('bocadillo','Bocadillo','Sandwich','🥖',14),
  ('pita_kebab','Pita / Kebab','Pita / Kebab','🥙',15),
  ('burrito_wrap','Burrito / Wrap','Burrito / Wrap','🌯',16),
  ('taco_tortilla','Taco / Tortilla','Taco / Tortilla','🌮',17),
  ('milanesa_empanado','Milanesa / Empanado','Schnitzel / Breaded','🍗',18),
  ('guiso_estofado','Guiso / Estofado','Stew','🍛',19),
  ('parrilla_brasa','Parrilla / Brasa','Grill','🔥',20),
  ('pescado','Pescado','Fish','🐟',21),
  ('marisco','Marisco','Seafood','🦐',22),
  ('wok_salteado','Wok / Salteado','Wok / Stir-fry','🥡',23),
  ('sushi_crudo','Sushi / Crudo','Sushi / Raw','🍣',24),
  ('dumpling_bao','Dumpling / Bao','Dumpling / Bao','🥟',25),
  ('ramen_noodles','Ramen / Noodles','Ramen / Noodles','🍜',26),
  ('acompanamiento','Acompañamiento','Side','🍟',27),
  ('salsa_dip','Salsa / Dip','Sauce / Dip','🥫',28),
  ('extra','Extra','Extra','➕',29),
  ('pan','Pan','Bread','🍞',30),
  ('desayuno','Desayuno','Breakfast','🍳',31),
  ('tostada','Tostada','Toast','🥪',32),
  ('bolleria','Bollería','Pastry','🥐',33),
  ('reposteria','Repostería','Baking','🧁',34),
  ('postre','Postre','Dessert','🍮',35),
  ('tarta','Tarta','Cake','🍰',36),
  ('helado_sorbete','Helado / Sorbete','Ice cream / Sorbet','🍨',37),
  ('granizado','Granizado','Slush','🧊',38),
  ('cafe','Café','Coffee','☕',39),
  ('te_infusion','Té / Infusión','Tea / Infusion','🍵',40),
  ('refresco','Refresco','Soft drink','🥤',41),
  ('zumo_smoothie','Zumo / Smoothie','Juice / Smoothie','🧃',42),
  ('cerveza','Cerveza','Beer','🍺',43),
  ('vino_copa','Vino (copa)','Wine (glass)','🍷',44),
  ('vino_botella','Vino (botella)','Wine (bottle)','🍾',45),
  ('vermut_aperitivo','Vermut / Aperitivo','Vermouth / Aperitif','🍸',46),
  ('coctel','Cóctel','Cocktail','🍹',47),
  ('sin_alcohol','Sin alcohol','Non-alcoholic','🚱',48),
  ('combo_pack','Combo / Pack','Combo / Pack','🎁',49),
  ('menu_dia','Menú del día','Daily menu','📋',50),
  ('menu_degustacion','Menú degustación','Tasting menu','🍱',51),
  ('menu_kids','Menú infantil','Kids menu','🧒',52),
  ('preparacion','Preparación','Preparation','🧑‍🍳',53),
  ('packaging','Packaging','Packaging','📦',54),
  ('material','Material','Supplies','🧰',55);

-- ========== B.2 — 25 ETIQUETAS (slug + color por grupo) ==========
INSERT INTO tag_template (code, name_es, name_en, color, icon, "group") VALUES
  ('vegano','Vegano','Vegan','#16a34a','tag-vegano','diet'),
  ('vegetariano','Vegetariano','Vegetarian','#16a34a','tag-vegetariano','diet'),
  ('sin_gluten','Sin gluten','Gluten-free','#16a34a','tag-sin_gluten','diet'),
  ('sin_lactosa','Sin lactosa','Lactose-free','#16a34a','tag-sin_lactosa','diet'),
  ('sin_frutos_secos','Sin frutos secos','Nut-free','#16a34a','tag-sin_frutos_secos','diet'),
  ('halal','Halal','Halal','#16a34a','tag-halal','diet'),
  ('kosher','Kosher','Kosher','#16a34a','tag-kosher','diet'),
  ('keto','Keto','Keto','#16a34a','tag-keto','diet'),
  ('bajo_calorias','Bajo en calorías','Low calorie','#16a34a','tag-bajo_calorias','diet'),
  ('picante','Picante','Spicy','#ea580c','tag-picante','flavor'),
  ('muy_picante','Muy picante','Very spicy','#ea580c','tag-muy_picante','flavor'),
  ('dulce','Dulce','Sweet','#ea580c','tag-dulce','flavor'),
  ('umami','Umami','Umami','#ea580c','tag-umami','flavor'),
  ('km0','Km 0','Local sourced','#2563eb','tag-km0','origin'),
  ('ecologico','Ecológico','Organic','#2563eb','tag-ecologico','origin'),
  ('artesano','Artesano','Artisan','#2563eb','tag-artesano','origin'),
  ('premium','Premium','Premium','#2563eb','tag-premium','origin'),
  ('top_ventas','Top ventas','Best seller','#9333ea','tag-top_ventas','commercial'),
  ('novedad','Novedad','New','#9333ea','tag-novedad','commercial'),
  ('estacional','Estacional','Seasonal','#9333ea','tag-estacional','commercial'),
  ('recomendado_chef','Recomendado del chef','Chef recommended','#9333ea','tag-recomendado_chef','commercial'),
  ('apto_compartir','Apto para compartir','Shareable','#6b7280','tag-apto_compartir','operational'),
  ('delivery_friendly','Apto delivery','Delivery friendly','#6b7280','tag-delivery_friendly','operational'),
  ('solo_local','Solo en local','Dine-in only','#6b7280','tag-solo_local','operational'),
  ('hora_punta_no','Evitar hora punta','Avoid rush hour','#6b7280','tag-hora_punta_no','operational');

-- ========== B.3 — 14 ALÉRGENOS UE 1169/2011 (slug; estado por color en UI) ==========
INSERT INTO allergen (code, name_es, name_en, icon, eu_reference, position) VALUES
  ('gluten','Gluten','Cereals containing gluten','allergen-gluten','Anexo II.1',1),
  ('crustaceans','Crustáceos','Crustaceans','allergen-crustaceans','Anexo II.2',2),
  ('eggs','Huevos','Eggs','allergen-eggs','Anexo II.3',3),
  ('fish','Pescado','Fish','allergen-fish','Anexo II.4',4),
  ('peanuts','Cacahuetes','Peanuts','allergen-peanuts','Anexo II.5',5),
  ('soy','Soja','Soybeans','allergen-soy','Anexo II.6',6),
  ('milk','Lácteos','Milk','allergen-milk','Anexo II.7',7),
  ('nuts','Frutos de cáscara','Tree nuts','allergen-nuts','Anexo II.8',8),
  ('celery','Apio','Celery','allergen-celery','Anexo II.9',9),
  ('mustard','Mostaza','Mustard','allergen-mustard','Anexo II.10',10),
  ('sesame','Sésamo','Sesame','allergen-sesame','Anexo II.11',11),
  ('sulphites','Sulfitos','Sulphites','allergen-sulphites','Anexo II.12',12),
  ('lupin','Altramuces','Lupin','allergen-lupin','Anexo II.13',13),
  ('molluscs','Moluscos','Molluscs','allergen-molluscs','Anexo II.14',14);

-- ========== B.4 — 16 CORTES (emoji donde aplica, NULL donde no) ==========
INSERT INTO kitchen_cut_type_template (code, name_es, name_en, icon, position) VALUES
  ('whole','Entero','Whole',NULL,1),
  ('diced','En dados','Diced',NULL,2),
  ('diced_small','Dados pequeños','Small diced',NULL,3),
  ('diced_large','Dados grandes','Large diced',NULL,4),
  ('sliced','En rodajas','Sliced',NULL,5),
  ('sliced_thin','Rodajas finas','Thin sliced',NULL,6),
  ('julienne','Juliana','Julienne',NULL,7),
  ('strips','En tiras','Strips',NULL,8),
  ('chopped','Picado','Chopped','🔪',9),
  ('minced','Picado fino','Minced',NULL,10),
  ('grated','Rallado','Grated',NULL,11),
  ('laminated','Laminado','Laminated',NULL,12),
  ('cubed_meat','Cubos (carne)','Cubed (meat)','🧊',13),
  ('rounds','En aros','Rounds','⭕',14),
  ('wedges','En gajos','Wedges','🍊',15),
  ('crumbled','Desmenuzado','Crumbled',NULL,16);

-- ############################################################################
-- BLOQUE C — Funciones helper IA + triggers de integridad
-- ############################################################################

-- ========== C.1 — Triggers updated_at (función existente set_updated_at) ==========
CREATE TRIGGER trg_recipe_item_step_updated_at
  BEFORE UPDATE ON recipe_item_step
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_recipe_item_ai_session_updated_at
  BEFORE UPDATE ON recipe_item_ai_session
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_saved_view_updated_at
  BEFORE UPDATE ON user_saved_view
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========== C.2 — Detección de ciclos en recipe_line ==========
CREATE OR REPLACE FUNCTION recipe_line_prevent_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_cycle_found boolean;
BEGIN
  IF NEW.parent_item_id = NEW.child_item_id THEN
    RAISE EXCEPTION 'Ciclo en escandallo: un plato no puede contenerse a sí mismo (item %)', NEW.parent_item_id;
  END IF;

  WITH RECURSIVE descendientes AS (
    SELECT child_item_id
    FROM recipe_line
    WHERE parent_item_id = NEW.child_item_id
    UNION
    SELECT rl.child_item_id
    FROM recipe_line rl
    JOIN descendientes d ON rl.parent_item_id = d.child_item_id
  )
  SELECT EXISTS (
    SELECT 1 FROM descendientes WHERE child_item_id = NEW.parent_item_id
  ) INTO v_cycle_found;

  IF v_cycle_found THEN
    RAISE EXCEPTION 'Ciclo en escandallo detectado: % usaría % que (directa o indirectamente) ya usa %',
      NEW.parent_item_id, NEW.child_item_id, NEW.parent_item_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recipe_line_prevent_cycle
  BEFORE INSERT OR UPDATE ON recipe_line
  FOR EACH ROW EXECUTE FUNCTION recipe_line_prevent_cycle();

-- ========== C.3 — Función helper IA: estado del plato ==========
CREATE OR REPLACE FUNCTION kitchen_dish_state_for_ai(p_recipe_item_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'id', ri.id,
    'name', ri.name,
    'type', ri.type,
    'code', ri.code,
    'family_id', ri.family_id,
    'yield_portions', ri.yield_portions,
    'computed_cost', ri.computed_cost,
    'fixed_cost', ri.fixed_cost,
    'cost_strategy', ri.cost_strategy,
    'needs_review', ri.needs_review,
    'procedure_text', ri.procedure_text,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'child_item_id', rl.child_item_id,
        'child_name', child.name,
        'child_type', child.type,
        'quantity_net', rl.quantity_net,
        'quantity_gross', rl.quantity_gross,
        'unit_id', rl.unit_id,
        'cut_type_id', rl.cut_type_id,
        'comment', rl.comment,
        'position', rl.position
      ) ORDER BY rl.position)
      FROM recipe_line rl
      JOIN recipe_item child ON child.id = rl.child_item_id
      WHERE rl.parent_item_id = ri.id
    ), '[]'::jsonb)
  )
  FROM recipe_item ri
  WHERE ri.id = p_recipe_item_id;
$$;

-- ========== C.4 — Función helper IA: platos similares (heurístico V1) ==========
CREATE OR REPLACE FUNCTION kitchen_similar_dishes_for_ai(
  p_recipe_item_id uuid,
  p_n int DEFAULT 10
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH base AS (
    SELECT account_id, family_id, computed_cost
    FROM recipe_item
    WHERE id = p_recipe_item_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ri.id,
    'name', ri.name,
    'family_id', ri.family_id,
    'computed_cost', ri.computed_cost
  ) ORDER BY
      (ri.family_id IS NOT DISTINCT FROM base.family_id) DESC,
      abs(COALESCE(ri.computed_cost, 0) - COALESCE(base.computed_cost, 0)) ASC
  ), '[]'::jsonb)
  FROM recipe_item ri, base
  WHERE ri.account_id = base.account_id
    AND ri.id <> p_recipe_item_id
    AND ri.type = 'dish'
    AND ri.is_active = true
  LIMIT p_n;
$$;

-- ############################################################################
-- BLOQUE D — Backfill (cuenta interna 00000000-...-0001)
-- D.4 (procedure_text → steps) OMITIDO: 0 platos con procedure_text.
-- Todo idempotente (ON CONFLICT / NOT EXISTS).
-- ############################################################################

-- ========== D.1 — Fila kitchen_settings por cuenta ==========
INSERT INTO kitchen_settings (account_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (account_id) DO NOTHING;

-- ========== D.2 — Instanciar 55 familias desde template ==========
INSERT INTO dish_family (account_id, template_id, name, icon, position, is_active)
SELECT
  '00000000-0000-0000-0000-000000000001',
  t.id, t.name_es, t.icon, t.position, true
FROM dish_family_template t
WHERE NOT EXISTS (
  SELECT 1 FROM dish_family df
  WHERE df.account_id = '00000000-0000-0000-0000-000000000001'
    AND df.template_id = t.id
);

-- ========== D.3 — Versión inicial v1 de dish/recipe activos ==========
INSERT INTO recipe_item_version (
  recipe_item_id, version_number, valid_from, snapshot,
  computed_cost, status, is_milestone, milestone_label, change_note
)
SELECT
  ri.id, 1, now(), kitchen_dish_state_for_ai(ri.id),
  ri.computed_cost, 'active', true, 'Importación inicial',
  'Versión 1 generada en migration S1 (backfill)'
FROM recipe_item ri
WHERE ri.is_active = true
  AND ri.type IN ('dish','recipe')
  AND NOT EXISTS (
    SELECT 1 FROM recipe_item_version v
    WHERE v.recipe_item_id = ri.id AND v.version_number = 1
  );

COMMIT;
