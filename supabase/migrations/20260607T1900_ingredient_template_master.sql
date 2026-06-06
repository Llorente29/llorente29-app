-- 20260607T1900_ingredient_template_master.sql
--
-- T1a — MASTER GLOBAL DE INGREDIENTES (ingredient_template) + satélite de
-- alérgenos. Sigue el patrón de plantilla del proyecto (dish_family_template,
-- kitchen_cut_type_template): tabla GLOBAL, sin account_id, que todas las
-- cuentas LEEN y de la que se MATERIALIZA un recipe_item propio al adoptar.
--
-- Principios (decisión Julio 07/06):
--   · El master NO lleva PRECIO. El precio es por cuenta (article_supplier).
--     El master solo guarda datos INTRÍNSECOS del producto (nombre, familia,
--     alérgenos, densidad, merma típica, nutrición, foto genérica).
--   · Datos OFICIALES (nombre/alérgenos/nutrición) se sembrarán desde bases
--     oficiales (BEDCA/USDA/Open Food Facts, según licencia). merma/densidad/
--     foto/resto con apoyo de IA. La siembra es un tramo posterior; esta
--     migración solo crea la ESTRUCTURA.
--   · Versionado + auto-actualización con consentimiento: ingredient_template
--     se versiona (version); el recipe_item adoptado recuerda de qué template
--     y con qué versión salió (template_code/template_version) para poder
--     ofrecer "hay una versión mejorada" SIN pisar lo que el cocinero tocó.
--
-- DDL puro, idempotente (IF NOT EXISTS), SIN BEGIN/COMMIT explícito: se pega
-- en el SQL Editor de Supabase y se ejecuta. La verificación va aparte.
-- Las policies con SECURITY no se prueban aquí (auth.uid() es null en el
-- SQL Editor); se validan desde la app.

-- ════════════════════════════════════════════════════════════════════════
-- 0. Extensión para búsqueda por similitud (trigram). Necesaria para el
--    buscador del master (ILIKE/'%...%' sobre nombre+aliases sin penalización
--    cuando el catálogo crezca a miles de filas).
-- ════════════════════════════════════════════════════════════════════════
create extension if not exists pg_trgm;

-- ════════════════════════════════════════════════════════════════════════
-- 1. ingredient_template  (tabla BASE del master, global)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists ingredient_template (
  id                     uuid primary key default gen_random_uuid(),

  -- Clave estable (slug): 'albahaca_fresca', 'aceite_oliva_virgen_extra'...
  -- Es la que recuerda el recipe_item adoptado (template_code). Inmutable.
  code                   text not null unique,

  -- Nombres bilingües. name_en puede ir vacío hasta sembrar desde fuente EN.
  name_es                text not null,
  name_en                text,

  -- Sinónimos para el buscador y el casado por OCR ('alhábega', 'basil'...).
  aliases                text[] not null default '{}',

  -- Familia AECOC por CÓDIGO (no por id de cuenta): el master es global, así
  -- que referencia la familia por su code estable; al adoptar se resuelve al
  -- recipe_family de la cuenta destino.
  family_code            text,

  -- Dimensión base sugerida al adoptar: 'weight' | 'volume' | 'unit'.
  default_base_dimension text,

  -- Densidad g/ml. NULL = no se conoce -> el sistema NO inventa conversión
  -- ml<->g (coherente con la honestidad de coste). Solo se rellena si hay dato.
  density_g_per_ml       numeric,

  -- Merma orientativa por defecto (%). Se arrastra como propuesta al adoptar.
  default_waste_pct      numeric,

  shelf_life_days        integer,

  -- Conservación: usa el mismo vocabulario que recipe_item.conservation_type
  -- (fridge/freezer/dry/hot). text para no acoplar al enum de otra tabla.
  conservation_type      text,

  -- Valor nutricional por 100 g (de BEDCA/USDA). jsonb flexible: { energy_kcal,
  -- protein_g, fat_g, carbs_g, ... } — el esquema fino se fija al sembrar.
  nutrition              jsonb,

  -- Foto GENÉRICA del ingrediente (banco libre o generada por IA). NUNCA foto
  -- de proveedor/copyright. Ruta en storage o URL pública de banco libre.
  photo_url              text,

  -- Puente a estándares globales (GS1/EAN). Opcional, no se obliga: habilita
  -- casar por código al leer un EAN (OCR/etiqueta) o una futura integración EDI.
  gtin                   text,
  gpc_brick_code         text,

  -- Trazabilidad de origen del dato (para licencia y auditoría):
  -- 'bedca' | 'usda' | 'off' (Open Food Facts) | 'ai' | 'manual'.
  source                 text not null default 'manual',

  -- VERSIONADO: se incrementa cuando el emisor (admin) corrige el template.
  -- Base de la auto-actualización con consentimiento (T1c).
  version                integer not null default 1,
  published_at           timestamptz,

  -- Orden de aparición en listas/buscador (los más comunes primero).
  position               integer not null default 0,

  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Índice trigram para el buscador (nombre ES + EN). El de aliases va aparte
-- porque es un array (se indexa con GIN sobre la representación textual).
create index if not exists ingredient_template_name_es_trgm
  on ingredient_template using gin (name_es gin_trgm_ops);
create index if not exists ingredient_template_name_en_trgm
  on ingredient_template using gin (name_en gin_trgm_ops);
create index if not exists ingredient_template_aliases_gin
  on ingredient_template using gin (aliases);
create index if not exists ingredient_template_family_code
  on ingredient_template (family_code);

-- ════════════════════════════════════════════════════════════════════════
-- 2. ingredient_template_allergen  (satélite, global)
--    Vocabulario IDÉNTICO a recipe_item_allergen (allergen_code/state text),
--    para que la adopción copie sin traducir. Códigos canónicos en el cliente:
--    src/modules/kitchen/lib/allergens.ts (los 14 UE en inglés-neutro).
-- ════════════════════════════════════════════════════════════════════════
create table if not exists ingredient_template_allergen (
  template_id   uuid not null references ingredient_template(id) on delete cascade,
  allergen_code text not null,                 -- gluten|milk|crustaceans|...
  state         text not null default 'contains', -- contains|may_contain|free
  source        text not null default 'manual',   -- bedca|off|ai|manual
  created_at    timestamptz not null default now(),
  primary key (template_id, allergen_code)
);

create index if not exists ingredient_template_allergen_tid
  on ingredient_template_allergen (template_id);

-- ════════════════════════════════════════════════════════════════════════
-- 3. Enganches en recipe_item (lo que ADOPTA del master). No reescriben nada:
--    de qué template salió la fila y con qué versión, para poder detectar
--    "hay versión mejorada" SIN pisar campos que el cliente modificó.
--    'source' y 'needs_review' ya existen en recipe_item.
-- ════════════════════════════════════════════════════════════════════════
alter table recipe_item
  add column if not exists template_code    text,
  add column if not exists template_version integer;

-- ════════════════════════════════════════════════════════════════════════
-- 4. RLS — el master es COMÚN: lectura para cualquier autenticado, escritura
--    SOLO para el rol de servicio (admin). Un cliente jamás edita el catálogo
--    compartido. (service_role saltarse RLS es nativo de Supabase; añadimos
--    explícitamente lectura a authenticated.)
-- ════════════════════════════════════════════════════════════════════════
alter table ingredient_template          enable row level security;
alter table ingredient_template_allergen enable row level security;

-- Lectura global para usuarios autenticados (idempotente: drop+create).
drop policy if exists ingredient_template_read on ingredient_template;
create policy ingredient_template_read
  on ingredient_template for select
  to authenticated
  using (true);

drop policy if exists ingredient_template_allergen_read on ingredient_template_allergen;
create policy ingredient_template_allergen_read
  on ingredient_template_allergen for select
  to authenticated
  using (true);

-- Escritura: NO se concede a authenticated. Solo service_role (que opera con
-- bypass de RLS) puede insertar/actualizar/borrar. Sembrado y mantenimiento
-- del master se hacen con la service key, nunca desde la sesión de un cliente.

comment on table ingredient_template is
  'Master GLOBAL de ingredientes (sin account_id, sin precio). Lectura para todos los autenticados; escritura solo service_role. Se materializa en recipe_item al adoptar.';
comment on table ingredient_template_allergen is
  'Alérgenos del master. Vocabulario idéntico a recipe_item_allergen (lib/allergens.ts).';
