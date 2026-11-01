-- supabase/migrations/20261101T1937_n1_laboral_modelo.sql
--
-- N1 · PR 1 · Los datos de la ficha de Laboral (Julio, 01/11/2026). Modelo
-- del paso 0 (docs/laboral/n1/paso0.md §5), con las decisiones del 01/11:
--
--   · El permiso de Laboral (respuesta 1): el administrador lo da a personas
--     concretas (gestoría, RRHH). Con él se ve el salario, el IRPF, el IBAN,
--     los conceptos, el 145, el DNI y el nacimiento. El administrador lo tiene
--     siempre; el encargado nunca por ser encargado.
--     (manager_permissions.show_salaries se queda como está; se retira en otra
--     tanda, en dos pasos.)
--   · El contrato con su historia: lab_contrato y, lo que cambia sin ser otro
--     contrato, lab_contrato_condicion con fecha de efecto. Nada se pisa.
--   · El convenio, sus tablas y los conceptos; los de cada persona con su
--     origen, convenio o pactado (respuesta 2).
--   · El 145, una fila por comunicación.
--   · Los documentos: la tabla de hoy, ampliada (respuesta 4).
--   · El historial de cambios, con fecha de efecto, quién y por qué.
--   · Cada centro de Cegid con su local, confirmado por el administrador
--     (respuesta 3).
--
-- SOLO AÑADE: tablas nuevas, columnas nuevas que admiten nulos en documents
-- (con CHECK que solo mira esas columnas) y funciones nuevas. Nada en el
-- camino del pedido. Ninguna columna nueva en employees (regla de la 0731).
--
-- Nadie escribe directo en las tablas lab_*: solo lectura con RLS
-- (current_user_ve_laboral), y escriben las funciones de servidor del volcado
-- (20261101T1938) y, en el PR 2, las de la ficha.
--
-- Vuelta atrás: supabase/vuelta-atras/20261101T1937_n1_laboral_modelo.down.sql

-- ── 1 · El permiso de Laboral ───────────────────────────────────────────────
create table if not exists public.lab_permiso (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  dado_por    uuid,
  dado_at     timestamptz not null default now(),
  primary key (account_id, user_id)
);
comment on table public.lab_permiso is 'N1 (01/11/2026). Quién tiene el permiso de Laboral en cada cuenta, además del administrador (que lo tiene siempre). Con él se ve el salario, el IRPF, el IBAN, los conceptos, el 145, el DNI y el nacimiento. Se da y se quita con lab_dar_permiso / lab_quitar_permiso.';
alter table public.lab_permiso enable row level security;
revoke all on public.lab_permiso from anon, authenticated;
grant select on public.lab_permiso to authenticated;
drop policy if exists lab_permiso_read on public.lab_permiso;
create policy lab_permiso_read on public.lab_permiso for select to authenticated
  using (public.current_user_is_admin_of(account_id) or user_id = auth.uid());

-- ¿Ve quien llama los datos de Laboral de esta cuenta? El administrador (de la
-- cuenta abierta, desde el DM1) o quien tiene el permiso, siendo miembro activo
-- de esa cuenta y con ella abierta. Ser encargado no cuenta.
create or replace function public.current_user_ve_laboral(p_account_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_is_admin_of(p_account_id)
      or exists (
        select 1
          from public.lab_permiso p
          join public.user_profiles up on up.user_id = p.user_id and up.account_id = p.account_id and up.active
         where p.account_id = p_account_id
           and p.user_id = auth.uid()
           and p.account_id = public._cuenta_activa());
$$;
revoke all on function public.current_user_ve_laboral(uuid) from public, anon;
grant execute on function public.current_user_ve_laboral(uuid) to authenticated;

create or replace function public.lab_dar_permiso(p_account_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin_of(p_account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'El permiso de Laboral lo da el administrador de la cuenta.';
  end if;
  if not exists (select 1 from public.user_profiles where user_id = p_user_id and account_id = p_account_id and active) then
    raise exception 'NO_ES_DE_LA_CUENTA' using errcode = '22023', hint = 'Solo se da a alguien que entra en esta cuenta.';
  end if;
  insert into public.lab_permiso (account_id, user_id, dado_por) values (p_account_id, p_user_id, auth.uid())
  on conflict (account_id, user_id) do nothing;
  return jsonb_build_object('con_permiso', (select count(*) from public.lab_permiso where account_id = p_account_id));
end $$;
revoke all on function public.lab_dar_permiso(uuid, uuid) from public, anon;
grant execute on function public.lab_dar_permiso(uuid, uuid) to authenticated;

create or replace function public.lab_quitar_permiso(p_account_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin_of(p_account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'El permiso de Laboral lo quita el administrador de la cuenta.';
  end if;
  delete from public.lab_permiso where account_id = p_account_id and user_id = p_user_id;
  return jsonb_build_object('con_permiso', (select count(*) from public.lab_permiso where account_id = p_account_id));
end $$;
revoke all on function public.lab_quitar_permiso(uuid, uuid) from public, anon;
grant execute on function public.lab_quitar_permiso(uuid, uuid) to authenticated;

-- ── 2 · La persona: lo privado de Laboral (fuera de employees) ──────────────
create table if not exists public.lab_persona (
  employee_id      uuid primary key references public.employees(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  codigo_cegid     text,
  naf              text,
  iban             text,
  nacionalidad     text,
  sexo             text,
  nivel_formativo  text,
  domicilio        text,
  cp               text,
  poblacion        text,
  provincia        text,
  discapacidad     text,
  -- La comparación de la respuesta 2: el bruto de la última nómina de Cegid y
  -- el de los conceptos (convenio + pactado) del mes. La ficha enseña las dos
  -- cifras y la diferencia si no cuadran.
  bruto_cegid_mes        numeric,
  bruto_cegid_periodo    text,
  bruto_conceptos_mes    numeric,
  irpf_cegid_pct         numeric,
  lote_id          uuid references public.lab_import_lote(id) on delete set null,
  fila_n           integer,
  updated_at       timestamptz not null default now()
);
comment on table public.lab_persona is 'N1 (01/11/2026). Lo privado de Laboral de cada persona (NAF, IBAN, domicilio…), fuera de employees. Solo lo ve quien tiene el permiso de Laboral (current_user_ve_laboral).';

-- ── 3 · El convenio, sus tablas y los conceptos ─────────────────────────────
create table if not exists public.lab_convenio (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  codigo          text not null,
  nombre          text,
  codigo_oficial  text,
  horas_anuales   numeric,
  horas_dia       numeric,
  vacaciones      text,
  paga_13         text,
  paga_14         text,
  datos           jsonb not null default '{}',
  lote_id         uuid references public.lab_import_lote(id) on delete set null,
  updated_at      timestamptz not null default now(),
  unique (account_id, codigo)
);

create table if not exists public.lab_convenio_tabla (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  convenio_codigo   text not null,
  categoria         text not null,
  categoria_nombre  text,
  concepto_codigo   text not null,
  concepto_nombre   text,
  importe           numeric,
  modo_pago         text,
  lote_id           uuid references public.lab_import_lote(id) on delete set null,
  unique (account_id, convenio_codigo, categoria, concepto_codigo)
);

create table if not exists public.lab_concepto (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  codigo      text not null,
  nombre      text,
  tipo        text,
  codigo_red  text,
  lote_id     uuid references public.lab_import_lote(id) on delete set null,
  unique (account_id, codigo)
);

-- ── 4 · El contrato y su historia ───────────────────────────────────────────
create table if not exists public.lab_contrato (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts(id) on delete cascade,
  employee_id           uuid not null references public.employees(id) on delete cascade,
  numero                text not null,
  clave                 text,
  descripcion           text,
  fecha_alta            date,
  fecha_fin_prevista    date,
  fecha_baja            date,
  motivo_baja           text,
  periodo_prueba_dias   integer,
  antiguedad_reconocida date,
  origen                text not null default 'sumied' check (origen in ('cegid', 'sumied')),
  lote_id               uuid references public.lab_import_lote(id) on delete set null,
  fila_n                integer,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (account_id, employee_id, numero)
);
comment on table public.lab_contrato is 'N1 (01/11/2026). Un contrato laboral, que no se pisa: lo que cambia sin ser otro contrato va en lab_contrato_condicion, con su fecha de efecto.';

create table if not exists public.lab_contrato_condicion (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  contrato_id        uuid not null references public.lab_contrato(id) on delete cascade,
  vigente_desde      date not null,
  vigente_hasta      date,
  grupo_cotizacion   text,
  grupo_desc         text,
  cno                text,
  categoria          text,
  puesto             text,
  convenio_codigo    text,
  location_id        uuid references public.locations(id) on delete set null,
  centro_cegid       text,
  cuenta_cotizacion  text,
  jornada            text check (jornada in ('completa', 'parcial')),
  coef_parcial       numeric,
  horas_semana       numeric,
  bonificaciones     jsonb not null default '[]',
  motivo             text,
  lote_id            uuid references public.lab_import_lote(id) on delete set null,
  fila_n             integer,
  unique (contrato_id, vigente_desde)
);

-- ── 5 · Lo que cobra cada persona, con su origen ────────────────────────────
create table if not exists public.lab_persona_concepto (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  employee_id      uuid not null references public.employees(id) on delete cascade,
  contrato_id      uuid references public.lab_contrato(id) on delete set null,
  concepto_codigo  text not null,
  concepto_nombre  text,
  importe          numeric not null,
  periodicidad     text not null default 'mes' check (periodicidad in ('mes', 'paga')),
  origen           text not null check (origen in ('convenio', 'pactado')),
  vigente_desde    date not null,
  vigente_hasta    date,
  lote_id          uuid references public.lab_import_lote(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists lab_persona_concepto_persona on public.lab_persona_concepto (employee_id, vigente_desde);

-- ── 6 · El 145 ──────────────────────────────────────────────────────────────
create table if not exists public.lab_modelo_145 (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id) on delete cascade,
  employee_id            uuid not null references public.employees(id) on delete cascade,
  efecto_desde           date not null,
  situacion_familiar     smallint check (situacion_familiar in (1, 2, 3)),
  nif_conyuge            text,
  discapacidad           text,
  movilidad_geografica   boolean,
  hijos                  jsonb not null default '[]',
  ascendientes           jsonb not null default '[]',
  pension_compensatoria  numeric,
  anualidades_alimentos  numeric,
  prestamo_vivienda      boolean,
  tipo_voluntario_pct    numeric,
  document_id            uuid references public.documents(id) on delete set null,
  firmado_at             timestamptz,
  created_at             timestamptz not null default now()
);

-- ── 7 · El historial de cambios ─────────────────────────────────────────────
create table if not exists public.lab_cambio (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  employee_id   uuid references public.employees(id) on delete cascade,
  tabla         text not null,
  registro_id   uuid,
  campo         text,
  antes         jsonb,
  despues       jsonb,
  fecha_efecto  date,
  motivo        text,
  quien         uuid,
  cuando        timestamptz not null default now()
);
create index if not exists lab_cambio_persona on public.lab_cambio (employee_id, cuando desc);

-- ── 8 · Cada centro de Cegid, con su local (respuesta 3) ────────────────────
create table if not exists public.lab_centro_local (
  account_id      uuid not null references public.accounts(id) on delete cascade,
  centro          text not null,
  location_id     uuid not null references public.locations(id) on delete cascade,
  confirmado_por  uuid,
  confirmado_at   timestamptz not null default now(),
  primary key (account_id, centro)
);

-- ── 9 · RLS: solo lectura, y solo con el permiso de Laboral ────────────────
alter table public.lab_persona enable row level security;
revoke all on public.lab_persona from anon, authenticated;
grant select on public.lab_persona to authenticated;
drop policy if exists lab_persona_read on public.lab_persona;
create policy lab_persona_read on public.lab_persona for select to authenticated using (public.current_user_ve_laboral(account_id));

alter table public.lab_convenio enable row level security;
revoke all on public.lab_convenio from anon, authenticated;
grant select on public.lab_convenio to authenticated;
drop policy if exists lab_convenio_read on public.lab_convenio;
create policy lab_convenio_read on public.lab_convenio for select to authenticated using (public.current_user_ve_laboral(account_id));

alter table public.lab_convenio_tabla enable row level security;
revoke all on public.lab_convenio_tabla from anon, authenticated;
grant select on public.lab_convenio_tabla to authenticated;
drop policy if exists lab_convenio_tabla_read on public.lab_convenio_tabla;
create policy lab_convenio_tabla_read on public.lab_convenio_tabla for select to authenticated using (public.current_user_ve_laboral(account_id));

alter table public.lab_concepto enable row level security;
revoke all on public.lab_concepto from anon, authenticated;
grant select on public.lab_concepto to authenticated;
drop policy if exists lab_concepto_read on public.lab_concepto;
create policy lab_concepto_read on public.lab_concepto for select to authenticated using (public.current_user_ve_laboral(account_id));

alter table public.lab_contrato enable row level security;
revoke all on public.lab_contrato from anon, authenticated;
grant select on public.lab_contrato to authenticated;
drop policy if exists lab_contrato_read on public.lab_contrato;
create policy lab_contrato_read on public.lab_contrato for select to authenticated using (public.current_user_ve_laboral(account_id));

alter table public.lab_contrato_condicion enable row level security;
revoke all on public.lab_contrato_condicion from anon, authenticated;
grant select on public.lab_contrato_condicion to authenticated;
drop policy if exists lab_contrato_condicion_read on public.lab_contrato_condicion;
create policy lab_contrato_condicion_read on public.lab_contrato_condicion for select to authenticated using (public.current_user_ve_laboral(account_id));

alter table public.lab_persona_concepto enable row level security;
revoke all on public.lab_persona_concepto from anon, authenticated;
grant select on public.lab_persona_concepto to authenticated;
drop policy if exists lab_persona_concepto_read on public.lab_persona_concepto;
create policy lab_persona_concepto_read on public.lab_persona_concepto for select to authenticated using (public.current_user_ve_laboral(account_id));

alter table public.lab_modelo_145 enable row level security;
revoke all on public.lab_modelo_145 from anon, authenticated;
grant select on public.lab_modelo_145 to authenticated;
drop policy if exists lab_modelo_145_read on public.lab_modelo_145;
create policy lab_modelo_145_read on public.lab_modelo_145 for select to authenticated using (public.current_user_ve_laboral(account_id));

alter table public.lab_cambio enable row level security;
revoke all on public.lab_cambio from anon, authenticated;
grant select on public.lab_cambio to authenticated;
drop policy if exists lab_cambio_read on public.lab_cambio;
create policy lab_cambio_read on public.lab_cambio for select to authenticated using (public.current_user_ve_laboral(account_id));

alter table public.lab_centro_local enable row level security;
revoke all on public.lab_centro_local from anon, authenticated;
grant select on public.lab_centro_local to authenticated;
drop policy if exists lab_centro_local_read on public.lab_centro_local;
create policy lab_centro_local_read on public.lab_centro_local for select to authenticated using (public.current_user_ve_laboral(account_id));

-- ── 10 · Los documentos, ampliados (respuesta 4) ────────────────────────────
-- Solo columnas nuevas que admiten nulos: los de hoy siguen igual. Un nulo en
-- visible_trabajador es «sí», que es lo de hoy.
alter table public.documents add column if not exists carpeta text
  check (carpeta in ('identidad', 'contrato', 'ss_sepe', 'impuestos', 'formacion', 'nominas', 'otros'));
alter table public.documents add column if not exists origen text
  check (origen in ('ella', 'sumied', 'llego_solo', 'formacion', 'empresa'));
alter table public.documents add column if not exists caduca_el date;
alter table public.documents add column if not exists visible_trabajador boolean;
alter table public.documents add column if not exists firmado_at timestamptz;
alter table public.documents add column if not exists firmado_por uuid;
alter table public.documents add column if not exists firma text;
alter table public.documents add column if not exists archivado_at timestamptz;
