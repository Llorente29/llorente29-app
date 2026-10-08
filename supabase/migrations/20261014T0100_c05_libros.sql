-- ============================================================================
-- C05 · Libros y balances — 1 · LO QUE SE GUARDA
-- ----------------------------------------------------------------------------
-- Casi todo son consultas sobre journal_line. Lo que se guarda, todo nuevo:
--
--   · annual_accounts_line / annual_accounts_mapping: los modelos oficiales de
--     cuentas anuales (balance, PyG, estado de ingresos y gastos reconocidos;
--     normal, abreviado y pymes) y qué cuentas alimentan cada línea. La serie
--     (account_id nulo) la carga la 0110, GENERADA desde el BOE con su huella.
--     Una empresa puede cambiar su mapeo: fila propia (company_id), con
--     historial en annual_accounts_mapping_change y «volver al estándar».
--   · vat_book_entry: el libro registro del IVA. Una fila por factura y tipo
--     impositivo con lo que el formato de la AEAT pide y el apunte no tiene
--     (tipo de factura F1/F2/F4/R1…, serie y número, número final del asiento
--     resumen, fecha de operación, clave y calificación, recargo, actividad).
--     Se crea al validar el asiento y se anula con él (respuesta 1 del C05);
--     el disparador que lo hace va aparte, en la 0120, porque toca journal_entry.
--   · investment_good (+ _regularization): bienes de inversión (RIVA art. 65).
--   · fiscal_year_closing: el cierre de cada ejercicio — regularización, cierre
--     y apertura enlazados, estado, quién y cuándo — y su rastro al reabrir.
--
-- Funciones nuevas (nombres que no existían: no hay sobrecargas):
--   conta_vat_book_desde_asiento, conta_saldos_cuentas, conta_mapeo_cambiar,
--   conta_mapeo_volver_al_estandar, conta_cierre_enlazar, conta_cierre_cerrar,
--   conta_cierre_reabrir.
-- Nada de esto está en el camino del pedido. Solo añade.
-- Vuelta atrás: supabase/vuelta-atras/20261014T0100_c05_libros.down.sql
-- ============================================================================

-- ── 1 · Líneas de los modelos oficiales ─────────────────────────────────────
create table if not exists public.annual_accounts_line (
  id          uuid primary key default gen_random_uuid(),
  model       text not null check (model in ('normal', 'abreviado', 'pymes')),
  statement   text not null check (statement in ('balance', 'pyg', 'igrpn')),
  code        text not null,
  parent_code text,
  text        text not null check (length(trim(text)) > 0),
  level       smallint not null check (level between 1 and 6),
  sort_order  integer not null,
  side        text check (side is null or side in ('activo', 'pn_pasivo')),
  is_total    boolean not null default false,
  -- Partida que las normas de elaboración mandan crear solo si tiene saldo.
  to_create   boolean not null default false,
  legal_ref   text not null,
  source_key  text not null,
  source_sha256 text not null,
  created_at  timestamptz not null default now(),
  unique (model, statement, code)
);
comment on table public.annual_accounts_line is
  'C05. Líneas de los modelos oficiales de cuentas anuales del PGC (RD 1514/2007 y 1515/2007, tercera parte), tal cual el texto consolidado del BOE, más las partidas «a crear» de las normas de elaboración (to_create). Serie: la carga una migración generada; no se edita.';

-- ── 2 · Qué cuentas alimentan cada línea ────────────────────────────────────
create table if not exists public.annual_accounts_mapping (
  id             uuid primary key default gen_random_uuid(),
  -- Nulos los dos: la serie. Con valor: el mapeo propio de una empresa, que
  -- manda sobre la serie para ese prefijo y estado.
  account_id     uuid references public.accounts(id) on delete cascade,
  company_id     uuid references public.company(id) on delete cascade,
  model          text not null check (model in ('normal', 'abreviado', 'pymes')),
  statement      text not null check (statement in ('balance', 'pyg', 'igrpn')),
  line_code      text not null,
  account_prefix text not null check (account_prefix ~ '^[0-9]{1,8}$'),
  -- Informativo: «(2801)» resta en el modelo. El importe de una línea es el
  -- saldo natural de su lado (Debe − Haber en el activo; Haber − Debe en
  -- patrimonio neto, pasivo y PyG).
  sign           text not null default 'suma' check (sign in ('suma', 'resta')),
  -- Signo por saldo (el asterisco de Diez): deudor → esta línea; acreedor → la otra.
  by_balance     text check (by_balance is null or by_balance in ('deudor', 'acreedor')),
  origin         text not null check (origin in ('boe', 'a_crear', 'resultado', 'defecto', 'empresa')),
  any_sign       boolean not null default false,
  note           text,
  legal_ref      text,
  -- Una fila propia puede DEJAR FUERA un prefijo de la serie (excluded): el
  -- agente avisa si con eso queda una cuenta con saldo sin sitio (regla 9).
  excluded       boolean not null default false,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  created_by_name text,
  constraint annual_accounts_mapping_serie_o_empresa check ((account_id is null) = (company_id is null)),
  constraint annual_accounts_mapping_origen_empresa check ((company_id is null) = (origin <> 'empresa')),
  constraint annual_accounts_mapping_linea foreign key (model, statement, line_code)
    references public.annual_accounts_line (model, statement, code) on delete restrict
);
create unique index if not exists uq_annual_accounts_mapping_serie
  on public.annual_accounts_mapping (model, statement, line_code, account_prefix) where company_id is null;
create unique index if not exists uq_annual_accounts_mapping_empresa
  on public.annual_accounts_mapping (company_id, model, statement, account_prefix, coalesce(by_balance, '')) where company_id is not null;
create index if not exists idx_annual_accounts_mapping_empresa on public.annual_accounts_mapping (company_id) where company_id is not null;
comment on table public.annual_accounts_mapping is
  'C05. Línea ↔ cuentas (prefijos). Serie desde el BOE (origin boe/a_crear/resultado/defecto) y cambios por empresa (origin empresa) con historial en annual_accounts_mapping_change. Gana el prefijo más largo; by_balance reparte por el signo del saldo.';

create table if not exists public.annual_accounts_mapping_change (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  company_id     uuid not null references public.company(id) on delete cascade,
  model          text not null,
  statement      text not null,
  account_prefix text,
  action         text not null check (action in ('cambia', 'deja_fuera', 'estandar')),
  from_line      text,
  to_line        text,
  reason         text,
  changed_at     timestamptz not null default now(),
  changed_by     uuid,
  changed_by_name text
);
create index if not exists idx_annual_accounts_mapping_change on public.annual_accounts_mapping_change (company_id, changed_at desc);
comment on table public.annual_accounts_mapping_change is
  'C05 · regla 9. Rastro de cada cambio del mapeo de una empresa: quién, cuándo, de qué línea a cuál; «estandar» = volvió a la serie del PGC.';

-- ── 3 · Libro registro del IVA ──────────────────────────────────────────────
create table if not exists public.vat_book_entry (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete restrict,
  entry_id            uuid not null references public.journal_entry(id) on delete restrict,
  line_id             uuid references public.journal_line(id) on delete restrict,
  book                text not null check (book in ('issued', 'received', 'investment', 'not_subject')),
  -- AEAT, nota 9 del diseño: F1 con destinatario, F2 simplificada, F3
  -- sustitutiva, F4 asiento resumen, R1–R5 rectificativas.
  invoice_type        text not null check (invoice_type in ('F1', 'F2', 'F3', 'F4', 'R1', 'R2', 'R3', 'R4', 'R5')),
  series              text,
  number              text,
  number_to           text,
  documents_count     integer not null default 1 check (documents_count > 0),
  issue_date          date not null,
  operation_date      date,
  received_date       date,
  received_number     text,
  party_id            uuid references public.party(id) on delete set null,
  counterpart_tax_id  text,
  -- Vacío = NIF español; 02 NIF-IVA, 03 pasaporte, 04 doc. oficial, 05 certificado de residencia, 06 otro.
  counterpart_id_type text check (counterpart_id_type is null or counterpart_id_type in ('02', '03', '04', '05', '06')),
  counterpart_country text,
  counterpart_name    text,
  operation_key       text not null default '01',
  qualification       text check (qualification is null or qualification in ('S1', 'S2', 'N1', 'N2')),
  exempt_cause        text check (exempt_cause is null or exempt_cause in ('E1', 'E2', 'E3', 'E4', 'E5', 'E6')),
  tax_base            numeric(14, 2) not null,
  tax_rate            numeric(5, 2),
  tax_amount          numeric(14, 2) not null default 0,
  surcharge_rate      numeric(5, 2),
  surcharge_amount    numeric(14, 2),
  total               numeric(14, 2),
  deductible_amount   numeric(14, 2),
  deductible_later    boolean not null default false,
  reverse_charge      boolean not null default false,
  investment_good     boolean not null default false,
  withholding_rate    numeric(5, 2),
  withholding_amount  numeric(14, 2),
  activity_code       text,
  activity_type       text,
  activity_iae        text,
  corrects_ref        text,
  source_type         text not null,
  source_id           uuid,
  voided_at           timestamptz,
  voided_by_entry_id  uuid references public.journal_entry(id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by_name     text,
  constraint vat_book_entry_resumen check (invoice_type <> 'F4' or documents_count >= 1)
);
create unique index if not exists uq_vat_book_entry_linea on public.vat_book_entry (line_id) where line_id is not null;
create index if not exists idx_vat_book_entry_libro on public.vat_book_entry (company_id, book, issue_date);
create index if not exists idx_vat_book_entry_asiento on public.vat_book_entry (entry_id);
comment on table public.vat_book_entry is
  'C05. Libro registro del IVA (RIVA arts. 62–70) en el formato de requerimiento de la AEAT: una fila por factura (o asiento resumen F4, RIVA 63.4) y tipo. Se crea al validar el asiento con su apunte de IVA y se anula con él. Lo que el documento no dice (NIF, fecha de operación) se completa en pantalla.';

-- ── 4 · Bienes de inversión (RIVA art. 65) ──────────────────────────────────
create table if not exists public.investment_good (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete restrict,
  description         text not null check (length(trim(description)) > 0),
  -- Inmueble: 10 años de regularización; resto: 5 (LIVA art. 107).
  kind                text not null default 'mueble' check (kind in ('mueble', 'inmueble')),
  company_account_id  uuid references public.company_account(id) on delete restrict,
  entry_id            uuid references public.journal_entry(id) on delete restrict,
  vat_book_entry_id   uuid references public.vat_book_entry(id) on delete set null,
  acquired_on         date not null,
  start_use_on        date,
  acquisition_value   numeric(14, 2) not null check (acquisition_value >= 0),
  tax_base            numeric(14, 2) not null default 0,
  vat_rate            numeric(5, 2),
  vat_amount          numeric(14, 2) not null default 0,
  deductible_pct      numeric(5, 2) not null default 100 check (deductible_pct between 0 and 100),
  amortization_method text,
  amortization_pct    numeric(5, 2),
  disposed_on         date,
  disposal_cause      text,
  disposal_ref        text,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  created_by_name     text
);
create index if not exists idx_investment_good_empresa on public.investment_good (company_id, acquired_on);
comment on table public.investment_good is
  'C05. Bien de inversión a efectos del IVA (LIVA art. 108; RIVA art. 65): alta, importe, cuota, fecha de entrada en funcionamiento, baja. Las regularizaciones anuales (LIVA arts. 107 y 109) en investment_good_regularization.';

create table if not exists public.investment_good_regularization (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  investment_good_id  uuid not null references public.investment_good(id) on delete cascade,
  year                integer not null,
  final_prorrata      numeric(5, 2) not null check (final_prorrata between 0 and 100),
  deductible_amount   numeric(14, 2) not null,
  regularization      numeric(14, 2) not null,
  entry_id            uuid references public.journal_entry(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (investment_good_id, year)
);

-- ── 5 · Cierre del ejercicio ────────────────────────────────────────────────
create table if not exists public.fiscal_year_closing (
  fiscal_year_id         uuid primary key references public.fiscal_year(id) on delete cascade,
  account_id             uuid not null references public.accounts(id) on delete cascade,
  company_id             uuid not null references public.company(id) on delete restrict,
  -- abierto → preparado (los tres asientos propuestos) → cerrado.
  status                 text not null default 'abierto' check (status in ('abierto', 'preparado', 'cerrado')),
  regularization_entry_id uuid references public.journal_entry(id) on delete set null,
  closing_entry_id       uuid references public.journal_entry(id) on delete set null,
  opening_entry_id       uuid references public.journal_entry(id) on delete set null,
  prepared_at            timestamptz,
  prepared_by_name       text,
  closed_at              timestamptz,
  closed_by              uuid,
  closed_by_name         text,
  -- Rastro de cada reapertura: [{fecha, quien, motivo, anulados:[…]}].
  reopenings             jsonb not null default '[]' check (jsonb_typeof(reopenings) = 'array'),
  updated_at             timestamptz not null default now()
);
comment on table public.fiscal_year_closing is
  'C05 · regla 7. Regularización (6 y 7 → 129), cierre y apertura del siguiente: tres asientos de la serie General (source_type closing / closing / opening) enlazados aquí. Reabrir anula apertura y cierre con rastro.';

-- ── 6 · RLS: leer, la cuenta; escribir, administradores y encargados ───────
alter table public.annual_accounts_line enable row level security;
alter table public.annual_accounts_mapping enable row level security;
alter table public.annual_accounts_mapping_change enable row level security;
alter table public.vat_book_entry enable row level security;
alter table public.investment_good enable row level security;
alter table public.investment_good_regularization enable row level security;
alter table public.fiscal_year_closing enable row level security;

-- La serie es de todos (como pgc_account); nadie la escribe desde la app.
drop policy if exists annual_accounts_line_select on public.annual_accounts_line;
create policy annual_accounts_line_select on public.annual_accounts_line for select to authenticated using (true);

drop policy if exists annual_accounts_mapping_select on public.annual_accounts_mapping;
create policy annual_accounts_mapping_select on public.annual_accounts_mapping for select to authenticated
  using (account_id is null or belongs_to_account(account_id));
-- El mapeo propio se escribe por las funciones (dejan historial); a pelo, nada.

drop policy if exists annual_accounts_mapping_change_select on public.annual_accounts_mapping_change;
create policy annual_accounts_mapping_change_select on public.annual_accounts_mapping_change for select to authenticated
  using (belongs_to_account(account_id));

drop policy if exists vat_book_entry_select on public.vat_book_entry;
create policy vat_book_entry_select on public.vat_book_entry for select to authenticated using (belongs_to_account(account_id));
-- Completar (NIF, fecha de operación, tipo de factura…) sí desde la pantalla;
-- crear y anular, solo el disparador de la 0120.
drop policy if exists vat_book_entry_update on public.vat_book_entry;
create policy vat_book_entry_update on public.vat_book_entry for update to authenticated
  using (current_user_is_admin_or_manager_of(account_id) and voided_at is null)
  with check (current_user_is_admin_or_manager_of(account_id) and voided_at is null);

drop policy if exists investment_good_select on public.investment_good;
create policy investment_good_select on public.investment_good for select to authenticated using (belongs_to_account(account_id));
drop policy if exists investment_good_insert on public.investment_good;
create policy investment_good_insert on public.investment_good for insert to authenticated with check (current_user_is_admin_or_manager_of(account_id));
drop policy if exists investment_good_update on public.investment_good;
create policy investment_good_update on public.investment_good for update to authenticated using (current_user_is_admin_or_manager_of(account_id));

drop policy if exists investment_good_regularization_select on public.investment_good_regularization;
create policy investment_good_regularization_select on public.investment_good_regularization for select to authenticated using (belongs_to_account(account_id));
drop policy if exists investment_good_regularization_insert on public.investment_good_regularization;
create policy investment_good_regularization_insert on public.investment_good_regularization for insert to authenticated with check (current_user_is_admin_or_manager_of(account_id));

drop policy if exists fiscal_year_closing_select on public.fiscal_year_closing;
create policy fiscal_year_closing_select on public.fiscal_year_closing for select to authenticated using (belongs_to_account(account_id));

revoke all on table public.annual_accounts_line, public.annual_accounts_mapping, public.annual_accounts_mapping_change,
  public.vat_book_entry, public.investment_good, public.investment_good_regularization, public.fiscal_year_closing from anon;

drop trigger if exists trg_vat_book_entry_misma_cuenta on public.vat_book_entry;
create trigger trg_vat_book_entry_misma_cuenta before insert or update on public.vat_book_entry
  for each row execute function public.conta_misma_cuenta();
drop trigger if exists trg_investment_good_misma_cuenta on public.investment_good;
create trigger trg_investment_good_misma_cuenta before insert or update on public.investment_good
  for each row execute function public.conta_misma_cuenta();
drop trigger if exists trg_fiscal_year_closing_misma_cuenta on public.fiscal_year_closing;
create trigger trg_fiscal_year_closing_misma_cuenta before insert or update on public.fiscal_year_closing
  for each row execute function public.conta_misma_cuenta();

-- ── 7 · El libro registro desde un asiento validado ─────────────────────────
-- Una fila por apunte de IVA. Idempotente: si el asiento ya tiene filas, no
-- hace nada. Un contraasiento no crea filas (la anulación marca las del
-- original). Lo que no sabe, lo deja vacío para «Completar».
create or replace function public.conta_vat_book_desde_asiento(p_entry uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_e public.journal_entry; v_n integer := 0; l record;
  v_tipo text; v_num text; v_hasta text; v_docs int; v_fecha_op date; v_recep date; v_nif text; v_tipo_id text; v_pais text; v_nombre text;
  v_clave text; v_calif text; v_exenta text; v_corrige text; v_ret_tipo numeric; v_ret numeric; v_inv boolean; v_isp boolean;
  v_act_code text := 'A'; v_act_tipo text := '03'; v_iae text;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or v_e.status not in ('validado', 'anulado') or v_e.source_type = 'reversal' then return 0; end if;
  if exists (select 1 from public.vat_book_entry where entry_id = p_entry) then return 0; end if;
  select iae_code into v_iae from public.company_activity
   where company_id = v_e.company_id and is_main and (ended_on is null or ended_on >= v_e.entry_date) order by started_on desc nulls last limit 1;

  for l in
    select jl.*, t.rate, t.surcharge_rate, t.treatment
      from public.journal_line jl left join public.tax_rate t on t.id = jl.tax_rate_id
     where jl.entry_id = p_entry and jl.vat_book is not null
     order by jl.position
  loop
    v_tipo := 'F1'; v_num := coalesce(l.document_ref, v_e.document_ref); v_hasta := null; v_docs := l.tax_documents;
    v_fecha_op := null; v_recep := null; v_corrige := null; v_ret_tipo := null; v_ret := null;
    v_nif := null; v_tipo_id := null; v_pais := null; v_nombre := null;
    v_inv := l.vat_book = 'investment'; v_isp := l.treatment = 'reverse_charge';
    v_clave := case when l.treatment = 'intra_eu' and l.vat_book <> 'issued' then '09' else '01' end;
    v_calif := case when l.vat_book = 'not_subject' then 'N1' when l.treatment = 'exempt' or (l.treatment = 'intra_eu' and l.vat_book = 'issued') then null
                    when v_isp then 'S2' else 'S1' end;
    v_exenta := case when l.treatment = 'exempt' then 'E1' when l.treatment = 'intra_eu' and l.vat_book = 'issued' then 'E5' end;

    if v_e.source_type = 'sales_day' then
      -- Asiento resumen de tiques (RIVA 63.4): F4 con el rango; un tique suelto, F2.
      select first_invoice, last_invoice, tickets_count into v_num, v_hasta, v_docs
        from public.sales_day_summary where entry_id = p_entry or id = v_e.source_id order by (entry_id = p_entry) desc limit 1;
      v_docs := coalesce(nullif(l.tax_documents, 1), v_docs, 1);
      v_tipo := case when coalesce(v_docs, 1) > 1 then 'F4' else 'F2' end;
      v_nombre := 'VENTAS A CONSUMIDOR FINAL';
    elsif v_e.source_type = 'supplier_invoice' then
      select si.invoice_number, si.created_at::date, case when si.doc_kind = 'credit_note' then 'R1' else 'F1' end,
             (select c.invoice_number from public.supplier_invoice c where c.id = si.corrects_invoice_id),
             wr.rate, si.withholding_amount
        into v_num, v_recep, v_tipo, v_corrige, v_ret_tipo, v_ret
        from public.supplier_invoice si left join public.withholding_rate wr on wr.id = si.withholding_rate_id
       where si.id = v_e.source_id;
    elsif v_e.source_type in ('channel_settlement', 'licensed_settlement') then
      v_num := coalesce(v_num, (select settlement_ref from public.channel_settlement where id = v_e.source_id),
                               (select settlement_ref from public.licensed_settlement where id = v_e.source_id));
    end if;

    select p.tax_id, nullif(f.tax_id_type, 'nif'), f.country_code, coalesce(f.legal_name, p.name)
      into v_nif, v_tipo_id, v_pais, v_nombre
      from public.party p left join public.customer_fiscal f on f.party_id = p.id
     where p.id = coalesce(l.party_id, v_e.party_id)
       and v_e.source_type <> 'sales_day';
    if v_e.source_type = 'sales_day' then v_nombre := 'VENTAS A CONSUMIDOR FINAL'; end if;
    if v_tipo_id is not null and v_tipo_id not in ('02', '03', '04', '05', '06') then v_tipo_id := null; end if;

    insert into public.vat_book_entry (account_id, company_id, entry_id, line_id, book, invoice_type, number, number_to, documents_count,
      issue_date, operation_date, received_date, party_id, counterpart_tax_id, counterpart_id_type, counterpart_country, counterpart_name,
      operation_key, qualification, exempt_cause, tax_base, tax_rate, tax_amount, surcharge_rate, total,
      deductible_amount, reverse_charge, investment_good, withholding_rate, withholding_amount,
      activity_code, activity_type, activity_iae, corrects_ref, source_type, source_id, voided_at, voided_by_entry_id)
    values (v_e.account_id, v_e.company_id, p_entry, l.id, l.vat_book, v_tipo, v_num, v_hasta, greatest(coalesce(v_docs, 1), 1),
      coalesce(l.document_date, v_e.document_date, v_e.entry_date), v_fecha_op, v_recep, coalesce(l.party_id, v_e.party_id),
      v_nif, v_tipo_id, v_pais, v_nombre,
      v_clave, v_calif, v_exenta, l.tax_base, l.rate,
      case when l.vat_book = 'issued' then l.credit - l.debit else l.debit - l.credit end,
      nullif(l.surcharge_rate, 0),
      l.tax_base + case when l.vat_book = 'issued' then l.credit - l.debit else l.debit - l.credit end,
      case when l.vat_book in ('received', 'investment') and l.vat_deductible = 'yes' then l.debit - l.credit when l.vat_book in ('received', 'investment') then 0 end,
      v_isp, v_inv, v_ret_tipo, v_ret,
      case when v_iae is null then null else v_act_code end, case when v_iae is null then null else v_act_tipo end, v_iae,
      v_corrige, v_e.source_type, v_e.source_id,
      case when v_e.status = 'anulado' then coalesce(v_e.voided_at, now()) end, v_e.voided_by_entry_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.conta_vat_book_desde_asiento(uuid) from public, anon, authenticated;
comment on function public.conta_vat_book_desde_asiento(uuid) is
  'C05. Crea las filas del libro registro de un asiento validado (o anulado: nacen anuladas). Idempotente. La llama el disparador de la 0120.';

-- ── 8 · Saldos por cuenta para sumas y saldos, balance y PyG ────────────────
-- Una sola lectura por cuenta (y local/marca si se pide), separando lo que las
-- opciones de Diez dejan incluir o no: apertura, regularización y cierre.
-- saldo inicial = antes de p_desde dentro del mismo ejercicio + la apertura.
create or replace function public.conta_saldos_cuentas(p_company uuid, p_desde date, p_hasta date, p_por_local boolean default false)
returns table (company_account_id uuid, code text, name text, template_code text, location_id uuid, brand_id uuid,
               inicial_debe numeric, inicial_haber numeric,
               apertura_debe numeric, apertura_haber numeric,
               periodo_debe numeric, periodo_haber numeric,
               regularizacion_debe numeric, regularizacion_haber numeric,
               cierre_debe numeric, cierre_haber numeric)
language sql stable security invoker set search_path = public as $$
  with ej as (
    select starts_on from public.fiscal_year where company_id = p_company and p_hasta between starts_on and ends_on limit 1
  ), cierre as (
    select c.regularization_entry_id r, c.closing_entry_id c, c.opening_entry_id o
      from public.fiscal_year_closing c where c.company_id = p_company
  ), l as (
    select l.*, case
             when l.source_type = 'opening' or l.entry_id in (select o from cierre) then 'apertura'
             when l.entry_id in (select r from cierre where r is not null) then 'regularizacion'
             when l.entry_id in (select c from cierre where c is not null) then 'cierre'
             when l.source_type = 'closing' then 'cierre'
             else 'normal' end as clase
      from public.journal_ledger l
     where l.company_id = p_company
       and l.entry_date between coalesce((select starts_on from ej), p_desde) and p_hasta
  )
  select l.company_account_id, l.account_code, l.account_name, l.template_code,
         case when p_por_local then l.location_id end, case when p_por_local then l.brand_id end,
         coalesce(sum(l.debit)  filter (where l.entry_date < p_desde and l.clase = 'normal'), 0),
         coalesce(sum(l.credit) filter (where l.entry_date < p_desde and l.clase = 'normal'), 0),
         coalesce(sum(l.debit)  filter (where l.clase = 'apertura'), 0),
         coalesce(sum(l.credit) filter (where l.clase = 'apertura'), 0),
         coalesce(sum(l.debit)  filter (where l.entry_date >= p_desde and l.clase = 'normal'), 0),
         coalesce(sum(l.credit) filter (where l.entry_date >= p_desde and l.clase = 'normal'), 0),
         coalesce(sum(l.debit)  filter (where l.clase = 'regularizacion'), 0),
         coalesce(sum(l.credit) filter (where l.clase = 'regularizacion'), 0),
         coalesce(sum(l.debit)  filter (where l.clase = 'cierre'), 0),
         coalesce(sum(l.credit) filter (where l.clase = 'cierre'), 0)
    from l
   group by 1, 2, 3, 4, 5, 6
   order by 2
$$;
grant execute on function public.conta_saldos_cuentas(uuid, date, date, boolean) to authenticated;
comment on function public.conta_saldos_cuentas(uuid, date, date, boolean) is
  'C05. Saldos de cada cuenta del ejercicio que contiene p_hasta, separados en inicial (antes de p_desde), apertura, periodo, regularización y cierre. Con la RLS de quien lee (journal_ledger es security_invoker).';

-- ── 9 · Cambiar el mapeo de una empresa, con historial (regla 9) ────────────
create or replace function public.conta_mapeo_cambiar(p_company uuid, p_model text, p_statement text, p_prefix text,
                                                      p_line text, p_by_balance text default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_de text; v_quien text := public.conta_nombre_actor();
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta cambia qué cuentas alimentan cada línea.' using errcode = '42501';
  end if;
  if p_prefix !~ '^[0-9]{1,8}$' then raise exception 'La cuenta tiene que ser un número de cuenta (prefijo).' using errcode = '22023'; end if;
  if p_line is not null and not exists (select 1 from public.annual_accounts_line where model = p_model and statement = p_statement and code = p_line and not is_total) then
    raise exception 'Esa línea no existe en el modelo % (%).', p_model, p_statement using errcode = '22023';
  end if;
  -- De dónde venía: lo propio si lo había; si no, la serie más específica.
  select line_code into v_de from public.annual_accounts_mapping
   where company_id = p_company and model = p_model and statement = p_statement and account_prefix = p_prefix and coalesce(by_balance, '') = coalesce(p_by_balance, '') limit 1;
  if v_de is null then
    select line_code into v_de from public.annual_accounts_mapping
     where company_id is null and model = p_model and statement = p_statement and p_prefix like account_prefix || '%'
       and coalesce(by_balance, '') = coalesce(p_by_balance, '')
     order by length(account_prefix) desc limit 1;
  end if;
  delete from public.annual_accounts_mapping
   where company_id = p_company and model = p_model and statement = p_statement and account_prefix = p_prefix and coalesce(by_balance, '') = coalesce(p_by_balance, '');
  insert into public.annual_accounts_mapping (account_id, company_id, model, statement, line_code, account_prefix, by_balance, origin, excluded, note, created_by, created_by_name)
  values (v_acc, p_company, p_model, p_statement,
          coalesce(p_line, (select code from public.annual_accounts_line where model = p_model and statement = p_statement order by sort_order limit 1)),
          p_prefix, p_by_balance, 'empresa', p_line is null, p_motivo, auth.uid(), v_quien);
  insert into public.annual_accounts_mapping_change (account_id, company_id, model, statement, account_prefix, action, from_line, to_line, reason, changed_by, changed_by_name)
  values (v_acc, p_company, p_model, p_statement, p_prefix, case when p_line is null then 'deja_fuera' else 'cambia' end, v_de, p_line, p_motivo, auth.uid(), v_quien);
  return jsonb_build_object('cuenta', p_prefix, 'de', v_de, 'a', p_line, 'quien', v_quien);
end $$;
revoke all on function public.conta_mapeo_cambiar(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.conta_mapeo_cambiar(uuid, text, text, text, text, text, text) to authenticated;

create or replace function public.conta_mapeo_volver_al_estandar(p_company uuid, p_model text, p_statement text, p_prefix text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_n int; v_quien text := public.conta_nombre_actor();
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta cambia qué cuentas alimentan cada línea.' using errcode = '42501';
  end if;
  with b as (
    delete from public.annual_accounts_mapping
     where company_id = p_company and model = p_model and statement = p_statement and (p_prefix is null or account_prefix = p_prefix)
    returning account_prefix, line_code)
  insert into public.annual_accounts_mapping_change (account_id, company_id, model, statement, account_prefix, action, from_line, to_line, changed_by, changed_by_name)
  select v_acc, p_company, p_model, p_statement, account_prefix, 'estandar', line_code, null, auth.uid(), v_quien from b;
  get diagnostics v_n = row_count;
  return jsonb_build_object('vueltas', v_n, 'quien', v_quien);
end $$;
revoke all on function public.conta_mapeo_volver_al_estandar(uuid, text, text, text) from public, anon;
grant execute on function public.conta_mapeo_volver_al_estandar(uuid, text, text, text) to authenticated;

-- ── 10 · Cierre: enlazar, cerrar, reabrir (regla 7) ─────────────────────────
-- Los tres asientos los propone la pantalla con journal_entry_proponer (el
-- núcleo los calcula: src/modules/conta/lib/cierre.ts) y se validan como
-- cualquier otro. Aquí solo se enlazan y se cierra o reabre con rastro.
create or replace function public.conta_cierre_enlazar(p_fiscal_year uuid, p_regularizacion uuid, p_cierre uuid, p_apertura uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_y public.fiscal_year; v_quien text := public.conta_nombre_actor();
begin
  select * into v_y from public.fiscal_year where id = p_fiscal_year;
  if v_y.id is null then raise exception 'Ese ejercicio no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_y.account_id) then raise exception 'Solo un administrador o un encargado prepara el cierre.' using errcode = '42501'; end if;
  if v_y.status <> 'open' then raise exception 'El ejercicio % ya está cerrado.', v_y.code using errcode = '23514'; end if;
  if v_y.origin = 'migrated' then raise exception 'El ejercicio % es traído: se enseña tal cual, no se recalcula su cierre.', v_y.code using errcode = '23514'; end if;
  if exists (select 1 from public.journal_entry e where e.id in (p_regularizacion, p_cierre) and (e.company_id <> v_y.company_id or e.fiscal_year_id <> v_y.id or e.source_type <> 'closing')) then
    raise exception 'La regularización y el cierre son asientos de cierre de ese ejercicio.' using errcode = '23514';
  end if;
  if p_apertura is not null and exists (select 1 from public.journal_entry e where e.id = p_apertura and (e.company_id <> v_y.company_id or e.source_type <> 'opening')) then
    raise exception 'La apertura es un asiento de apertura de la misma empresa.' using errcode = '23514';
  end if;
  insert into public.fiscal_year_closing (fiscal_year_id, account_id, company_id, status, regularization_entry_id, closing_entry_id, opening_entry_id, prepared_at, prepared_by_name)
  values (v_y.id, v_y.account_id, v_y.company_id, 'preparado', p_regularizacion, p_cierre, p_apertura, now(), v_quien)
  on conflict (fiscal_year_id) do update set status = 'preparado', regularization_entry_id = excluded.regularization_entry_id,
    closing_entry_id = excluded.closing_entry_id, opening_entry_id = excluded.opening_entry_id, prepared_at = now(), prepared_by_name = v_quien, updated_at = now();
  return jsonb_build_object('ejercicio', v_y.code, 'estado', 'preparado', 'quien', v_quien);
end $$;
revoke all on function public.conta_cierre_enlazar(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.conta_cierre_enlazar(uuid, uuid, uuid, uuid) to authenticated;

create or replace function public.conta_cierre_cerrar(p_fiscal_year uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_y public.fiscal_year; v_c public.fiscal_year_closing; v_quien text := public.conta_nombre_actor(); v_falta text;
begin
  select * into v_y from public.fiscal_year where id = p_fiscal_year for update;
  if v_y.id is null then raise exception 'Ese ejercicio no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_y.account_id) then raise exception 'Solo un administrador cierra un ejercicio.' using errcode = '42501'; end if;
  select * into v_c from public.fiscal_year_closing where fiscal_year_id = p_fiscal_year for update;
  if v_c.fiscal_year_id is null then raise exception 'Primero hay que preparar el cierre (regularización, cierre y apertura).' using errcode = '23514'; end if;
  select string_agg(q, ', ') into v_falta from (
    select 'regularización' q where not exists (select 1 from public.journal_entry where id = v_c.regularization_entry_id and status = 'validado')
    union all select 'cierre' where not exists (select 1 from public.journal_entry where id = v_c.closing_entry_id and status = 'validado')
    union all select 'apertura' where not exists (select 1 from public.journal_entry where id = v_c.opening_entry_id and status = 'validado')) x;
  if v_falta is not null then raise exception 'Faltan por validar: %.', v_falta using errcode = '23514'; end if;
  if exists (select 1 from public.journal_entry where fiscal_year_id = p_fiscal_year and status in ('propuesto', 'borrador')) then
    raise exception 'Quedan asientos propuestos o en borrador en el ejercicio %: valídalos o descártalos antes de cerrar.', v_y.code using errcode = '23514';
  end if;
  update public.fiscal_year set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_fiscal_year;
  update public.fiscal_year_closing set status = 'cerrado', closed_at = now(), closed_by = auth.uid(), closed_by_name = v_quien, updated_at = now() where fiscal_year_id = p_fiscal_year;
  return jsonb_build_object('ejercicio', v_y.code, 'estado', 'cerrado', 'quien', v_quien);
end $$;
revoke all on function public.conta_cierre_cerrar(uuid) from public, anon;
grant execute on function public.conta_cierre_cerrar(uuid) to authenticated;

-- Reabrir: deshace apertura y cierre (contraasientos, con motivo) y deja rastro.
-- La regularización se queda: si cambia algo, se rehace al volver a cerrar.
create or replace function public.conta_cierre_reabrir(p_fiscal_year uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_y public.fiscal_year; v_c public.fiscal_year_closing; v_quien text := public.conta_nombre_actor(); v_anulados jsonb := '[]';
begin
  if p_motivo is null or length(trim(p_motivo)) = 0 then raise exception 'Para reabrir un ejercicio hay que decir por qué.' using errcode = '23514'; end if;
  select * into v_y from public.fiscal_year where id = p_fiscal_year for update;
  if v_y.id is null then raise exception 'Ese ejercicio no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_y.account_id) then raise exception 'Solo un administrador reabre un ejercicio.' using errcode = '42501'; end if;
  if v_y.origin = 'migrated' then raise exception 'El ejercicio % es traído: no se reabre en Folvy.', v_y.code using errcode = '23514'; end if;
  select * into v_c from public.fiscal_year_closing where fiscal_year_id = p_fiscal_year for update;
  if v_c.fiscal_year_id is null or v_c.status <> 'cerrado' then raise exception 'El ejercicio % no está cerrado por Folvy.', v_y.code using errcode = '23514'; end if;
  -- El ejercicio vuelve a abrirse primero: el contraasiento del cierre va en él.
  update public.fiscal_year set status = 'open', closed_at = null, closed_by = null where id = p_fiscal_year;
  if v_c.opening_entry_id is not null and exists (select 1 from public.journal_entry where id = v_c.opening_entry_id and status = 'validado') then
    v_anulados := v_anulados || jsonb_build_array(public.journal_entry_anular(v_c.opening_entry_id, 'Reapertura del ejercicio ' || v_y.code || ': ' || trim(p_motivo), null, v_quien));
  end if;
  if v_c.closing_entry_id is not null and exists (select 1 from public.journal_entry where id = v_c.closing_entry_id and status = 'validado') then
    v_anulados := v_anulados || jsonb_build_array(public.journal_entry_anular(v_c.closing_entry_id, 'Reapertura del ejercicio ' || v_y.code || ': ' || trim(p_motivo), v_y.ends_on, v_quien));
  end if;
  update public.fiscal_year_closing set status = 'abierto', closing_entry_id = null, opening_entry_id = null, closed_at = null, closed_by = null, closed_by_name = null,
         reopenings = reopenings || jsonb_build_array(jsonb_build_object('fecha', now(), 'quien', v_quien, 'motivo', trim(p_motivo), 'anulados', v_anulados)),
         updated_at = now()
   where fiscal_year_id = p_fiscal_year;
  return jsonb_build_object('ejercicio', v_y.code, 'estado', 'abierto', 'anulados', v_anulados, 'quien', v_quien);
end $$;
revoke all on function public.conta_cierre_reabrir(uuid, text) from public, anon;
grant execute on function public.conta_cierre_reabrir(uuid, text) to authenticated;
