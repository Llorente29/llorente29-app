-- ============================================================================
-- C00 · El cimiento — 1/4 · CATÁLOGOS OFICIALES (globales, de solo lectura)
-- ----------------------------------------------------------------------------
-- Encargo C00 (02/10/2026) y respuesta 1 de Julio. SOLO AÑADE.
--
-- Son catálogos de Folvy para todas las cuentas, sin account_id (excepción
-- declarada, como vat_category y expense_category). Se leen enteros a
-- propósito. Nadie los escribe desde la app: solo migraciones, y sus valores
-- salen de docs/conta/fuentes/ (descargados de la fuente oficial por GitHub
-- Actions) con la referencia escrita al lado. Esta migración los crea VACÍOS:
-- los valores llegan en la tarea 4, cada uno con su fuente.
--
-- No toca ninguna tabla existente: no toma cierres sobre el camino del pedido.
-- ============================================================================

-- ── Registro de fuentes oficiales ───────────────────────────────────────────
-- Cada fila de serie de cualquier tabla dice de qué fuente sale (source_key).
create table if not exists public.official_source (
  key            text primary key,
  name           text not null,
  url            text not null,
  sha256         text,
  downloaded_at  timestamptz,
  note           text
);
comment on table public.official_source is
  'C00. Fuentes oficiales de las que salen los valores de serie. Espejo de docs/conta/fuentes/registro.json.';

-- ── Países (ISO 3166-1) y monedas (ISO 4217) ───────────────────────────────
create table if not exists public.country (
  alpha2      char(2) primary key check (alpha2 ~ '^[A-Z]{2}$'),
  alpha3      char(3) not null unique check (alpha3 ~ '^[A-Z]{3}$'),
  name_es     text not null,
  source_key  text not null references public.official_source(key)
);
comment on table public.country is 'C00. Países, ISO 3166-1, nombres en español de la Oficina de Publicaciones de la UE.';

create table if not exists public.currency (
  code        char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name_es     text not null,
  source_key  text not null references public.official_source(key)
);
comment on table public.currency is 'C00. Monedas, ISO 4217, nombres en español de la Oficina de Publicaciones de la UE.';

-- ── Formas jurídicas ────────────────────────────────────────────────────────
create table if not exists public.legal_form (
  code         text primary key,
  name         text not null,
  entity_kind  text not null check (entity_kind in ('company', 'self_employed', 'other')),
  nif_letter   char(1),
  legal_ref    text not null,
  verified_at  date not null,
  source_key   text not null references public.official_source(key),
  sort_order   smallint not null default 0
);
comment on table public.legal_form is 'C00. Formas jurídicas. nif_letter = letra del NIF que la identifica, según su norma.';

-- ── Regímenes de IVA y modelos tributarios ─────────────────────────────────
create table if not exists public.vat_scheme (
  code         text primary key,
  name         text not null,
  description  text,
  legal_ref    text not null,
  verified_at  date not null,
  source_key   text not null references public.official_source(key),
  sort_order   smallint not null default 0
);
comment on table public.vat_scheme is 'C00. Regímenes del IVA (general y especiales) con su artículo.';

create table if not exists public.tax_form (
  code         text primary key check (code ~ '^[0-9]{3}$'),
  name         text not null,
  description  text,
  legal_ref    text not null,
  verified_at  date not null,
  source_key   text not null references public.official_source(key)
);
comment on table public.tax_form is 'C00. Modelos tributarios (303, 111, 115…) con la norma que obliga a presentarlos.';

-- ── IAE y CNAE ─────────────────────────────────────────────────────────────
create table if not exists public.iae_heading (
  code         text primary key,
  section      text not null check (section in ('1', '2', '3')),
  level        text not null,
  title        text not null,
  parent_code  text references public.iae_heading(code),
  source_key   text not null references public.official_source(key)
);
comment on table public.iae_heading is
  'C00. Tarifas del IAE (RDL 1175/1990). section 1 = empresariales, 2 = profesionales, 3 = artísticas.';

create table if not exists public.cnae_code (
  version      text not null check (version in ('2009', '2025')),
  code         text not null,
  level        smallint not null,
  title        text not null,
  parent_code  text,
  source_key   text not null references public.official_source(key),
  primary key (version, code)
);
comment on table public.cnae_code is 'C00. CNAE (INE). La vigente es la CNAE-2025 (RD 10/2025).';

create table if not exists public.iae_cnae (
  iae_code      text not null references public.iae_heading(code),
  cnae_version  text not null,
  cnae_code     text not null,
  source_key    text not null references public.official_source(key),
  primary key (iae_code, cnae_version, cnae_code),
  foreign key (cnae_version, cnae_code) references public.cnae_code(version, code)
);
comment on table public.iae_cnae is
  'C00. Correspondencia IAE → CNAE. Solo la que publica una fuente oficial; lo que no esté, no se deduce.';

-- ── Seguridad: lectura para usuarios con sesión; nada para anon; nadie escribe
do $$
declare t text;
begin
  foreach t in array array['official_source','country','currency','legal_form','vat_scheme','tax_form','iae_heading','cnae_code','iae_cnae'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;
