-- ============================================================================
-- B01 · 1 · BANCOS Y CONCILIACIÓN: LAS TABLAS
-- ----------------------------------------------------------------------------
-- Encargo B01 (13/10/2026), tarea 3. Todo NUEVO: siete tablas y una columna
-- que admite nulos en treasury_account. Ningún dato cambia; nada del camino
-- del pedido se toca.
--
--   bank_settings      por empresa: la serie de tesorería (3 por defecto, como
--                      el C04; Foodint 4, respuesta 1 P3), «validar solo lo
--                      seguro» (apagado) y la fecha de corte (P4).
--   bank_statement     un extracto importado de UNA cuenta: fuente, fichero y
--                      su huella, periodo, saldos, cuadre y continuidad con el
--                      anterior («deberá coincidir con el Saldo final de la
--                      anterior información», cuaderno 43, registro 11).
--   bank_movement      un movimiento del banco. Huella única por cuenta: el
--                      mismo extracto dos veces no cambia nada. RGPD: lleva
--                      datos de terceros; vive solo en producción.
--   bank_match         lo casado: un movimiento con un asiento (suyo o ya
--                      existente). Uno vivo por movimiento: nada se casa dos
--                      veces. Deshacer no borra: deja el casado «deshecho».
--   bank_match_item    a qué facturas o liquidaciones y por cuánto (pago
--                      entero, en partes, varias en un pago).
--   bank_rule (+ _log) las reglas en palabras; ninguna sin su registro.
--   bank_activity_log  «Lo que ha hecho Folvy»: cada cosa hecha sola, con su
--                      porqué y su deshacer.
--   recurring_contract préstamo o alquiler con cuota conocida.
--   treasury_account.iban_review  «Revisa esta cuenta: el IBAN no es de tu
--                      empresa» con la corrección propuesta (P1). Nunca se
--                      corrige solo.
--
-- Lectura: los de la cuenta (belongs_to_account). Escritura: solo las
-- funciones de 20261101T0110 (security definer, administrador o encargado).
-- Vuelta atrás: supabase/vuelta-atras/20261101T0100_b01_bancos.down.sql
-- Prueba: supabase/staging/sql/20261101_b01_bancos_prueba.sql
-- ============================================================================

-- ── Ajustes por empresa ────────────────────────────────────────────────────
create table if not exists public.bank_settings (
  company_id       uuid primary key references public.company(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  treasury_series  smallint not null default 3 check (treasury_series in (3, 4)),
  validate_safe    boolean not null default false,
  cutover_date     date,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_by_name  text
);
comment on table public.bank_settings is
  'B01. Por empresa: serie de tesorería de los asientos del banco (3 como el C04; Foodint 4, como Diez desde 04/2025), «validar solo lo seguro» (apagado por defecto) y la fecha de corte: antes de ella un extracto solo enlaza con lo que ya está en el libro y no crea asientos.';

-- ── La cuenta del banco que hay que revisar (P1) ───────────────────────────
alter table public.treasury_account add column if not exists iban_review jsonb;
comment on column public.treasury_account.iban_review is
  'B01 (P1). {iban_propuesto, motivo, extracto_id, fecha} cuando un extracto de esta cuenta trae otro IBAN: la pantalla dice «Revisa esta cuenta: el IBAN no es de tu empresa» con la corrección propuesta. Nunca se corrige solo.';

-- ── Extractos ──────────────────────────────────────────────────────────────
create table if not exists public.bank_statement (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  treasury_account_id uuid not null references public.treasury_account(id) on delete restrict,
  source             text not null check (source in ('fichero', 'correo') or source ~ '^agregador:[a-z0-9-]+$'),
  format             text not null,
  file_name          text,
  file_sha256        text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  period_from        date not null,
  period_to          date not null,
  opening_balance    numeric(14,2),
  closing_balance    numeric(14,2),
  movements_count    integer not null check (movements_count >= 0),
  new_count          integer not null check (new_count >= 0),
  repeated_count     integer not null check (repeated_count >= 0),
  possible_repeated_count integer not null default 0 check (possible_repeated_count >= 0),
  -- true: cuadra. null: no se pudo comprobar (Excel sin saldos; unchecked_reason dice por qué). Nunca false: lo que no cuadra no entra.
  balanced           boolean,
  unchecked_reason   text,
  continuity         text not null check (continuity in ('primero', 'sigue', 'hueco', 'sin_saldo')),
  continuity_gap     numeric(14,2),
  imported_at        timestamptz not null default now(),
  imported_by        uuid,
  imported_by_name   text,
  constraint bank_statement_periodo check (period_from <= period_to),
  constraint bank_statement_cuadra check (balanced is distinct from false),
  constraint bank_statement_saldos check ((opening_balance is null) = (closing_balance is null)),
  constraint bank_statement_sin_saldo check ((opening_balance is null) = (continuity = 'sin_saldo') and (opening_balance is null) = (balanced is null)
                                            and (balanced is null) = (unchecked_reason is not null)),
  constraint bank_statement_hueco check ((continuity = 'hueco') = (continuity_gap is not null))
);
create unique index if not exists bank_statement_fichero_uno on public.bank_statement (treasury_account_id, file_sha256) where file_sha256 is not null;
create index if not exists bank_statement_cuenta_fechas on public.bank_statement (treasury_account_id, period_to);
comment on table public.bank_statement is
  'B01. Un extracto importado de una cuenta. Solo entra si cuadra (saldo inicial + movimientos = saldo final, y en Norma 43 el registro 33); el mismo fichero dos veces para la misma cuenta no entra. continuity: primero / sigue (empieza donde acabó el anterior) / hueco (no: continuity_gap dice cuánto) / sin_saldo (Excel sin saldos: unchecked_reason dice por qué no se comprobó).';

-- ── Movimientos ────────────────────────────────────────────────────────────
create table if not exists public.bank_movement (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  treasury_account_id uuid not null references public.treasury_account(id) on delete restrict,
  statement_id       uuid not null references public.bank_statement(id) on delete restrict,
  op_date            date not null,
  value_date         date not null,
  amount             numeric(14,2) not null,
  bank_concept       text not null default '',
  clean_concept      text not null default '',
  common_code        text check (common_code is null or common_code ~ '^\d{2}$'),
  own_code           text,
  document_no        text,
  reference_1        text,
  reference_2        text,
  fx                 jsonb,
  fingerprint        text not null,
  soft_fingerprint   text not null,
  before_cutover     boolean not null default false,
  status             text not null default 'pendiente'
                     check (status in ('pendiente', 'propuesto', 'por_aclarar', 'casado', 'posible_repetido', 'antes_corte_sin_pareja', 'ignorado')),
  confidence         text check (confidence is null or confidence in ('seguro', 'probable', 'duda')),
  reason             text,
  proposal           jsonb,
  ignored_reason     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint bank_movement_huella unique (treasury_account_id, fingerprint),
  constraint bank_movement_propuesta_con_porque check (status not in ('propuesto', 'por_aclarar') or (reason is not null and length(trim(reason)) > 0)),
  constraint bank_movement_ignorado_con_porque check ((status = 'ignorado') = (ignored_reason is not null))
);
create index if not exists bank_movement_cuenta_fecha on public.bank_movement (treasury_account_id, op_date);
create index if not exists bank_movement_suave on public.bank_movement (treasury_account_id, soft_fingerprint);
create index if not exists bank_movement_empresa_estado on public.bank_movement (company_id, status);
comment on table public.bank_movement is
  'B01. Un movimiento del banco. Huella única por cuenta (fecha, importe, referencias y orden en el día). posible_repetido: misma fecha, importe y orden que uno traído por otro camino; lo decide la persona. antes_corte_sin_pareja: anterior a la fecha de corte y sin pareja en el libro traído, solo informativo (P4). RGPD: datos de terceros, solo en producción.';

-- ── Lo casado ──────────────────────────────────────────────────────────────
create table if not exists public.bank_match (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  movement_id        uuid not null references public.bank_movement(id) on delete restrict,
  kind               text not null check (kind in ('asiento', 'factura_recibida', 'factura_emitida', 'liquidacion', 'traspaso',
                                                   'anticipo', 'contrato', 'cuenta')),
  journal_entry_id   uuid references public.journal_entry(id) on delete set null,
  entry_created      boolean not null,
  amount             numeric(14,2) not null,
  confidence         text not null check (confidence in ('seguro', 'probable', 'duda')),
  reason             text not null check (length(trim(reason)) > 0),
  by_who             text not null check (by_who in ('folvy', 'persona')),
  rule_id            uuid,
  status             text not null default 'vivo' check (status in ('vivo', 'deshecho')),
  created_at         timestamptz not null default now(),
  created_by         uuid,
  created_by_name    text,
  undone_at          timestamptz,
  undone_by          uuid,
  undone_by_name     text,
  undo_reason        text,
  constraint bank_match_deshecho_completo check ((status = 'deshecho') = (undone_at is not null and undo_reason is not null))
);
-- Nada se casa dos veces: un casado vivo por movimiento.
create unique index if not exists bank_match_uno_vivo on public.bank_match (movement_id) where status = 'vivo';
create index if not exists bank_match_asiento on public.bank_match (journal_entry_id) where status = 'vivo';
comment on table public.bank_match is
  'B01. Lo casado: un movimiento con un asiento (entry_created: el asiento lo creó el banco; si no, se enlazó uno que ya existía, P2). Un vivo por movimiento. Deshacer deja «deshecho» con quién, cuándo y por qué; su asiento propuesto se quita y el validado se anula.';

create table if not exists public.bank_match_item (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  match_id            uuid not null references public.bank_match(id) on delete cascade,
  supplier_invoice_id uuid references public.supplier_invoice(id) on delete restrict,
  channel_settlement_id uuid references public.channel_settlement(id) on delete restrict,
  other_movement_id   uuid references public.bank_movement(id) on delete restrict,
  party_id            uuid references public.party(id) on delete set null,
  amount              numeric(14,2) not null,
  constraint bank_match_item_uno check (num_nonnulls(supplier_invoice_id, channel_settlement_id, other_movement_id, party_id) >= 1)
);
create index if not exists bank_match_item_factura on public.bank_match_item (supplier_invoice_id) where supplier_invoice_id is not null;
create index if not exists bank_match_item_liquidacion on public.bank_match_item (channel_settlement_id) where channel_settlement_id is not null;
create index if not exists bank_match_item_otro on public.bank_match_item (other_movement_id) where other_movement_id is not null;
comment on table public.bank_match_item is
  'B01. A qué y por cuánto: una o varias facturas recibidas (pago entero, en partes, varias en un pago), una liquidación, el otro movimiento de un traspaso, o el tercero.';

-- ── Reglas ─────────────────────────────────────────────────────────────────
create table if not exists public.bank_rule (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  words              text not null check (length(trim(words)) > 0),
  condition          jsonb not null,
  target             jsonb not null,
  origin             text not null check (origin in ('persona', 'folvy')),
  status             text not null check (status in ('propuesta', 'activa', 'apagada', 'rechazada')),
  confirmations      integer not null default 0 check (confirmations >= 0),
  last_used_at       timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  created_by_name    text,
  updated_at         timestamptz not null default now(),
  constraint bank_rule_condicion check (jsonb_typeof(condition) = 'object' and condition ? 'contiene'),
  constraint bank_rule_destino check (jsonb_typeof(target) = 'object' and target ? 'cuenta')
);
create index if not exists bank_rule_empresa on public.bank_rule (company_id, status);
comment on table public.bank_rule is
  'B01. Una regla en palabras («Cuando el concepto tenga "PLENITUDE" → Luz y agua · 62800000»). condition: {contiene, signo?, importe?}; target: {cuenta, tercero_id?}. Las que propone Folvy nacen «propuesta» («Regla nueva, ¿la guardo?»); ninguna cambia sin su registro (bank_rule_log).';

create table if not exists public.bank_rule_log (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  rule_id            uuid not null references public.bank_rule(id) on delete cascade,
  action             text not null check (action in ('creada', 'propuesta', 'aceptada', 'rechazada', 'apagada', 'encendida', 'cambiada', 'usada')),
  before             jsonb,
  after              jsonb,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  created_by_name    text
);
create index if not exists bank_rule_log_regla on public.bank_rule_log (rule_id, created_at);

-- ── «Lo que ha hecho Folvy» ────────────────────────────────────────────────
create table if not exists public.bank_activity_log (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  movement_id        uuid references public.bank_movement(id) on delete set null,
  match_id           uuid references public.bank_match(id) on delete set null,
  statement_id       uuid references public.bank_statement(id) on delete set null,
  action             text not null check (action in ('importado', 'casado', 'enlazado', 'propuesto', 'por_aclarar', 'validado', 'deshecho', 'ignorado', 'regla')),
  by_who             text not null check (by_who in ('folvy', 'persona')),
  summary            text not null check (length(trim(summary)) > 0),
  detail             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  created_by_name    text
);
create index if not exists bank_activity_log_empresa on public.bank_activity_log (company_id, created_at desc);
comment on table public.bank_activity_log is
  'B01. «Lo que ha hecho Folvy» (y la persona): cada importación, casado, propuesta, validación y deshacer, con su frase. Solo crece.';

-- ── Contratos con cuota ────────────────────────────────────────────────────
create table if not exists public.recurring_contract (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  kind               text not null check (kind in ('prestamo', 'alquiler', 'otro')),
  name               text not null check (length(trim(name)) > 0),
  party_id           uuid references public.party(id) on delete set null,
  concept_contains   text not null check (length(trim(concept_contains)) > 0),
  amount             numeric(14,2) not null check (amount > 0),
  -- Préstamo: el cuadro de amortización [{fecha, cuota, capital, intereses}]; sin él, la cuota no se parte sola.
  schedule           jsonb,
  capital_account    text,
  interest_account   text,
  expense_account    text,
  confirmations      integer not null default 0 check (confirmations >= 0),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  created_by_name    text,
  constraint recurring_contract_cuentas check (
    (kind = 'prestamo' and capital_account is not null and interest_account is not null)
    or (kind <> 'prestamo' and expense_account is not null)),
  constraint recurring_contract_cuadro check (schedule is null or jsonb_typeof(schedule) = 'array')
);
comment on table public.recurring_contract is
  'B01. Préstamo o alquiler con cuota conocida. Su cuota se casa sola (seguro) cuando se ha confirmado 3 veces; el préstamo se parte en capital (170/520) e intereses (662) con su cuadro.';

-- ── Lectura: los de la cuenta ──────────────────────────────────────────────
alter table public.bank_settings enable row level security;
drop policy if exists bank_settings_select on public.bank_settings;
create policy bank_settings_select on public.bank_settings for select using ((select public.belongs_to_account(account_id)));
alter table public.bank_statement enable row level security;
drop policy if exists bank_statement_select on public.bank_statement;
create policy bank_statement_select on public.bank_statement for select using ((select public.belongs_to_account(account_id)));
alter table public.bank_movement enable row level security;
drop policy if exists bank_movement_select on public.bank_movement;
create policy bank_movement_select on public.bank_movement for select using ((select public.belongs_to_account(account_id)));
alter table public.bank_match enable row level security;
drop policy if exists bank_match_select on public.bank_match;
create policy bank_match_select on public.bank_match for select using ((select public.belongs_to_account(account_id)));
alter table public.bank_match_item enable row level security;
drop policy if exists bank_match_item_select on public.bank_match_item;
create policy bank_match_item_select on public.bank_match_item for select using ((select public.belongs_to_account(account_id)));
alter table public.bank_rule enable row level security;
drop policy if exists bank_rule_select on public.bank_rule;
create policy bank_rule_select on public.bank_rule for select using ((select public.belongs_to_account(account_id)));
alter table public.bank_rule_log enable row level security;
drop policy if exists bank_rule_log_select on public.bank_rule_log;
create policy bank_rule_log_select on public.bank_rule_log for select using ((select public.belongs_to_account(account_id)));
alter table public.bank_activity_log enable row level security;
drop policy if exists bank_activity_log_select on public.bank_activity_log;
create policy bank_activity_log_select on public.bank_activity_log for select using ((select public.belongs_to_account(account_id)));
alter table public.recurring_contract enable row level security;
drop policy if exists recurring_contract_select on public.recurring_contract;
create policy recurring_contract_select on public.recurring_contract for select using ((select public.belongs_to_account(account_id)));
