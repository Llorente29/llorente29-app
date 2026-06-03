-- ════════════════════════════════════════════════════════════════════════
-- MODELO DE IVA versionado + propuesta automática por familia ("invisible")
-- ════════════════════════════════════════════════════════════════════════
-- Diseñado para el CLIENTE REAL (no solo el banco de pruebas):
--   · cliente nuevo desde cero      → al crear artículo, hereda IVA de su familia
--   · cliente que migra sus datos   → el motor IA propone familia + IVA en bloque
--   · cuenta semilla                → artículos ya vienen con categoría fiscal
--
-- Claves del diseño:
--   1) El artículo lleva una CATEGORÍA fiscal (no un número). vat_category.
--   2) Los TIPOS viven versionados por fecha (vat_rate). Cambio del BOE = 1 fila,
--      y todos los artículos de la categoría heredan. Resuelve por fecha del
--      documento → valida facturas antiguas por OCR con el IVA de entonces.
--   3) MAPEO familia→categoría (family_vat_default): la "inteligencia" global
--      que permite proponer el IVA al clasificar. La consume el motor IA.
--   4) source ('proposed'|'confirmed'): sólido + comercial. Propuesto de salida
--      (cero fricción), invita a confirmar (no miente en silencio).
--   5) Catálogo GLOBAL (sin account_id): los tipos los fija el Estado; Folvy los
--      mantiene una vez para todos. Mismo patrón que `connector`.
--
-- NO SECURITY DEFINER. DDL: ejecutar tal cual (sin BEGIN/COMMIT). Verificación
-- en consulta APARTE (te la paso después; NO en la misma tanda).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) CATÁLOGO de categorías fiscales (global).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vat_category (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) TIPOS versionados por fecha (global).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vat_rate (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id           uuid NOT NULL REFERENCES public.vat_category(id) ON DELETE CASCADE,
  rate                  numeric(5,2) NOT NULL,
  equivalence_surcharge numeric(5,2) NOT NULL DEFAULT 0,
  valid_from            date NOT NULL,
  valid_to              date,
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vat_rate_category_dates
  ON public.vat_rate (category_id, valid_from, valid_to);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) MAPEO familia → categoría fiscal por defecto (global). La inteligencia
--    que permite proponer el IVA al clasificar. recipe_family es por cuenta,
--    pero las familias AECOC son las mismas para todos → mapeamos por el
--    NOMBRE de familia (no por id), para que sirva a cualquier cuenta.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_vat_default (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_name     text NOT NULL UNIQUE,         -- nombre de familia AECOC
  vat_category_id uuid NOT NULL REFERENCES public.vat_category(id),
  is_mixed        boolean NOT NULL DEFAULT false, -- familia con tipos mixtos → revisar
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) El artículo: categoría fiscal + origen de la asignación.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.recipe_item
  ADD COLUMN IF NOT EXISTS vat_category_id uuid REFERENCES public.vat_category(id);
ALTER TABLE public.recipe_item
  ADD COLUMN IF NOT EXISTS vat_category_source text
    CHECK (vat_category_source IN ('proposed','confirmed'));

-- ─────────────────────────────────────────────────────────────────────────
-- 5) FUNCIÓN: tipo de IVA vigente de una categoría en una fecha.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vat_rate_for(p_category_id uuid, p_date date)
 RETURNS TABLE (rate numeric, equivalence_surcharge numeric)
 LANGUAGE sql STABLE
AS $function$
  SELECT r.rate, r.equivalence_surcharge
  FROM public.vat_rate r
  WHERE r.category_id = p_category_id
    AND r.valid_from <= p_date
    AND (r.valid_to IS NULL OR r.valid_to >= p_date)
  ORDER BY r.valid_from DESC
  LIMIT 1;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) FUNCIÓN reutilizable: propone la categoría fiscal de un artículo según su
--    familia, SOLO si no tiene ya una confirmada. Marca 'proposed'. La invocan:
--    alta de artículo, clasificación IA, migración masiva, recálculo. Devuelve
--    la categoría asignada (o la que ya tenía si estaba confirmada).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.propose_vat_category(p_recipe_item_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current_cat    uuid;
  v_current_source text;
  v_family_name    text;
  v_proposed_cat   uuid;
BEGIN
  SELECT ri.vat_category_id, ri.vat_category_source, rf.name
    INTO v_current_cat, v_current_source, v_family_name
  FROM public.recipe_item ri
  LEFT JOIN public.recipe_family rf ON rf.id = ri.family_id
  WHERE ri.id = p_recipe_item_id;

  -- No tocar lo confirmado por un humano.
  IF v_current_source = 'confirmed' THEN
    RETURN v_current_cat;
  END IF;

  -- Sin familia no se puede proponer (honesto: queda sin IVA, no inventa).
  IF v_family_name IS NULL THEN
    RETURN v_current_cat;
  END IF;

  SELECT fvd.vat_category_id INTO v_proposed_cat
  FROM public.family_vat_default fvd
  WHERE fvd.family_name = v_family_name;

  IF v_proposed_cat IS NULL THEN
    RETURN v_current_cat;
  END IF;

  UPDATE public.recipe_item
     SET vat_category_id = v_proposed_cat,
         vat_category_source = 'proposed'
   WHERE id = p_recipe_item_id;

  RETURN v_proposed_cat;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) RLS de lectura para los catálogos globales.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.vat_category       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vat_rate           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_vat_default ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vat_category_read ON public.vat_category;
CREATE POLICY vat_category_read ON public.vat_category FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS vat_rate_read ON public.vat_rate;
CREATE POLICY vat_rate_read ON public.vat_rate FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS family_vat_default_read ON public.family_vat_default;
CREATE POLICY family_vat_default_read ON public.family_vat_default FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 8) SIEMBRA: categorías.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.vat_category (code, name, description, sort_order) VALUES
  ('alimento_basico',  'Alimento básico',   'Pan, harinas, leche, queso, huevos, fruta, verdura, legumbres, cereales naturales', 1),
  ('aceite_oliva',     'Aceite de oliva',   'Aceite de oliva (superreducido permanente desde 2025)',                            2),
  ('alimento_general', 'Alimento general',  'Resto de alimentos, pastas, aceites de semillas, carnes, pescados procesados',     3),
  ('bebida_alcoholica','Bebida o azúcar',   'Bebidas alcohólicas y bebidas con azúcares/edulcorantes añadidos',                 4),
  ('no_alimentario',   'No alimentario',    'Limpieza, menaje, packaging y otros no alimentarios',                              5)
ON CONFLICT (code) DO NOTHING;

-- 8b) Tipos vigentes desde 2025-01-01 (BOE, RD-ley 4/2024) + recargo equivalencia.
INSERT INTO public.vat_rate (category_id, rate, equivalence_surcharge, valid_from, valid_to, note)
SELECT c.id, v.rate, v.surcharge, DATE '2025-01-01', NULL, v.note
FROM (VALUES
  ('alimento_basico',   4.00, 0.50, 'RD-ley 4/2024 · básicos 4% desde 2025'),
  ('aceite_oliva',      4.00, 0.50, 'Aceite oliva superreducido permanente desde 2025'),
  ('alimento_general', 10.00, 1.40, 'Tipo reducido alimentos'),
  ('bebida_alcoholica',21.00, 5.20, 'Tipo general'),
  ('no_alimentario',   21.00, 5.20, 'Tipo general')
) AS v(code, rate, surcharge, note)
JOIN public.vat_category c ON c.code = v.code
WHERE NOT EXISTS (SELECT 1 FROM public.vat_rate r WHERE r.category_id = c.id AND r.valid_from = DATE '2025-01-01');

-- 8c) Histórico de ejemplo (aceite 2024) → valida facturas OCR de 2024.
INSERT INTO public.vat_rate (category_id, rate, equivalence_surcharge, valid_from, valid_to, note)
SELECT c.id, 2.00, 0.26, DATE '2024-10-01', DATE '2024-12-31', 'RD-ley 4/2024 · aceite 0→2% 4T2024'
FROM public.vat_category c WHERE c.code = 'aceite_oliva'
AND NOT EXISTS (SELECT 1 FROM public.vat_rate r WHERE r.category_id = c.id AND r.valid_from = DATE '2024-10-01');

-- ─────────────────────────────────────────────────────────────────────────
-- 9) SIEMBRA: mapeo familia AECOC → categoría fiscal por defecto.
--    is_mixed=true marca familias con tipos mezclados (el cocinero revisará).
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.family_vat_default (family_name, vat_category_id, is_mixed, note)
SELECT m.family_name, c.id, m.is_mixed, m.note
FROM (VALUES
  ('Frutas y hortalizas',            'alimento_basico',   false, 'Productos naturales 4%'),
  ('Lácteos y huevos',               'alimento_basico',   false, 'Leche, queso, huevos 4%'),
  ('Panadería y pastelería',         'alimento_basico',   true,  'Pan común 4%; pastelería podría ser 10%'),
  ('Cereales, pasta y legumbres',    'alimento_general',  true,  'Pastas 10%; legumbres secas básicas 4%'),
  ('Carnes y aves',                  'alimento_general',  false, 'Carne fresca 10%'),
  ('Pescados y mariscos',            'alimento_general',  false, 'Pescado 10%'),
  ('Charcutería y quesos',           'alimento_general',  true,  'Charcutería 10%; queso solo 4%'),
  ('Café, infusiones y solubles',    'alimento_general',  false, '10%'),
  ('Especias',                       'alimento_general',  false, '10%'),
  ('Conservas y encurtidos',         'alimento_general',  false, '10%'),
  ('Congelados',                     'alimento_general',  true,  'Según contenido'),
  ('Aceites, salsas y condimentos',  'alimento_general',  true,  'Aceite de oliva 4% — reclasificar; salsas 10%'),
  ('Bebidas sin alcohol',            'bebida_alcoholica', true,  'Refrescos/azucaradas 21%; aguas/zumos podrían ser 10%'),
  ('Vinos y bebidas alcohólicas',    'bebida_alcoholica', false, '21%'),
  ('Droguería y limpieza',           'no_alimentario',    false, '21%'),
  ('Envases y packaging',            'no_alimentario',    false, '21%')
) AS m(family_name, cat_code, is_mixed, note)
JOIN public.vat_category c ON c.code = m.cat_code
ON CONFLICT (family_name) DO NOTHING;
