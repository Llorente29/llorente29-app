-- supabase/migrations/20261117T1010_x02_salida_erp10_tablas.sql
--
-- X02 · LA BASE DE LA SALIDA A ERP10: las cuatro tablas (encargo X01·1, 17/11;
-- decisiones de Julio 1 a 5). Lo que se contabiliza en Sumied sale en ficheros
-- que el usuario importa en Cegid ERP despacho (ERP10). Aquí queda qué ha salido,
-- en qué lote, cuándo y quién lo bajó, para que nada salga dos veces.
--
-- SOLO AÑADE: cuatro tablas nuevas. No toca nada de Diez (external_send,
-- _conta_traspaso_va ni sus tablas): la salida a ERP10 tiene las suyas
-- (decisión 1). Nada en el camino del pedido. Las escriben solo las funciones
-- de 20261117T1011 (security definer); las leen los de la cuenta, como las de Diez.
--
--   1. conta_erp10_salida_empresa: el interruptor, por empresa, con el código de
--      la empresa en ERP10 y el largo de su subcuenta (decisión 3).
--   2. conta_erp10_salida_lote: cada vez que se sacan ficheros: empresa, mes,
--      quién y cuándo, y por fichero su nombre, cuántas filas y su huella.
--   3. conta_erp10_salida_partida: cada asiento que salió, en qué lote, como qué
--      (recibida, emitida o asiento), la huella de su fila y, más adelante, la
--      serie y el documento que le dio ERP10. Un asiento sale una sola vez: índice
--      único por asiento entre las partidas vivas (estado «salida»).
--   4. conta_erp10_subcuenta_salida: cada subcuenta que ya salió en un
--      subcuentas.xlsx, con su código en ERP10 (decisión 4: «nuevas» son las que
--      no están aquí).
--
-- Vuelta atrás: supabase/vuelta-atras/20261117T1010_x02_salida_erp10_tablas.down.sql

-- 1 · El interruptor -----------------------------------------------------------------------
create table if not exists public.conta_erp10_salida_empresa (
  company_id uuid primary key references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  encendida boolean not null default false,
  codigo_erp10 text not null check (codigo_erp10 ~ '^[A-Za-z0-9]{1,10}$'),
  largo_subcuenta smallint not null check (largo_subcuenta between 6 and 12),
  desde date not null,
  cambiado_por uuid,
  cambiado_por_nombre text,
  cambiado_en timestamptz not null default now()
);
comment on table public.conta_erp10_salida_empresa is
  'X02 · «Salida a ERP10», por empresa (extra temporal). Sin fila o apagada, no sale nada. Encendida, sale lo validado desde «desde». Una empresa sale a Diez o a ERP10, no a los dos. Se cambia con conta_erp10_salida_poner.';
comment on column public.conta_erp10_salida_empresa.codigo_erp10 is 'El código de la empresa en ERP10 (el <empresa> de los PDF: <empresa>_F<ejercicio>_<serie>_<documento>.PDF).';
comment on column public.conta_erp10_salida_empresa.largo_subcuenta is 'Cuántas cifras tiene la subcuenta en ERP10 (6 a 12). Las de Sumied se rellenan con ceros por el medio; la que no cabe no sale.';

-- 2 · Los lotes ----------------------------------------------------------------------------
create table if not exists public.conta_erp10_salida_lote (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  mes date not null check (mes = date_trunc('month', mes)::date),
  ficheros jsonb not null check (jsonb_typeof(ficheros) = 'array' and jsonb_array_length(ficheros) > 0),
  recibidas integer not null default 0 check (recibidas >= 0),
  emitidas integer not null default 0 check (emitidas >= 0),
  asientos integer not null default 0 check (asientos >= 0),
  cuentas_nuevas integer not null default 0 check (cuentas_nuevas >= 0),
  creado_por uuid,
  creado_por_nombre text,
  creado_en timestamptz not null default now()
);
create index if not exists conta_erp10_salida_lote_empresa_idx on public.conta_erp10_salida_lote (company_id, creado_en desc);
comment on table public.conta_erp10_salida_lote is
  'X02 · Cada salida a ERP10: de qué empresa y mes, quién la sacó y cuándo, y sus ficheros ([{nombre, filas, huella}]). Lo apunta conta_erp10_lote_apuntar.';

-- 3 · Las partidas -------------------------------------------------------------------------
create table if not exists public.conta_erp10_salida_partida (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  lote_id uuid not null references public.conta_erp10_salida_lote(id) on delete restrict,
  entry_id uuid not null references public.journal_entry(id) on delete restrict,
  clase text not null check (clase in ('recibida', 'emitida', 'asiento')),
  huella text not null check (btrim(huella) <> ''),
  estado text not null default 'salida' check (estado in ('salida', 'retirada')),
  erp10_serie text,
  erp10_documento integer check (erp10_documento is null or erp10_documento > 0),
  creado_en timestamptz not null default now()
);
-- Un asiento no sale dos veces (decisión 5: cada asiento, por un solo camino).
create unique index if not exists conta_erp10_salida_partida_viva_uq
  on public.conta_erp10_salida_partida (entry_id) where estado = 'salida';
create index if not exists conta_erp10_salida_partida_lote_idx on public.conta_erp10_salida_partida (lote_id);
create index if not exists conta_erp10_salida_partida_empresa_idx on public.conta_erp10_salida_partida (company_id);
comment on table public.conta_erp10_salida_partida is
  'X02 · Cada asiento que salió a ERP10: en qué lote, como qué (recibida, emitida o asiento) y la huella de su fila. Viva = estado «salida»; un asiento tiene como mucho una viva. La serie y el documento de ERP10 se rellenan más adelante (PR 4).';
comment on column public.conta_erp10_salida_partida.huella is 'La huella de la fila tal como salió (la calcula el navegador al hacer el fichero): si el asiento cambia, ya no coincide.';

-- 4 · Las subcuentas que ya salieron ---------------------------------------------------------
create table if not exists public.conta_erp10_subcuenta_salida (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  lote_id uuid not null references public.conta_erp10_salida_lote(id) on delete restrict,
  company_account_id uuid not null references public.company_account(id) on delete restrict,
  codigo text not null check (codigo ~ '^[0-9]{6,12}$'),
  codigo_erp10 text not null check (codigo_erp10 ~ '^[0-9]{6,12}$'),
  nombre text not null check (btrim(nombre) <> ''),
  creado_en timestamptz not null default now(),
  unique (company_id, company_account_id),
  unique (company_id, codigo_erp10)
);
comment on table public.conta_erp10_subcuenta_salida is
  'X02 · Cada subcuenta de Sumied que ya salió a ERP10 en un subcuentas.xlsx, con su código en ERP10 y el lote. Las «nuevas» de un mes son las que usan sus partidas y no están aquí.';

-- Permisos: como las de Diez. Las leen los de la cuenta; las escriben las funciones.
alter table public.conta_erp10_salida_empresa enable row level security;
alter table public.conta_erp10_salida_lote enable row level security;
alter table public.conta_erp10_salida_partida enable row level security;
alter table public.conta_erp10_subcuenta_salida enable row level security;

drop policy if exists conta_erp10_salida_empresa_leer on public.conta_erp10_salida_empresa;
create policy conta_erp10_salida_empresa_leer on public.conta_erp10_salida_empresa
  for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_erp10_salida_lote_leer on public.conta_erp10_salida_lote;
create policy conta_erp10_salida_lote_leer on public.conta_erp10_salida_lote
  for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_erp10_salida_partida_leer on public.conta_erp10_salida_partida;
create policy conta_erp10_salida_partida_leer on public.conta_erp10_salida_partida
  for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_erp10_subcuenta_salida_leer on public.conta_erp10_subcuenta_salida;
create policy conta_erp10_subcuenta_salida_leer on public.conta_erp10_subcuenta_salida
  for select to authenticated using (public.belongs_to_account(account_id));

revoke all on table public.conta_erp10_salida_empresa, public.conta_erp10_salida_lote,
  public.conta_erp10_salida_partida, public.conta_erp10_subcuenta_salida from public, anon, authenticated;
grant select on table public.conta_erp10_salida_empresa, public.conta_erp10_salida_lote,
  public.conta_erp10_salida_partida, public.conta_erp10_subcuenta_salida to authenticated;
grant all on table public.conta_erp10_salida_empresa, public.conta_erp10_salida_lote,
  public.conta_erp10_salida_partida, public.conta_erp10_subcuenta_salida to service_role;
