-- ============================================================================
-- C02 · Plan contable — 1 · LA SERIE (estructura)
-- ----------------------------------------------------------------------------
-- Encargo C02 y respuesta 1 de Julio (D1, D2). SOLO AÑADE: una tabla nueva,
-- vacía. Los valores llegan en 20261007T0110 (generada por
-- scripts/conta/plan.mjs desde el BOE descargado por Actions).
--
-- pgc_account es el cuadro de cuentas de cada plan (pymes y general) con su
-- longitud ORIGINAL (1 a 5 dígitos: grupos, subgrupos, cuentas y subcuentas
-- del BOE) y su jerarquía. Es lo que se ENSEÑA y lo que responde «qué va a
-- cada sitio». No se apunta en ella: a la empresa le llegan solo las hojas,
-- rellenadas a su longitud, en company_account (tarea 3).
--
-- Catálogo de Folvy para todas las cuentas, sin account_id (excepción
-- declarada, como vat_category o tax_form). Nadie la escribe desde la app.
-- Nunca se edita una fila: si cambia la ley, se añade otra con su vigencia.
--
-- No toca ninguna tabla existente: fuera del camino del pedido.
-- ============================================================================

create table if not exists public.pgc_account (
  plan             text not null check (plan in ('pymes', 'general')),
  code             text not null check (code ~ '^[1-9][0-9]{0,4}$'),
  name             text not null,
  -- Lo que dice el cuadro del BOE, literal (normalizado: sin guion blando ni
  -- punto final). Distinto de name solo si hay corrección; NULL si la cuenta
  -- no sale en el cuadro (502 del general, por las líneas fundidas de 500/501).
  boe_name         text,
  correction_kind  text check (correction_kind in ('titulo_de_otra_cuenta', 'lineas_fundidas', 'falta', 'errata', 'dos_testigos', 'espacio')),
  plain_name       text,
  group_code       smallint not null check (group_code between 1 and 9),
  parent_code      text,
  is_leaf          boolean not null,
  legal_ref        text not null,
  -- Vigencia de la versión del bloque del BOE de la que sale (el grupo entero:
  -- el texto consolidado versiona por grupo, no por cuenta).
  valid_from       date not null,
  valid_to         date,
  boe_version_id   text not null,
  source_key       text not null references public.official_source(key),
  source_sha256    text not null,
  verified_at      date not null,
  primary key (plan, code, valid_from),
  check (code like group_code::text || '%'),
  check ((code ~ '^[0-9]$') = (parent_code is null)),
  check (parent_code is null or code like parent_code || '_%'),
  check ((correction_kind is null) = (boe_name is not distinct from name) or correction_kind = 'falta'),
  check ((correction_kind = 'falta') = (boe_name is null)),
  check (valid_to is null or valid_to > valid_from)
);

comment on table public.pgc_account is
  'C02. Cuadro de cuentas del PGC (pymes, RD 1515/2007; general, RD 1514/2007) con su longitud original y su jerarquía. Serie: cuadro del BOE + correcciones citadas (supabase/conta/pgc/correcciones.json). Solo se enseña; se apunta en company_account.';
comment on column public.pgc_account.name is 'Título oficial: el del cuadro, o el corregido con cita de la quinta parte del mismo texto.';
comment on column public.pgc_account.boe_name is 'Título tal y como sale en el cuadro de cuentas del BOE (normalizado). NULL si la cuenta no sale en el cuadro.';
comment on column public.pgc_account.plain_name is 'Qué se apunta aquí, en lenguaje de la calle. Lo escribe Folvy (supabase/conta/pgc/en-la-calle.json), no el BOE.';
comment on column public.pgc_account.is_leaf is 'Sin cuentas hijas en el cuadro: las únicas que llegan a la empresa (D2).';

create index if not exists pgc_account_parent_idx on public.pgc_account (plan, parent_code);

-- Lectura para usuarios con sesión; nada para anon; nadie escribe.
alter table public.pgc_account enable row level security;
drop policy if exists pgc_account_select on public.pgc_account;
create policy pgc_account_select on public.pgc_account for select to authenticated using (true);
revoke all on table public.pgc_account from anon, authenticated;
grant select on table public.pgc_account to authenticated;
