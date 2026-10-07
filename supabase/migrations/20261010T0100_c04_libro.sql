-- ============================================================================
-- C04 · Libro diario — 1 · EL LIBRO
-- ----------------------------------------------------------------------------
-- Lo que hace falta para que cada venta, compra, liquidación, nómina y pago
-- quede en un diario que cuadra siempre, con su documento, su local y su marca.
--
--   · fiscal_year: de dónde viene (Folvy o traído de otro programa) y hasta
--     cuándo es traído. El corte es un dato de la empresa (conta_fijar_corte); 30/09/2026 es una suposición de trabajo.
--   · fiscal_period_lock: por qué está cerrado un mes (a mano, impuesto
--     presentado o traído). Un mes traído no se reabre.
--   · journal_entry / journal_line: el asiento y sus apuntes. Las series se
--     guardan con el código de Diez (1, 2, 3, 4, 9) para que lo traído entre
--     sin traducir; en pantalla se dicen por su palabra: Ventas, Compras,
--     Banco, General, Nóminas (respuesta 1 de Julio). Apertura, cierre y
--     liquidación del IVA van a General. El número se pone al validar
--     (regla 2); lo traído conserva el suyo.
--   · La fecha de corte con el programa anterior es un DATO de la empresa
--     (fiscal_year.imported_until), cambiable mientras no haya asientos
--     traídos; nada la quema en código ni en migración.
--   · sales_day_summary: el resumen de ventas de un día y un local (CCom 28.2,
--     RIVA 63.4) con su recuento, su rango de facturas y la huella del detalle.
--   · payroll_summary: el resumen mensual de nóminas que hoy escribe la gestoría
--     y mañana rellenará el módulo de personal.
--   · allocation_rule, entry_template(_line): reparto de comunes y predefinidos.
--
-- Todo es nuevo salvo dos columnas en fiscal_year y una en fiscal_period_lock,
-- con valor por defecto: lo que ya hay no cambia (antes = después).
-- Ninguna de estas tablas está en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261010T0100_c04_libro.down.sql
-- ============================================================================

-- ── 0 · Ejercicios: de dónde vienen ─────────────────────────────────────────
alter table public.fiscal_year
  add column if not exists origin         text not null default 'folvy',
  add column if not exists origin_program text,
  add column if not exists imported_until date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fiscal_year_origin_check') then
    alter table public.fiscal_year add constraint fiscal_year_origin_check check (origin in ('folvy', 'migrated', 'mixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fiscal_year_traido_coherente') then
    alter table public.fiscal_year add constraint fiscal_year_traido_coherente check (
      (origin = 'folvy' and imported_until is null)
      or (origin = 'migrated' and origin_program is not null and (imported_until is null or imported_until = ends_on))
      or (origin = 'mixed' and origin_program is not null and imported_until between starts_on and ends_on - 1));
  end if;
end $$;
comment on column public.fiscal_year.origin is
  'C04. folvy: todo lo asienta Folvy. migrated: traído entero de otro programa (C04b). mixed: traído hasta imported_until y Folvy desde el día siguiente (Foodint 2026, corte 30/09).';
comment on column public.fiscal_year.origin_program is 'C04. De qué programa se trajo («diez»).';
comment on column public.fiscal_year.imported_until is 'C04. Último día traído. Desde el día siguiente asienta Folvy.';

-- ── 1 · Meses cerrados: por qué ─────────────────────────────────────────────
alter table public.fiscal_period_lock add column if not exists kind text not null default 'manual';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fiscal_period_lock_kind_check') then
    alter table public.fiscal_period_lock add constraint fiscal_period_lock_kind_check check (kind in ('manual', 'tax_filed', 'migrated'));
  end if;
end $$;
comment on column public.fiscal_period_lock.kind is
  'C04. manual: lo cerró una persona. tax_filed: se presentó el impuesto de ese periodo (lo pondrá Impuestos). migrated: es un mes traído de otro programa y no se reabre.';

-- ── 2 · journal_entry: el asiento ───────────────────────────────────────────
create table if not exists public.journal_entry (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  fiscal_year_id      uuid not null references public.fiscal_year(id) on delete restrict,
  series              smallint not null check (series in (1, 2, 3, 4, 9)),
  number              integer check (number is null or number > 0),
  entry_date          date not null,
  concept             text not null check (length(trim(concept)) > 0),
  source_type         text not null check (source_type in (
                        'sales_day', 'sales_adjustment', 'supplier_invoice', 'supplier_payment', 'channel_settlement',
                        'licensed_settlement', 'payroll', 'bank', 'vat_settlement', 'manual', 'template',
                        'reversal', 'opening', 'closing', 'migrated')),
  source_id           uuid,
  status              text not null default 'borrador' check (status in ('propuesto', 'borrador', 'validado', 'anulado')),
  -- La propuesta de Folvy: confianza y porqué (regla 10). reasons: [{decision, porque, cita?}]
  confidence          text check (confidence is null or confidence in ('seguro', 'probable', 'duda')),
  reason              text,
  reasons             jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  party_id            uuid references public.party(id) on delete restrict,
  document_ref        text,
  document_date       date,
  document_url        text,
  -- Traído de otro programa (C04b): su serie y su número, tal cual.
  external_program    text,
  external_series     text,
  external_number     text,
  -- Validar: número, huella encadenada (LGT 29.2.j; misma técnica que F01).
  validated_at        timestamptz,
  validated_by        uuid,
  validated_by_name   text,
  chain_seq           bigint,
  prev_hash           text,
  hash                text,
  -- Anular: el contraasiento y por qué (CCom 29.1: los errores se salvan a continuación).
  reverses_entry_id   uuid references public.journal_entry(id) on delete restrict,
  voided_by_entry_id  uuid references public.journal_entry(id) on delete restrict,
  voided_at           timestamptz,
  voided_by           uuid,
  voided_by_name      text,
  void_reason         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  created_by_name     text,
  constraint journal_entry_numero_al_validar check ((status in ('validado', 'anulado')) = (number is not null)),
  constraint journal_entry_validado_completo check (
    status not in ('validado', 'anulado') or (validated_at is not null and hash is not null and chain_seq is not null)),
  constraint journal_entry_anulado_completo check (
    (status = 'anulado') = (voided_by_entry_id is not null)
    and (status <> 'anulado' or (voided_at is not null and length(trim(coalesce(void_reason, ''))) > 0))),
  constraint journal_entry_propuesta_con_porque check (
    status <> 'propuesto' or (confidence is not null and length(trim(coalesce(reason, ''))) > 0)),
  constraint journal_entry_traido check ((source_type = 'migrated') = (external_program is not null)),
  constraint journal_entry_contraasiento check ((source_type = 'reversal') = (reverses_entry_id is not null))
);
comment on table public.journal_entry is
  'C04. El asiento. Series con el código de Diez y su palabra en pantalla: 1 Ventas, 2 Compras, 3 Banco, 4 General (también apertura, cierre e IVA), 9 Nóminas. El número se pone al validar y no deja huecos; lo validado no se toca: se anula con un contraasiento enlazado.';
comment on column public.journal_entry.source_type is
  'C04. De dónde sale: sales_day (resumen de ventas del día), sales_adjustment (cancelación o devolución que decide la plataforma), supplier_invoice, supplier_payment, channel_settlement, licensed_settlement, payroll, bank, vat_settlement, manual, template, reversal (contraasiento), opening, closing, migrated (traído).';
comment on column public.journal_entry.chain_seq is 'C04. Orden de validación dentro de la empresa: la huella de cada asiento encadena con la del anterior en este orden.';
create unique index if not exists ux_journal_entry_numero
  on public.journal_entry (company_id, fiscal_year_id, series, number) where number is not null;
create unique index if not exists ux_journal_entry_cadena on public.journal_entry (company_id, chain_seq) where chain_seq is not null;
create unique index if not exists ux_journal_entry_anula on public.journal_entry (reverses_entry_id) where reverses_entry_id is not null;
create index if not exists idx_journal_entry_empresa_fecha on public.journal_entry (company_id, entry_date);
create index if not exists idx_journal_entry_origen on public.journal_entry (source_type, source_id) where source_id is not null;
create index if not exists idx_journal_entry_cuenta on public.journal_entry (account_id, status);
-- Un documento, un asiento vivo: no se propone dos veces lo mismo (al anular, queda libre).
create unique index if not exists ux_journal_entry_origen on public.journal_entry (company_id, source_type, source_id)
  where source_id is not null and status in ('propuesto', 'borrador', 'validado') and source_type not in ('reversal', 'migrated');
drop trigger if exists trg_journal_entry_misma_cuenta on public.journal_entry;
create trigger trg_journal_entry_misma_cuenta before insert or update on public.journal_entry
  for each row execute function public.conta_misma_cuenta();

-- ── 3 · journal_line: el apunte ─────────────────────────────────────────────
create table if not exists public.journal_line (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  entry_id            uuid not null references public.journal_entry(id) on delete cascade,
  position            smallint not null check (position > 0),
  company_account_id  uuid not null references public.company_account(id) on delete restrict,
  debit               numeric(14, 2) not null default 0 check (debit >= 0),
  credit              numeric(14, 2) not null default 0 check (credit >= 0),
  concept             text,
  -- Local (obligatorio salvo «común», regla 9) y marca.
  location_id         uuid references public.locations(id) on delete restrict,
  is_common           boolean not null default false,
  brand_id            uuid references public.brand(id) on delete restrict,
  party_id            uuid references public.party(id) on delete restrict,
  document_ref        text,
  document_date       date,
  -- IVA (regla 5): base, tipo, cuota = el importe del apunte, y su libro registro.
  tax_rate_id         uuid references public.tax_rate(id) on delete restrict,
  tax_base            numeric(14, 2),
  vat_book            text check (vat_book is null or vat_book in ('issued', 'received', 'investment', 'not_subject')),
  vat_deductible      text check (vat_deductible is null or vat_deductible in ('yes', 'no', 'prorrata')),
  -- Cuántas facturas resume el apunte de IVA (asiento resumen, RIVA 63.4): la
  -- cuota se redondea por factura, así que admite medio céntimo por factura.
  tax_documents       integer not null default 1 check (tax_documents > 0),
  -- Retenciones: tipo y modelo (111, 115, 123).
  withholding_rate_id uuid references public.withholding_rate(id) on delete restrict,
  withholding_base    numeric(14, 2),
  withholding_model   text check (withholding_model is null or withholding_model in ('111', '115', '123')),
  created_at          timestamptz not null default now(),
  unique (entry_id, position),
  constraint journal_line_debe_o_haber check ((debit > 0) <> (credit > 0)),
  constraint journal_line_comun_sin_local check (not (is_common and location_id is not null)),
  constraint journal_line_iva_completo check (
    (tax_rate_id is null and tax_base is null and vat_book is null and vat_deductible is null)
    or (tax_rate_id is not null and tax_base is not null and vat_book is not null)),
  constraint journal_line_deducible_solo_recibidas check (vat_deductible is null or vat_book in ('received', 'investment')),
  constraint journal_line_retencion_completa check (
    (withholding_rate_id is null and withholding_base is null and withholding_model is null)
    or (withholding_rate_id is not null and withholding_base is not null and withholding_model is not null))
);
comment on table public.journal_line is
  'C04. El apunte: una cuenta de la empresa (solo hojas), Debe o Haber (uno de los dos), local (o «común») y marca; el apunte de IVA lleva base, tipo y libro registro, y el de retención su tipo y modelo.';
comment on column public.journal_line.is_common is 'C04. Gasto común (préstamos y poco más): sin local; el informe lo reparte con allocation_rule.';
comment on column public.journal_line.vat_book is 'C04. Libro registro del IVA: issued (expedidas), received (recibidas), investment (bienes de inversión), not_subject (no sujeta).';
create index if not exists idx_journal_line_asiento on public.journal_line (entry_id);
create index if not exists idx_journal_line_cuenta on public.journal_line (company_account_id);
create index if not exists idx_journal_line_empresa_local on public.journal_line (company_id, location_id);
drop trigger if exists trg_journal_line_misma_cuenta on public.journal_line;
create trigger trg_journal_line_misma_cuenta before insert or update on public.journal_line
  for each row execute function public.conta_misma_cuenta();

-- ── 4 · sales_day_summary: el resumen de ventas del día y del local ─────────
create table if not exists public.sales_day_summary (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  location_id      uuid not null references public.locations(id) on delete restrict,
  sales_day        date not null,
  entry_id         uuid references public.journal_entry(id) on delete set null,
  tickets_count    integer not null check (tickets_count >= 0),
  total            numeric(14, 2) not null,
  -- [{tax_rate_id, rate, base, cuota, calculated}] — una por tipo.
  by_rate          jsonb not null default '[]'::jsonb check (jsonb_typeof(by_rate) = 'array'),
  -- [{channel_id, total}] — lo que cobra cada plataforma (su 430) o la caja.
  by_channel       jsonb not null default '[]'::jsonb check (jsonb_typeof(by_channel) = 'array'),
  -- [{brand_id, base}] — si la empresa quiere el resultado por marca.
  by_brand         jsonb not null default '[]'::jsonb check (jsonb_typeof(by_brand) = 'array'),
  -- RIVA 63.4: números inicial y final de las facturas simplificadas (los pone F01).
  first_invoice    text,
  last_invoice     text,
  -- La huella del detalle (CCom 28.2): md5 de los pedidos y sus importes, ordenados.
  detail_hash      text not null,
  sale_ids         uuid[] not null default '{}',
  base_calculated  boolean not null default false,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  constraint sales_day_summary_rango check ((first_invoice is null) = (last_invoice is null))
);
comment on table public.sales_day_summary is
  'C04. Resumen de las ventas de marcas propias de un día en un local (CCom 28.2; RIVA 63.4): recuento, total, base y cuota por tipo, cobro por canal, base por marca, rango de facturas y huella del detalle. base_calculated: la base sale del tipo, no del pedido.';
create unique index if not exists ux_sales_day_summary on public.sales_day_summary (company_id, location_id, sales_day);
drop trigger if exists trg_sales_day_summary_misma_cuenta on public.sales_day_summary;
create trigger trg_sales_day_summary_misma_cuenta before insert or update on public.sales_day_summary
  for each row execute function public.conta_misma_cuenta();

-- ── 5 · payroll_summary: la nómina del mes ──────────────────────────────────
create table if not exists public.payroll_summary (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete cascade,
  period_month    date not null check (period_month = date_trunc('month', period_month)::date),
  location_id     uuid references public.locations(id) on delete restrict,
  gross           numeric(14, 2) not null check (gross >= 0),
  employer_ss     numeric(14, 2) not null default 0 check (employer_ss >= 0),
  employee_ss     numeric(14, 2) not null default 0 check (employee_ss >= 0),
  irpf            numeric(14, 2) not null default 0 check (irpf >= 0),
  other_deductions numeric(14, 2) not null default 0 check (other_deductions >= 0),
  net             numeric(14, 2) not null check (net >= 0),
  employees_count integer check (employees_count is null or employees_count >= 0),
  source          text not null default 'manual' check (source in ('manual', 'file', 'payroll_module')),
  document_url    text,
  entry_id        uuid references public.journal_entry(id) on delete set null,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  created_by_name text,
  constraint payroll_summary_cuadra check (gross = employee_ss + irpf + other_deductions + net)
);
comment on table public.payroll_summary is
  'C04. Resumen mensual de nóminas (por local si viene): bruto (640), SS de la empresa (642), SS del trabajador e IRPF retenidos (476, 4751), líquido (465). Hoy lo escribe la gestoría o se teclea; el módulo de personal lo rellenará (source payroll_module).';
create unique index if not exists ux_payroll_summary on public.payroll_summary (company_id, period_month, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
drop trigger if exists trg_payroll_summary_misma_cuenta on public.payroll_summary;
create trigger trg_payroll_summary_misma_cuenta before insert or update on public.payroll_summary
  for each row execute function public.conta_misma_cuenta();

-- ── 6 · allocation_rule: reparto de los gastos comunes ──────────────────────
create table if not exists public.allocation_rule (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  company_id   uuid not null references public.company(id) on delete cascade,
  location_id  uuid not null references public.locations(id) on delete cascade,
  pct          numeric(7, 4) not null check (pct > 0 and pct <= 100),
  valid_from   date not null,
  valid_to     date,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  constraint allocation_rule_fechas check (valid_to is null or valid_to >= valid_from)
);
comment on table public.allocation_rule is
  'C04. Cómo se reparte un gasto común entre los locales (porcentajes revisables, con vigencia). Por defecto lo común se queda común y el informe reparte.';
create index if not exists idx_allocation_rule_empresa on public.allocation_rule (company_id, valid_from);
drop trigger if exists trg_allocation_rule_misma_cuenta on public.allocation_rule;
create trigger trg_allocation_rule_misma_cuenta before insert or update on public.allocation_rule
  for each row execute function public.conta_misma_cuenta();

-- ── 7 · entry_template: asientos predefinidos ───────────────────────────────
create table if not exists public.entry_template (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  company_id   uuid not null references public.company(id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  series       smallint not null default 4 check (series in (1, 2, 3, 4, 9)),
  concept      text not null check (length(trim(concept)) > 0),
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  unique (company_id, name)
);
create table if not exists public.entry_template_line (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  template_id         uuid not null references public.entry_template(id) on delete cascade,
  position            smallint not null check (position > 0),
  company_account_id  uuid not null references public.company_account(id) on delete restrict,
  side                text not null check (side in ('debit', 'credit')),
  fixed_amount        numeric(14, 2) check (fixed_amount is null or fixed_amount > 0),
  concept             text,
  location_id         uuid references public.locations(id) on delete restrict,
  is_common           boolean not null default false,
  brand_id            uuid references public.brand(id) on delete restrict,
  unique (template_id, position),
  constraint entry_template_line_comun_sin_local check (not (is_common and location_id is not null))
);
comment on table public.entry_template is 'C04. Asiento predefinido: sus apuntes con la cuenta y el lado; el importe se rellena al usarlo (o es fijo).';
drop trigger if exists trg_entry_template_misma_cuenta on public.entry_template;
create trigger trg_entry_template_misma_cuenta before insert or update on public.entry_template
  for each row execute function public.conta_misma_cuenta();
drop trigger if exists trg_entry_template_line_misma_cuenta on public.entry_template_line;
create trigger trg_entry_template_line_misma_cuenta before insert or update on public.entry_template_line
  for each row execute function public.conta_misma_cuenta();

-- ── 7b · Lo aprendido de las correcciones y lo descartado (reglas 10 y 11) ──
create table if not exists public.journal_correction (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete cascade,
  origin_key      text not null check (length(trim(origin_key)) > 0),
  proposed_code   text not null,
  chosen_code     text not null,
  entry_id        uuid references public.journal_entry(id) on delete set null,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  created_by_name text
);
comment on table public.journal_correction is
  'C04. Regla 11: una cuenta que la persona cambió en una propuesta. La siguiente propuesta del mismo origen (origin_key: «channel_settlement:<canal>», «supplier_invoice:<proveedor>») lo hace igual y lo dice.';
create index if not exists idx_journal_correction on public.journal_correction (company_id, origin_key, created_at desc);
drop trigger if exists trg_journal_correction_misma_cuenta on public.journal_correction;
create trigger trg_journal_correction_misma_cuenta before insert or update on public.journal_correction
  for each row execute function public.conta_misma_cuenta();

create table if not exists public.journal_dismissal (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete cascade,
  source_type     text not null,
  source_key      text not null,
  reason          text not null check (length(trim(reason)) > 0),
  created_at      timestamptz not null default now(),
  created_by      uuid,
  created_by_name text,
  unique (company_id, source_type, source_key)
);
comment on table public.journal_dismissal is
  'C04. Una propuesta descartada, con su motivo: Folvy no la vuelve a proponer (source_key: el id del documento, o «local:día» para las ventas del día).';
drop trigger if exists trg_journal_dismissal_misma_cuenta on public.journal_dismissal;
create trigger trg_journal_dismissal_misma_cuenta before insert or update on public.journal_dismissal
  for each row execute function public.conta_misma_cuenta();

-- ── 7c · La opción de la empresa: validar solos los Seguros de ventas ───────
alter table public.company_tax_profile add column if not exists journal_autovalidate_sales_day boolean not null default false;
comment on column public.company_tax_profile.journal_autovalidate_sales_day is
  'C04. Regla 10: con esta opción (apagada por defecto), las propuestas «Seguro» de ventas del día se validan solas. Nada más se valida solo.';

-- ── 7d · La fecha de corte es un dato: cambiable mientras no haya traído ────
create or replace function public.fiscal_year_corte_cambiable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.origin, new.origin_program, new.imported_until) is distinct from (old.origin, old.origin_program, old.imported_until)
     and exists (select 1 from public.journal_entry e where e.fiscal_year_id = old.id and e.source_type = 'migrated') then
    raise exception 'El ejercicio % ya tiene asientos traídos: la fecha de corte no se cambia (se deshace lo traído y se vuelve a traer).', old.code
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.fiscal_year_corte_cambiable() from public, anon, authenticated;
drop trigger if exists trg_fiscal_year_corte_cambiable on public.fiscal_year;
create trigger trg_fiscal_year_corte_cambiable before update of origin, origin_program, imported_until on public.fiscal_year
  for each row execute function public.fiscal_year_corte_cambiable();

-- ── 8 · Lo de un apunte es de su asiento y de su empresa ────────────────────
create or replace function public.journal_line_coherente()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_e public.journal_entry; v_a public.company_account;
begin
  select * into v_e from public.journal_entry where id = new.entry_id;
  if v_e.company_id is distinct from new.company_id then
    raise exception 'El apunte y su asiento tienen que ser de la misma empresa.' using errcode = '23514';
  end if;
  select * into v_a from public.company_account where id = new.company_account_id;
  if v_a.company_id is distinct from new.company_id then
    raise exception 'Esa cuenta no es de esta empresa.' using errcode = '23514';
  end if;
  if v_a.status = 'cerrada' and v_e.source_type <> 'migrated' then
    raise exception 'La cuenta % está cerrada: no admite apuntes nuevos.', v_a.code using errcode = '23514';
  end if;
  if new.location_id is not null and not exists (select 1 from public.locations l where l.id = new.location_id and l.account_id = new.account_id) then
    raise exception 'Ese local no es de esta cuenta.' using errcode = '23514';
  end if;
  if new.brand_id is not null and not exists (select 1 from public.brand b where b.id = new.brand_id and b.account_id = new.account_id) then
    raise exception 'Esa marca no es de esta cuenta.' using errcode = '23514';
  end if;
  if new.party_id is not null and not exists (select 1 from public.party p where p.id = new.party_id and p.account_id = new.account_id) then
    raise exception 'Ese tercero no es de esta cuenta.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.journal_line_coherente() from public, anon, authenticated;
drop trigger if exists trg_journal_line_coherente on public.journal_line;
create trigger trg_journal_line_coherente before insert or update on public.journal_line
  for each row execute function public.journal_line_coherente();

-- ── 9 · Lo validado no se toca (CCom 29.1; LGT 29.2.j) ──────────────────────
-- Un asiento validado solo puede pasar a «anulado», y solo cambiando los datos
-- de la anulación. Sus apuntes no se tocan. No se borra nada con número.
-- Única excepción: escribir la huella en la misma transacción que valida
-- (journal_entry_validar marca «folvy.journal_huella» con el id del asiento).
create or replace function public.journal_entry_inalterable()
returns trigger language plpgsql set search_path = public as $$
declare
  v_anulacion constant text[] := array['status', 'voided_by_entry_id', 'voided_at', 'voided_by', 'voided_by_name', 'void_reason', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if old.number is not null or old.status in ('validado', 'anulado') then
      raise exception 'El asiento %/% está validado: no se borra, se anula.', old.series, old.number using errcode = '42501';
    end if;
    return old;
  end if;
  new.updated_at := now();
  if old.status = 'validado' and old.hash = 'pendiente' and current_setting('folvy.journal_huella', true) = old.id::text
     and (to_jsonb(new) - array['hash', 'updated_at']) = (to_jsonb(old) - array['hash', 'updated_at']) then
    return new;
  end if;
  if old.status = 'anulado' then
    raise exception 'El asiento %/% está anulado: ya no cambia.', old.series, old.number using errcode = '42501';
  end if;
  if old.status = 'validado' then
    if new.status <> 'anulado'
       or (to_jsonb(new) - v_anulacion) is distinct from (to_jsonb(old) - v_anulacion) then
      raise exception 'El asiento %/% está validado: no se modifica, se anula con un contraasiento.', old.series, old.number using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.journal_entry_inalterable() from public, anon, authenticated;
drop trigger if exists trg_journal_entry_inalterable on public.journal_entry;
create trigger trg_journal_entry_inalterable before update or delete on public.journal_entry
  for each row execute function public.journal_entry_inalterable();

create or replace function public.journal_line_inalterable()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text; v_entry uuid := coalesce(new.entry_id, old.entry_id);
begin
  select status into v_status from public.journal_entry where id = v_entry;
  -- Al borrar un borrador, sus apuntes se van con él (el asiento ya no existe).
  if v_status in ('validado', 'anulado') then
    raise exception 'Los apuntes de un asiento validado no se tocan: se anula con un contraasiento.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.entry_id <> old.entry_id then
    raise exception 'Un apunte no cambia de asiento.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.journal_line_inalterable() from public, anon, authenticated;
drop trigger if exists trg_journal_line_inalterable on public.journal_line;
create trigger trg_journal_line_inalterable before insert or update or delete on public.journal_line
  for each row execute function public.journal_line_inalterable();

-- ── 10 · RLS: leer, la cuenta; escribir, administradores y encargados ───────
-- journal_entry y journal_line NO se insertan ni se validan a pelo: el
-- borrador sí (lo guarda la pantalla), validar y anular van por funciones
-- (0120) que ponen número y huella.
alter table public.journal_entry enable row level security;
alter table public.journal_line enable row level security;
alter table public.sales_day_summary enable row level security;
alter table public.payroll_summary enable row level security;
alter table public.allocation_rule enable row level security;
alter table public.entry_template enable row level security;
alter table public.entry_template_line enable row level security;
alter table public.journal_correction enable row level security;
alter table public.journal_dismissal enable row level security;
do $$
declare t text;
begin
  foreach t in array array['journal_entry', 'journal_line', 'sales_day_summary', 'payroll_summary', 'allocation_rule',
                           'entry_template', 'entry_template_line', 'journal_correction', 'journal_dismissal'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select using (belongs_to_account(account_id))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (current_user_is_admin_or_manager_of(account_id))', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update using (current_user_is_admin_or_manager_of(account_id))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (current_user_is_admin_or_manager_of(account_id))', t);
    execute format('revoke all on table public.%1$s from anon', t);
  end loop;
end $$;
-- Un borrador o una propuesta se guardan desde la pantalla; validado y anulado
-- solo los ponen las funciones (SECURITY DEFINER) de la 0120.
drop policy if exists journal_entry_insert on public.journal_entry;
create policy journal_entry_insert on public.journal_entry for insert
  with check (current_user_is_admin_or_manager_of(account_id) and status in ('propuesto', 'borrador') and number is null and source_type <> 'migrated');
drop policy if exists journal_entry_update on public.journal_entry;
create policy journal_entry_update on public.journal_entry for update
  using (current_user_is_admin_or_manager_of(account_id) and status in ('propuesto', 'borrador'))
  with check (status in ('propuesto', 'borrador') and number is null);
