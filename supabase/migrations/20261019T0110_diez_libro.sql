-- C04b · T2 · Traer de Diez, enviar a Diez y comparar: el modelo (12/10).
--
-- Todo es NUEVO (tablas y columnas que admiten nulos) salvo dos índices en
-- journal_entry, una tabla pequeña y fuera del camino del pedido. Ningún dato
-- cambia.
--
-- Lo que pide el encargo y las respuestas 1 y 2:
--   · import_run — cada lectura de Diez (histórico, al día, documentos,
--     sumas y saldos), con lo que trajo y lo que falló.
--   · journal_entry: la referencia externa entera — programa, EJERCICIO, serie
--     y número de origen — y su huella. ÚNICA por empresa (respuesta 1): traer
--     dos veces el mismo asiento choca en la base, no en la buena voluntad.
--   · journal_line: contrapartida y justificante de Diez (98,6 % de las líneas
--     traen contrapartida; T1 §2).
--   · external_send — lo que Folvy envía a Diez: asiento (serie FOLVY u 8) o
--     factura (series 1 y 2), con la clave que devuelve Diez y como mucho 3
--     intentos (regla 5). Una factura se busca antes en Diez por serie,
--     NumeroFactura y NIF; si ya está, se ENLAZA y no se envía (respuesta 2).
--   · external_entry_snapshot — cómo estaba cada asiento en Diez cuando se
--     leyó: lo que se compara día a día.
--   · external_compare_day — la comparación por DÍA (Diez no usa analítica:
--     regla 6, T1 §2).
--   · external_document — los documentos de las facturas: del zip del libro
--     de requerimientos de Diez, o de la API cuando funcione. Lo que no casa
--     queda «revisar», sin adivinar; lo traído sin documento queda
--     «pendiente_diez» y se reintenta cada noche (respuesta 2, punto 3).
--   · external_balance_witness — el testigo de sumas y saldos, independiente
--     de la lectura (respuesta 2, punto 2): los listados de Diez exportados a
--     Excel por Julio a 31/12/2023, 2024, 2025 y 30/09/2026.
--
-- Lectura: los miembros de la cuenta (como el libro). Escritura: solo el
-- servidor (service_role, funciones security definer de la tarea 3). RGPD: los
-- datos de terceros que traiga Diez se tratan como datos de la empresa (RLS),
-- y las credenciales están en Vault (20261019T0100).

-- 1. Las lecturas -----------------------------------------------------------------
create table if not exists public.import_run (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  account_connector_id uuid references public.account_connector(id) on delete set null,
  program text not null check (program in ('diez')),
  kind text not null check (kind in ('historico', 'al_dia', 'documentos', 'sumas_saldos')),
  period_from date,
  period_to date,
  status text not null default 'en_curso' check (status in ('en_curso', 'hecho', 'fallido')),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid,
  created_by_name text,
  check (period_to is null or period_from is null or period_to >= period_from),
  check ((status = 'en_curso') = (finished_at is null))
);
create index if not exists import_run_company_idx on public.import_run (company_id, started_at desc);
comment on table public.import_run is 'Cada lectura de un programa externo (Diez): qué trajo y qué falló.';

-- 2. La referencia externa en el libro ----------------------------------------------
alter table public.journal_entry add column if not exists external_year text;
alter table public.journal_entry add column if not exists external_hash text;
alter table public.journal_entry add column if not exists import_run_id uuid references public.import_run(id) on delete set null;
-- Única por empresa, programa, ejercicio, serie y número de origen (respuesta 1).
create unique index if not exists journal_entry_external_uq
  on public.journal_entry (company_id, external_program, external_year, external_series, external_number)
  where external_program is not null;
comment on column public.journal_entry.external_year is 'Ejercicio del asiento en el programa de origen (Diez: texto, «2025»).';
comment on column public.journal_entry.external_hash is 'Huella de cómo era el asiento en el origen al traerlo: si cambia allí, se ve.';

alter table public.journal_line add column if not exists external_counterpart text;
alter table public.journal_line add column if not exists external_voucher text;
comment on column public.journal_line.external_counterpart is 'Contrapartida tal como venía de Diez.';
comment on column public.journal_line.external_voucher is 'Justificante tal como venía de Diez.';

-- 3. Lo que se envía ----------------------------------------------------------------
create table if not exists public.external_send (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  account_connector_id uuid references public.account_connector(id) on delete set null,
  entry_id uuid not null references public.journal_entry(id) on delete cascade,
  kind text not null check (kind in ('asiento', 'factura')),
  ext_year text,
  ext_series text,
  ext_number integer,
  ext_invoice_number text,
  ext_tax_id text,
  payload_hash text not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'enviado', 'enlazado', 'rechazado')),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('enviado', 'enlazado') or (ext_year is not null and ext_series is not null and ext_number is not null)),
  check (kind <> 'factura' or ext_invoice_number is not null or status in ('pendiente', 'rechazado'))
);
-- Un asiento de Folvy se envía una vez (lo rechazado no cuenta).
create unique index if not exists external_send_entry_uq on public.external_send (entry_id) where status <> 'rechazado';
-- Y una clave de Diez es de un solo asiento de Folvy.
create unique index if not exists external_send_ext_uq on public.external_send (company_id, ext_year, ext_series, ext_number) where ext_number is not null and status <> 'rechazado';
comment on table public.external_send is 'Lo que Folvy envía a Diez: la clave que devuelve Diez, la huella de lo enviado y como mucho 3 intentos.';

-- 4. Cómo estaba en Diez --------------------------------------------------------------
create table if not exists public.external_entry_snapshot (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  program text not null check (program in ('diez')),
  ext_year text not null,
  ext_series text not null,
  ext_number integer not null,
  entry_date date not null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  total_debit numeric(14,2) not null,
  total_credit numeric(14,2) not null,
  hash text not null,
  import_run_id uuid references public.import_run(id) on delete set null,
  read_at timestamptz not null default now(),
  unique (company_id, program, ext_year, ext_series, ext_number)
);
create index if not exists external_entry_snapshot_day_idx on public.external_entry_snapshot (company_id, entry_date);
comment on table public.external_entry_snapshot is 'Cómo estaba cada asiento en Diez cuando se leyó: lo que se compara día a día.';

-- 5. La comparación por día --------------------------------------------------------
create table if not exists public.external_compare_day (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  day date not null,
  folvy_count integer not null default 0,
  diez_count integer not null default 0,
  folvy_debit numeric(14,2) not null default 0,
  folvy_credit numeric(14,2) not null default 0,
  diez_debit numeric(14,2) not null default 0,
  diez_credit numeric(14,2) not null default 0,
  status text not null check (status in ('igual', 'distinto', 'solo_folvy', 'solo_diez')),
  differences jsonb not null default '[]'::jsonb check (jsonb_typeof(differences) = 'array'),
  explanation text,
  explained_by uuid,
  explained_by_name text,
  explained_at timestamptz,
  compared_at timestamptz not null default now(),
  unique (company_id, day),
  check ((explained_at is null) = (explanation is null))
);
comment on table public.external_compare_day is 'Folvy contra Diez, día a día y al céntimo (Diez no usa analítica: por día, no por local).';

-- 6. Los documentos -----------------------------------------------------------------
create table if not exists public.external_document (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  source text not null check (source in ('diez_api', 'diez_zip')),
  ext_year text,
  invoice_kind text check (invoice_kind in ('expedida', 'recibida')),
  ext_series text,
  invoice_number text,
  invoice_date date,
  tax_id text,
  file_name text,
  storage_path text,
  sha256 text,
  size_bytes integer check (size_bytes is null or size_bytes >= 0),
  entry_id uuid references public.journal_entry(id) on delete set null,
  status text not null check (status in ('enlazado', 'revisar', 'pendiente_diez')),
  reason text,
  attempts smallint not null default 0,
  last_try_at timestamptz,
  import_run_id uuid references public.import_run(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Enlazado = tiene su fichero y su asiento; pendiente de Diez = tiene el
  -- asiento y aún no el fichero; revisar = tiene el fichero y no casa, y dice por qué.
  check (status <> 'enlazado' or (entry_id is not null and storage_path is not null and sha256 is not null)),
  check (status <> 'pendiente_diez' or (entry_id is not null and storage_path is null)),
  check (status <> 'revisar' or (storage_path is not null and reason is not null))
);
-- El mismo fichero no entra dos veces en la misma empresa.
create unique index if not exists external_document_sha_uq on public.external_document (company_id, sha256) where sha256 is not null;
-- Un asiento tiene un documento vivo como mucho.
create unique index if not exists external_document_entry_uq on public.external_document (entry_id) where entry_id is not null and status in ('enlazado', 'pendiente_diez');
comment on table public.external_document is 'Documentos de las facturas traídas de Diez (zip del libro de requerimientos o API). Lo que no casa: revisar, sin adivinar.';

-- 7. El testigo de sumas y saldos -----------------------------------------------------
create table if not exists public.external_balance_witness (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  source text not null check (source in ('diez_api', 'diez_excel')),
  as_of date not null,
  account_code text not null,
  account_name text,
  debit numeric(14,2) not null,
  credit numeric(14,2) not null,
  balance numeric(14,2) not null,
  file_name text,
  import_run_id uuid references public.import_run(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, source, as_of, account_code),
  check (balance = debit - credit)
);
comment on table public.external_balance_witness is 'Sumas y saldos de Diez a una fecha, cuenta a cuenta, independientes de la lectura: el testigo de la regla 1.';

-- 8. RLS: leen los de la cuenta; escribe el servidor --------------------------------
alter table public.import_run enable row level security;
alter table public.external_send enable row level security;
alter table public.external_entry_snapshot enable row level security;
alter table public.external_compare_day enable row level security;
alter table public.external_document enable row level security;
alter table public.external_balance_witness enable row level security;

create policy import_run_read on public.import_run for select using (account_id = any (public.current_user_account_ids()));
create policy external_send_read on public.external_send for select using (account_id = any (public.current_user_account_ids()));
create policy external_entry_snapshot_read on public.external_entry_snapshot for select using (account_id = any (public.current_user_account_ids()));
create policy external_compare_day_read on public.external_compare_day for select using (account_id = any (public.current_user_account_ids()));
create policy external_document_read on public.external_document for select using (account_id = any (public.current_user_account_ids()));
create policy external_balance_witness_read on public.external_balance_witness for select using (account_id = any (public.current_user_account_ids()));

revoke insert, update, delete, truncate on public.import_run, public.external_send, public.external_entry_snapshot,
  public.external_compare_day, public.external_document, public.external_balance_witness from anon, authenticated;
grant select on public.import_run, public.external_send, public.external_entry_snapshot,
  public.external_compare_day, public.external_document, public.external_balance_witness to authenticated;
