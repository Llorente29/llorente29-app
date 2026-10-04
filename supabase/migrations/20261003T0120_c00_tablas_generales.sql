-- ============================================================================
-- C00 · El cimiento — 3/4 · TABLAS GENERALES
-- ----------------------------------------------------------------------------
-- Encargo C00 §4.3–4.4 y respuesta 1 de Julio (D1, D5, D6). SOLO AÑADE.
--
-- Mecanismo común:
--   · Filas DE SERIE (de Folvy, iguales para todos): account_id y company_id
--     nulos, is_system = true, con legal_ref, verified_at y source_key (de qué
--     fuente oficial salen). Nadie las escribe desde la app.
--   · Filas PROPIAS de una empresa: account_id y company_id puestos.
--   · De una fila de serie, la empresa solo puede cambiar las cuentas indicadas
--     y ocultarla (general_row_setting); ni su porcentaje ni su nombre legal.
--   · Vigencia: un cambio de porcentaje es una FILA NUEVA con su fecha, nunca
--     una edición (lo impide un disparador), y no puede haber dos vigentes a la
--     vez para el mismo concepto.
--
-- D1: los impuestos tienen UNA fuente, tax_rate. Las categorías de Cocina
-- (vat_category) apuntan a ella por vat_category_tax: Cocina lee de
-- contabilidad, nunca al revés. vat_rate no se amplía ni se borra; el cambio de
-- vat_rate_for para que lea de aquí va con los valores (tarea 4).
--
-- Toca expense_category (columnas nuevas y sus políticas): no está en el camino
-- del pedido. No toca vat_category ni recipe_item.
-- ============================================================================

-- ── Guardas del mecanismo ───────────────────────────────────────────────────
-- Serie ⇔ sin cuenta ni empresa ⇔ con referencia legal, fecha y fuente.
create or replace function public.conta_fila_serie_ok(
  p_is_system boolean, p_account uuid, p_company uuid, p_legal_ref text, p_verified date, p_source text
) returns boolean language sql immutable as $$
  select case when p_is_system
    then p_account is null and p_company is null and p_legal_ref is not null and p_verified is not null and p_source is not null
    else p_account is not null and p_company is not null end
$$;

-- Las filas propias, de la empresa de su misma cuenta.
create or replace function public.conta_misma_cuenta_si_propia()
returns trigger language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if new.company_id is null then return new; end if;
  select account_id into v from public.company where id = new.company_id;
  if v is distinct from new.account_id then
    raise exception 'Esa empresa no es de esta cuenta' using errcode = '42501';
  end if;
  return new;
end $$;

-- Vigencias: sin solapes para el mismo concepto en el mismo ámbito, y el
-- porcentaje no se edita (se cierra la fila con valid_to y se abre otra).
create or replace function public.conta_vigencia_ok()
returns trigger language plpgsql set search_path = public as $$
declare otro uuid;
begin
  if tg_op = 'UPDATE' then
    if new.rate is distinct from old.rate or new.valid_from is distinct from old.valid_from
       or new.code is distinct from old.code then
      raise exception 'Un cambio de porcentaje o de fecha es una fila nueva con su fecha, nunca una edición' using errcode = '23514';
    end if;
  end if;
  if new.valid_to is not null and new.valid_to < new.valid_from then
    raise exception 'La vigencia acaba antes de empezar' using errcode = '23514';
  end if;
  execute format(
    'select id from public.%I where code = $1 and id <> $2 and company_id is not distinct from $3
       and daterange(valid_from, valid_to, ''[]'') && daterange($4, $5, ''[]'') limit 1', tg_table_name)
    into otro using new.code, new.id, new.company_id, new.valid_from, new.valid_to;
  if otro is not null then
    raise exception 'Ya hay otra fila de «%» vigente en esas fechas: cierra la anterior antes de abrir esta', new.code
      using errcode = '23P01';
  end if;
  return new;
end $$;

-- ── Impuestos ───────────────────────────────────────────────────────────────
create table if not exists public.tax_rate (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid references public.accounts(id) on delete cascade,
  company_id        uuid references public.company(id) on delete cascade,
  is_system         boolean not null default false,
  code              text not null,
  name              text not null,
  example           text,
  tax_system        text not null check (tax_system in ('iva', 'igic', 'ipsi')),
  territory         text not null check (territory in ('peninsula_baleares', 'canarias', 'ceuta_melilla')),
  treatment         text not null default 'taxed'
                      check (treatment in ('taxed', 'exempt', 'intra_eu', 'reverse_charge', 'not_subject')),
  rate              numeric(5, 2) not null check (rate between 0 and 100),
  surcharge_rate    numeric(5, 2) check (surcharge_rate is null or surcharge_rate between 0 and 100),
  valid_from        date not null,
  valid_to          date,
  pgc_input_hint    text,
  pgc_output_hint   text,
  declared_in       text[] not null default '{}',
  legal_ref         text,
  verified_at       date,
  source_key        text references public.official_source(key),
  sort_order        smallint not null default 0,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  constraint tax_rate_serie check (public.conta_fila_serie_ok(is_system, account_id, company_id, legal_ref, verified_at, source_key))
);
comment on table public.tax_rate is
  'C00 (D1). LA fuente de los porcentajes de impuestos: IVA, recargo de equivalencia, IGIC, IPSI, exentos, intracomunitario e inversión del sujeto pasivo.';

-- ── Retenciones ─────────────────────────────────────────────────────────────
create table if not exists public.withholding_rate (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid references public.accounts(id) on delete cascade,
  company_id        uuid references public.company(id) on delete cascade,
  is_system         boolean not null default false,
  code              text not null,
  name              text not null,
  example           text,
  rate              numeric(5, 2) not null check (rate between 0 and 100),
  model_190_key     text,
  model_190_subkey  text,
  filed_in          text not null check (filed_in in ('111', '115', '123')),
  valid_from        date not null,
  valid_to          date,
  pgc_hint          text,
  legal_ref         text,
  verified_at       date,
  source_key        text references public.official_source(key),
  sort_order        smallint not null default 0,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  constraint withholding_rate_serie check (public.conta_fila_serie_ok(is_system, account_id, company_id, legal_ref, verified_at, source_key))
);
comment on table public.withholding_rate is 'C00. Tipos de retención: %, clave y subclave del 190 y modelo en que se ingresa.';

-- ── Bancos y cajas (de la empresa) ──────────────────────────────────────────
create table if not exists public.treasury_account (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  company_id   uuid not null references public.company(id) on delete cascade,
  kind         text not null check (kind in ('bank', 'card', 'cash')),
  name         text not null check (length(trim(name)) > 0),
  iban         text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  bic          text,
  pgc_hint     text,
  is_default   boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  constraint treasury_account_iban_si_banco check (kind <> 'bank' or iban is not null)
);
comment on table public.treasury_account is 'C00. Cuentas bancarias, tarjetas y cajas de la empresa. El IBAN se valida con el núcleo del C01.';

-- ── Formas de pago ──────────────────────────────────────────────────────────
create table if not exists public.payment_method (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid references public.accounts(id) on delete cascade,
  company_id           uuid references public.company(id) on delete cascade,
  is_system            boolean not null default false,
  code                 text not null,
  name                 text not null,
  example              text,
  kind                 text not null check (kind in ('transfer', 'direct_debit', 'card', 'cash', 'other')),
  treasury_account_id  uuid references public.treasury_account(id) on delete set null,
  legal_ref            text,
  verified_at          date,
  source_key           text references public.official_source(key),
  sort_order           smallint not null default 0,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  constraint payment_method_serie check (public.conta_fila_serie_ok(is_system, account_id, company_id, legal_ref, verified_at, source_key))
);
comment on table public.payment_method is 'C00. Formas de pago, con el banco o la caja asociados.';

-- ── Plazos de pago ──────────────────────────────────────────────────────────
-- D6: solo se definen. El reparto en varios vencimientos por factura llega con
-- pagos y cobros.
create table if not exists public.payment_term (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid references public.accounts(id) on delete cascade,
  company_id   uuid references public.company(id) on delete cascade,
  is_system    boolean not null default false,
  code         text not null,
  name         text not null,
  example      text,
  days         integer[] not null default '{0}' check (array_length(days, 1) >= 1 and 0 <= all(days) and 366 > all(days)),
  fixed_days   smallint[] not null default '{}' check (1 <= all(fixed_days) and 31 >= all(fixed_days)),
  legal_ref    text,
  verified_at  date,
  source_key   text references public.official_source(key),
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  constraint payment_term_serie check (public.conta_fila_serie_ok(is_system, account_id, company_id, legal_ref, verified_at, source_key))
);
comment on table public.payment_term is 'C00. Plazos de pago: días desde la factura (uno o varios) y días fijos del mes.';

-- ── Numeración de facturas (de la empresa) ──────────────────────────────────
create table if not exists public.invoice_series (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  company_id    uuid not null references public.company(id) on delete cascade,
  code          text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,9}$'),
  name          text not null,
  doc_type      text not null check (doc_type in ('invoice', 'simplified', 'rectifying', 'rectifying_simplified')),
  digits        smallint not null default 6 check (digits between 1 and 12),
  reset_yearly  boolean not null default true,
  starts_at     integer not null default 1 check (starts_at >= 1),
  is_default    boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  unique (company_id, code)
);
comment on table public.invoice_series is
  'C00. Series de numeración por tipo de documento. Solo la definición: el contador llega con las facturas emitidas.';

-- ── Textos de los apuntes ───────────────────────────────────────────────────
create table if not exists public.entry_text (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid references public.accounts(id) on delete cascade,
  company_id   uuid references public.company(id) on delete cascade,
  is_system    boolean not null default false,
  code         text not null,
  text         text not null check (length(trim(text)) > 0),
  purpose      text not null check (purpose in ('purchase_invoice', 'sales_invoice', 'payment', 'collection', 'other')),
  legal_ref    text,
  verified_at  date,
  source_key   text references public.official_source(key),
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  constraint entry_text_serie check (public.conta_fila_serie_ok(is_system, account_id, company_id, legal_ref, verified_at, source_key))
);
comment on table public.entry_text is 'C00. Textos tipo de los apuntes («Su factura n.º *»). El asterisco se sustituye por el número.';

-- ── Tipos de gasto e ingreso: evolución de expense_category (no otra tabla) ─
-- El nombre pasa a ser el título oficial de la cuenta y lo coloquial pasa a
-- example (los valores, con su fuente, en la tarea 4). Filas propias por empresa.
alter table public.expense_category
  add column if not exists account_id   uuid references public.accounts(id) on delete cascade,
  add column if not exists company_id   uuid references public.company(id) on delete cascade,
  add column if not exists is_system    boolean not null default true,
  add column if not exists example      text,
  add column if not exists kind         text not null default 'expense',
  add column if not exists legal_ref    text,
  add column if not exists verified_at  date,
  add column if not exists source_key   text references public.official_source(key);
alter table public.expense_category drop constraint if exists expense_category_kind_check;
alter table public.expense_category add constraint expense_category_kind_check check (kind in ('expense', 'income'));
-- Las 12 del C01 son de serie y aún no tienen referencia: la tienen en la
-- tarea 4. Hasta entonces la guarda solo exige lo que ya cumplen.
alter table public.expense_category drop constraint if exists expense_category_serie;
alter table public.expense_category add constraint expense_category_serie check (
  case when is_system then account_id is null and company_id is null
       else account_id is not null and company_id is not null end);

-- ── Ajustes de una empresa sobre una fila de serie ──────────────────────────
-- Ocultarla y cambiar las cuentas indicadas. Nada más.
create table if not exists public.general_row_setting (
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  table_key        text not null check (table_key in
                     ('tax_rate', 'withholding_rate', 'payment_method', 'payment_term', 'expense_category', 'entry_text')),
  row_id           uuid not null,
  hidden           boolean not null default false,
  pgc_hint         text,
  pgc_input_hint   text,
  pgc_output_hint  text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  primary key (company_id, table_key, row_id)
);
comment on table public.general_row_setting is
  'C00. Lo que una empresa cambia de una fila de serie: ocultarla y sus cuentas indicadas. No su porcentaje ni su nombre legal.';

-- ── D1 · El puente de Cocina hacia los impuestos ────────────────────────────
-- Cada categoría de IVA de Cocina dice QUÉ impuesto (tax_rate.code) le toca y
-- desde cuándo. El porcentaje sale de tax_rate y solo de ahí.
create table if not exists public.vat_category_tax (
  vat_category_id  uuid not null references public.vat_category(id) on delete cascade,
  tax_code         text not null,
  valid_from       date not null,
  valid_to         date,
  note             text,
  primary key (vat_category_id, valid_from),
  constraint vat_category_tax_fechas check (valid_to is null or valid_to >= valid_from)
);
comment on table public.vat_category_tax is
  'C00 (D1). Qué impuesto de tax_rate corresponde a cada categoría de IVA de Cocina, y desde cuándo. Cocina lee de contabilidad, nunca al revés.';

-- El mismo dibujo que vat_rate (categoría, %, recargo, vigencia), sacado de
-- tax_rate a través del puente: la intersección de las dos vigencias.
create or replace view public.vat_category_rate with (security_invoker = true) as
  select b.vat_category_id                                   as category_id,
         t.rate,
         coalesce(t.surcharge_rate, 0)::numeric               as equivalence_surcharge,
         greatest(b.valid_from, t.valid_from)                 as valid_from,
         case when b.valid_to is null then t.valid_to
              when t.valid_to is null then b.valid_to
              else least(b.valid_to, t.valid_to) end          as valid_to,
         t.name || ' · ' || t.legal_ref                       as note,
         t.code                                               as tax_code
    from public.vat_category_tax b
    join public.tax_rate t on t.code = b.tax_code and t.is_system
   where daterange(b.valid_from, b.valid_to, '[]') && daterange(t.valid_from, t.valid_to, '[]');
comment on view public.vat_category_rate is
  'C00 (D1). Lo que antes estaba escrito en vat_rate, ahora derivado de tax_rate por el puente. vat_rate_for lee de aquí desde la tarea 4.';

-- ── Disparadores ────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['tax_rate', 'withholding_rate'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_vigencia', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.conta_vigencia_ok()', t || '_vigencia', t);
  end loop;
  foreach t in array array['tax_rate', 'withholding_rate', 'payment_method', 'payment_term', 'entry_text', 'expense_category'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_misma_cuenta', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.conta_misma_cuenta_si_propia()', t || '_misma_cuenta', t);
  end loop;
  foreach t in array array['treasury_account', 'invoice_series', 'general_row_setting'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_misma_cuenta', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.conta_misma_cuenta()', t || '_misma_cuenta', t);
  end loop;
end $$;

-- ── Seguridad ───────────────────────────────────────────────────────────────
-- Serie: la lee cualquiera con sesión, no la escribe nadie desde la app.
-- Propias: como supplier (lee la cuenta; escribe administrador o encargado).
do $$
declare t text;
begin
  foreach t in array array['tax_rate', 'withholding_rate', 'payment_method', 'payment_term', 'entry_text', 'expense_category'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (is_system or belongs_to_account(account_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (not is_system and current_user_is_admin_or_manager_of(account_id))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (not is_system and current_user_is_admin_or_manager_of(account_id)) with check (not is_system and current_user_is_admin_or_manager_of(account_id))', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (not is_system and current_user_is_admin_or_manager_of(account_id))', t || '_delete', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
  foreach t in array array['treasury_account', 'invoice_series', 'general_row_setting'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (belongs_to_account(account_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (current_user_is_admin_or_manager_of(account_id))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (current_user_is_admin_or_manager_of(account_id)) with check (current_user_is_admin_or_manager_of(account_id))', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (current_user_is_admin_or_manager_of(account_id))', t || '_delete', t);
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end $$;

alter table public.vat_category_tax enable row level security;
drop policy if exists vat_category_tax_select on public.vat_category_tax;
create policy vat_category_tax_select on public.vat_category_tax for select to authenticated using (true);
revoke all on table public.vat_category_tax from anon, authenticated;
grant select on table public.vat_category_tax to authenticated;
revoke all on public.vat_category_rate from anon;
grant select on public.vat_category_rate to authenticated;
