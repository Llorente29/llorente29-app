-- supabase/migrations/20261106T1530_g01_clientes_cuotas.sql
--
-- G01 · Tarea 3 (06/11/2026) · Asesoría QBO: conexiones con GoCardless y
-- Bitrix24, clientes, servicios, tarifas, líneas, solicitudes y lo leído.
-- SOLO AÑADE: tablas, columnas que admiten nulos, vistas y funciones nuevas.
-- Lo que cambia algo que ya existe va en la 20261106T1531.
--
-- Respuestas de Julio a las tareas 1 y 2 del G01:
--   · Fase 1 sin Laboral: cada empleado es una LÍNEA del cliente, con su
--     nombre; el hueco para el empleado de Laboral (employee_id) y para la
--     cuenta propia del cliente (cuenta_propia_account_id), vacíos (fase 2).
--   · Cada conexión con su entorno (real o pruebas). Bitrix24, a nivel de
--     cuenta; GoCardless, una por empresa emisora. El token y la dirección del
--     portal, en Vault (como Redsys): aquí solo su referencia.
--   · La forma de cobro y el cliente de GoCardless, por emisor, en
--     conta_cobro_cliente.
--   · El servicio se cobra fijo al mes, fijo al año, por empleado de alta o
--     por uso (nómina, modelo presentado o factura registrada).
--   · Trabajos sueltos: una línea de un solo mes, con su concepto e importe.
--   · El origen de cada línea: gocardless, manual, solicitud (y laboral, en
--     la fase 2). Las solicitudes, con su estado: pedida, hecha o rechazada.
--   · Para el asistente: conta_consulta_clientes, conta_consulta_lineas y
--     conta_consulta_diferencias, de solo lectura y filtradas por cuenta; cada
--     diferencia con su porqué como dato (porque_codigo y datos).
--
-- Todas las tablas son de Sumied (conta_*), con RLS: se leen con
-- belongs_to_account; se escriben solo desde el servidor (conta-bitrix-leer y
-- conta-gocardless-leer, con service_role) o, en el encargo de las pantallas,
-- con sus funciones.
-- Vuelta atrás: supabase/vuelta-atras/20261106T1530_g01_clientes_cuotas.down.sql

-- ── 1 · Las conexiones ──────────────────────────────────────────────────────
create table if not exists public.conta_cobro_gocardless (
  company_id          uuid primary key references public.company(id) on delete cascade,
  account_id          uuid not null references public.accounts(id) on delete cascade,
  entorno             text not null check (entorno in ('real', 'pruebas')),
  token_ref           uuid,
  acreedor_id         text,
  por_defecto         boolean not null default true,
  conectada_at        timestamptz,
  conectada_por_name  text,
  ultima_lectura_at   timestamptz,
  mandatos_vivos      integer,
  lineas_activas      integer,
  al_mes              numeric(14,2),
  abono               jsonb,
  abono_treasury_id   uuid references public.treasury_account(id) on delete set null,
  abono_coincide      boolean,
  abono_porque        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.conta_cobro_gocardless is
  'G01 · La cuenta de GoCardless de una empresa emisora: domiciliación SEPA. El token de solo lectura, en Vault (token_ref, «conta_gocardless:<empresa>»). por_defecto: GoCardless es la forma de cobro de sus clientes. abono: la cuenta en la que abona GoCardless (/creditor_bank_accounts), comparada con su tesorería.';

create table if not exists public.conta_crm_bitrix (
  account_id          uuid primary key references public.accounts(id) on delete cascade,
  entorno             text not null check (entorno in ('real', 'pruebas')),
  url_ref             uuid,
  portal              text,
  mapa                jsonb,
  campos_medidos      jsonb,
  conectada_at        timestamptz,
  conectada_por_name  text,
  ultima_lectura_at   timestamptz,
  empresas_leidas     integer,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.conta_crm_bitrix is
  'G01 · El Bitrix24 de una cuenta (uno para todos sus emisores). La dirección con su clave, en Vault (url_ref, «conta_bitrix:<cuenta>»); portal: solo el nombre del portal, sin clave. mapa: el de campos (UF_CRM_… → Sumied), propuesto con crm.company.fields; campos_medidos: lo que devolvió.';

-- ── 2 · El cliente de la gestoría ───────────────────────────────────────────
create table if not exists public.conta_gestoria_cliente (
  party_id                  uuid primary key references public.party(id) on delete cascade,
  account_id                uuid not null references public.accounts(id) on delete cascade,
  bitrix_id                 text,
  situacion                 text check (situacion is null or situacion in ('activo', 'baja', 'moroso', 'solo_renta')),
  servicios                 text[] not null default '{}',
  forma_pago_bitrix         text,
  emisor_segun_bitrix       uuid references public.company(id) on delete set null,
  ficha                     jsonb,
  huella                    text,
  cuenta_propia_account_id  uuid references public.accounts(id) on delete set null,
  leido_at                  timestamptz,
  created_at                timestamptz not null default now(),
  unique (account_id, bitrix_id)
);
comment on table public.conta_gestoria_cliente is
  'G01 · Un cliente de la gestoría (su party): su ficha de Bitrix24 (bitrix_id, situación, servicios C/L/S, «Forma de pago» y lo demás en ficha, solo referencia). cuenta_propia_account_id: la cuenta de Sumied del cliente, cuando tenga la suya (fase 2); hoy, vacía.';

alter table public.conta_cobro_cliente add column if not exists forma_cobro text
  check (forma_cobro is null or forma_cobro in ('gocardless', 'transferencia', 'tarjeta', 'efectivo'));
alter table public.conta_cobro_cliente add column if not exists gc_cliente_id text;
alter table public.conta_cobro_cliente add column if not exists gc_casado_por text
  check (gc_casado_por is null or gc_casado_por in ('nif', 'correo', 'persona'));
comment on column public.conta_cobro_cliente.forma_cobro is 'G01 · Cómo cobra este emisor a este cliente: gocardless (domiciliación SEPA), transferencia, tarjeta o efectivo.';
comment on column public.conta_cobro_cliente.gc_cliente_id is 'G01 · El cliente en la cuenta de GoCardless de este emisor (CU…).';
comment on column public.conta_cobro_cliente.gc_casado_por is 'G01 · Cómo se casó con Bitrix24: por NIF, por correo o lo confirmó una persona.';

-- ── 3 · Servicios, tarifas, líneas y solicitudes ────────────────────────────
create table if not exists public.conta_servicio (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  clave            text not null check (length(trim(clave)) > 0),
  nombre           text not null check (length(trim(nombre)) > 0),
  forma            text not null check (forma in ('fijo_mes', 'fijo_anio', 'por_empleado', 'por_uso')),
  unidad           text check (unidad is null or unidad in ('nomina', 'modelo', 'factura')),
  por_confirmar    boolean not null default false,
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by_name  text,
  unique (company_id, clave),
  check ((forma = 'por_uso') = (unidad is not null))
);
comment on table public.conta_servicio is
  'G01 · El catálogo de servicios de una empresa emisora. forma: fijo al mes, fijo al año, por empleado de alta o por uso (unidad: nómina, modelo presentado o factura registrada; la cantidad la dará Sumied en la fase 2). por_confirmar: importado con su nombre literal hasta que la gestoría diga qué es.';

create table if not exists public.conta_tarifa (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  servicio_id      uuid not null references public.conta_servicio(id) on delete cascade,
  party_id         uuid references public.party(id) on delete cascade,
  importe          numeric(14,2) not null check (importe >= 0),
  periodo          text not null check (periodo in ('mes', 'anio', 'unidad')),
  desde            date not null check (extract(day from desde) = 1),
  hasta            date check (hasta is null or (extract(day from hasta) = 1 and hasta >= desde)),
  motivo           text,
  origen           text not null default 'manual' check (origen in ('manual', 'gocardless')),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_name  text
);
comment on table public.conta_tarifa is
  'G01 · La tarifa de un servicio de un emisor: general (party_id vacío) o propia de un cliente, que manda sobre la general. Vale de su mes «desde» a su mes «hasta» (incluido; vacío: sigue). periodo: al mes, al año o por unidad (los servicios por uso). Cada cambio, en conta_gestoria_cambio.';
create index if not exists conta_tarifa_buscar_idx on public.conta_tarifa (company_id, servicio_id, party_id, desde);

create table if not exists public.conta_solicitud (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  party_id            uuid not null references public.party(id) on delete cascade,
  tipo                text not null check (tipo in ('alta', 'baja')),
  empleado_nombre     text not null check (length(trim(empleado_nombre)) > 0),
  mes                 date not null check (extract(day from mes) = 1),
  nota                text,
  estado              text not null default 'pedida' check (estado in ('pedida', 'hecha', 'rechazada')),
  pedida_at           timestamptz not null default now(),
  pedida_por_name     text,
  resuelta_at         timestamptz,
  resuelta_por_name   text,
  motivo_rechazo      text,
  check (estado <> 'rechazada' or length(trim(coalesce(motivo_rechazo, ''))) > 0),
  check ((estado = 'pedida') = (resuelta_at is null))
);
comment on table public.conta_solicitud is
  'G01 · La petición de alta o baja de un trabajador que hace el cliente. QBO la da por hecha (y la línea sale con origen «solicitud») o la rechaza con su motivo.';

create table if not exists public.conta_linea (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  party_id            uuid not null references public.party(id) on delete cascade,
  servicio_id         uuid not null references public.conta_servicio(id) on delete restrict,
  tipo                text not null default 'cuota' check (tipo in ('cuota', 'suelto')),
  detalle             text,
  empleado_nombre     text,
  employee_id         uuid references public.employees(id) on delete set null,
  origen              text not null check (origen in ('gocardless', 'manual', 'solicitud', 'laboral')),
  importe_propio      numeric(14,2) check (importe_propio is null or importe_propio >= 0),
  periodo             text not null default 'mes' check (periodo in ('mes', 'anio', 'unidad')),
  desde               date not null check (extract(day from desde) = 1),
  hasta               date check (hasta is null or (extract(day from hasta) = 1 and hasta >= desde)),
  suscripcion_gc_id   text,
  solicitud_id        uuid references public.conta_solicitud(id) on delete set null,
  created_at          timestamptz not null default now(),
  created_by_name     text,
  updated_at          timestamptz not null default now(),
  updated_by_name     text,
  check (tipo <> 'suelto' or (hasta = desde and importe_propio is not null and length(trim(coalesce(detalle, ''))) > 0)),
  check (origen <> 'solicitud' or solicitud_id is not null)
);
comment on table public.conta_linea is
  'G01 · Una línea del recibo de un cliente: un servicio (y su detalle: la sociedad o el empleado). Cuenta de su mes «desde» a su mes «hasta» (incluido; la baja se cobra entera el mes de la baja). Su precio: importe_propio, o la tarifa propia o general. tipo «suelto»: un trabajo fuera de la cuota, de un solo mes, con su concepto e importe. origen: gocardless (importada), manual, solicitud o laboral (fase 2, con employee_id).';
create index if not exists conta_linea_cliente_idx on public.conta_linea (party_id, company_id);
create unique index if not exists conta_linea_suscripcion_idx on public.conta_linea (company_id, suscripcion_gc_id) where suscripcion_gc_id is not null;

create table if not exists public.conta_gestoria_cambio (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  tabla       text not null check (tabla in ('conta_tarifa', 'conta_linea', 'conta_solicitud')),
  registro_id uuid not null,
  accion      text not null check (accion in ('alta', 'cambio', 'borrado')),
  desde_mes   date,
  antes       jsonb,
  despues     jsonb,
  quien       uuid,
  quien_name  text,
  cuando      timestamptz not null default now()
);
comment on table public.conta_gestoria_cambio is 'G01 · Cada cambio de una tarifa, una línea o una solicitud: quién, cuándo, desde qué mes, y cómo estaba antes y después.';
create index if not exists conta_gestoria_cambio_registro_idx on public.conta_gestoria_cambio (registro_id, cuando);

create or replace function public._conta_gestoria_apuntar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_fila jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.conta_gestoria_cambio (account_id, tabla, registro_id, accion, desde_mes, antes, despues, quien, quien_name)
  values ((v_fila->>'account_id')::uuid, tg_table_name, (v_fila->>'id')::uuid,
          case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'cambio' else 'borrado' end,
          coalesce((v_fila->>'desde')::date, (v_fila->>'mes')::date),
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end,
          auth.uid(),
          coalesce(v_fila->>'updated_by_name', v_fila->>'resuelta_por_name', v_fila->>'created_by_name', v_fila->>'pedida_por_name'));
  return null;
end $$;
revoke all on function public._conta_gestoria_apuntar() from public, anon, authenticated;

drop trigger if exists conta_tarifa_apuntar on public.conta_tarifa;
create trigger conta_tarifa_apuntar after insert or update or delete on public.conta_tarifa for each row execute function public._conta_gestoria_apuntar();
drop trigger if exists conta_linea_apuntar on public.conta_linea;
create trigger conta_linea_apuntar after insert or update or delete on public.conta_linea for each row execute function public._conta_gestoria_apuntar();
drop trigger if exists conta_solicitud_apuntar on public.conta_solicitud;
create trigger conta_solicitud_apuntar after insert or update or delete on public.conta_solicitud for each row execute function public._conta_gestoria_apuntar();

-- ── 4 · Lo leído de GoCardless ──────────────────────────────────────────────
create table if not exists public.conta_gc_cliente (
  company_id             uuid not null references public.company(id) on delete cascade,
  gc_id                  text not null,
  account_id             uuid not null references public.accounts(id) on delete cascade,
  nombre                 text,
  correo                 text,
  nif                    text,
  party_id               uuid references public.party(id) on delete set null,
  casado_por             text check (casado_por is null or casado_por in ('nif', 'correo', 'persona')),
  mandatos_vivos         integer not null default 0,
  suscripciones_activas  integer not null default 0,
  huella                 text,
  leido_at               timestamptz not null default now(),
  primary key (company_id, gc_id)
);
comment on table public.conta_gc_cliente is 'G01 · Un cliente de la cuenta de GoCardless de un emisor, como se leyó, y con qué cliente de la gestoría casa (y cómo).';

create table if not exists public.conta_gc_suscripcion (
  company_id     uuid not null references public.company(id) on delete cascade,
  gc_id          text not null,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  gc_cliente_id  text,
  mandato_gc_id  text,
  nombre         text,
  importe        numeric(14,2),
  moneda         text,
  intervalo      text,
  cada           integer,
  estado         text,
  al_mes         numeric(14,2),
  inicio         date,
  fin            date,
  leido_at       timestamptz not null default now(),
  primary key (company_id, gc_id)
);
create table if not exists public.conta_gc_mandato (
  company_id     uuid not null references public.company(id) on delete cascade,
  gc_id          text not null,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  gc_cliente_id  text,
  estado         text,
  referencia     text,
  esquema        text,
  creado         timestamptz,
  leido_at       timestamptz not null default now(),
  primary key (company_id, gc_id)
);
comment on table public.conta_gc_mandato is 'G01 · Cada mandato de la cuenta de GoCardless de un emisor, como se leyó: su estado en GoCardless (active, pending_customer_approval…). El de un cliente casado va además a conta_mandato, con origen gocardless.';

-- El mandato de GoCardless, también en conta_mandato (el de Sumied): de dónde
-- viene, su id y su estado allí. La 1531 hace que el enlace de firma y su
-- caducidad solo sean obligatorios en los firmados en Sumied.
alter table public.conta_mandato add column if not exists origen text not null default 'sumied' check (origen in ('sumied', 'gocardless'));
alter table public.conta_mandato add column if not exists gc_mandato_id text;
alter table public.conta_mandato add column if not exists gc_estado text;
comment on column public.conta_mandato.origen is 'G01 · De dónde viene: sumied (lo firma el cliente en Sumied) o gocardless (leído de su cuenta de GoCardless).';
comment on column public.conta_mandato.gc_mandato_id is 'G01 · El mandato en GoCardless (MD…).';
comment on column public.conta_mandato.gc_estado is 'G01 · Su estado en GoCardless, tal cual (active, pending_customer_approval, cancelled…).';
create unique index if not exists conta_mandato_gocardless_idx on public.conta_mandato (company_id, gc_mandato_id) where gc_mandato_id is not null;

comment on table public.conta_gc_suscripcion is 'G01 · Lo que cobra hoy GoCardless (cada «suscripción», como se leyó): para comparar con lo que sale de las tarifas. al_mes: lo anual entre 12.';

create table if not exists public.conta_gc_cobro (
  company_id         uuid not null references public.company(id) on delete cascade,
  gc_id              text not null,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  mandato_gc_id      text,
  suscripcion_gc_id  text,
  estado             text,
  fecha              date,
  importe            numeric(14,2),
  moneda             text,
  motivo             text,
  leido_at           timestamptz not null default now(),
  primary key (company_id, gc_id)
);
comment on table public.conta_gc_cobro is 'G01 · Los cobros de GoCardless de los últimos 6 meses, como se leyeron: estado, fecha, importe y, si falló, por qué.';
create index if not exists conta_gc_cobro_mandato_idx on public.conta_gc_cobro (company_id, mandato_gc_id, fecha);

create table if not exists public.conta_gc_importacion (
  company_id         uuid not null references public.company(id) on delete cascade,
  suscripcion_gc_id  text not null,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  gc_cliente_id      text,
  party_id           uuid references public.party(id) on delete set null,
  nombre             text,
  importe            numeric(14,2),
  resultado          text not null check (resultado in ('linea', 'no_convertida')),
  linea_id           uuid references public.conta_linea(id) on delete set null,
  porque_codigo      text,
  porque             text,
  importada_at       timestamptz not null default now(),
  primary key (company_id, suscripcion_gc_id)
);
comment on table public.conta_gc_importacion is 'G01 · La importación, una sola vez, de cada suscripción de GoCardless: la línea en que se convirtió o por qué no se convirtió (porque_codigo y su frase).';

-- ── 5 · Cada lectura y sus diferencias ──────────────────────────────────────
create table if not exists public.conta_gestoria_lectura (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid references public.company(id) on delete cascade,
  origen           text not null check (origen in ('bitrix', 'gocardless')),
  entorno          text not null check (entorno in ('real', 'pruebas')),
  por              text not null check (por in ('persona', 'cada_noche', 'conexion')),
  quien_name       text,
  empezada_at      timestamptz not null default now(),
  acabada_at       timestamptz,
  estado           text not null default 'en_marcha' check (estado in ('en_marcha', 'bien', 'mal', 'no_lee')),
  nuevos           integer,
  cambiados        integer,
  iguales          integer,
  con_diferencias  integer,
  mensaje          text
);
comment on table public.conta_gestoria_lectura is 'G01 · Cada lectura de Bitrix24 o de una cuenta de GoCardless: quién o qué la lanzó, cómo acabó y cuántos clientes salen nuevos, cambiados, iguales y con diferencias.';
create index if not exists conta_gestoria_lectura_cuenta_idx on public.conta_gestoria_lectura (account_id, empezada_at desc);

create table if not exists public.conta_gestoria_diferencia (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  lectura_id     uuid not null references public.conta_gestoria_lectura(id) on delete cascade,
  company_id     uuid references public.company(id) on delete cascade,
  party_id       uuid references public.party(id) on delete set null,
  bitrix_id      text,
  gc_cliente_id  text,
  tipo           text not null check (tipo in (
                   'bitrix_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_bitrix',
                   'correo_repetido_en_bitrix', 'nif_distinto', 'suscripcion_sin_convertir', 'totales_distintos',
                   'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta')),
  porque_codigo  text not null,
  porque         text not null,
  datos          jsonb not null default '{}'::jsonb,
  vigente        boolean not null default true,
  created_at     timestamptz not null default now()
);
comment on table public.conta_gestoria_diferencia is 'G01 · Lo que no cuadra en una lectura (regla 7: se enseña, no se esconde). El porqué, como dato (tipo, porque_codigo y datos) y en palabras (porque). vigente: de la última lectura; las de antes se quedan como historia.';
create index if not exists conta_gestoria_diferencia_vigente_idx on public.conta_gestoria_diferencia (account_id, tipo) where vigente;

-- ── 6 · RLS: se lee con la cuenta; se escribe desde el servidor ─────────────
do $$
declare t text;
begin
  foreach t in array array['conta_cobro_gocardless', 'conta_crm_bitrix', 'conta_gestoria_cliente', 'conta_servicio', 'conta_tarifa',
                           'conta_solicitud', 'conta_linea', 'conta_gestoria_cambio', 'conta_gc_cliente', 'conta_gc_suscripcion',
                           'conta_gc_cobro', 'conta_gc_mandato', 'conta_gc_importacion', 'conta_gestoria_lectura', 'conta_gestoria_diferencia'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.belongs_to_account(account_id))', t || '_leer', t);
    if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
      execute format('grant select on table public.%I to conta_lectura', t);
    end if;
  end loop;
end $$;

-- ── 7 · Las conexiones, en Vault (solo el servidor) ─────────────────────────
-- Se pegan una vez y no se vuelven a enseñar: ninguna función devuelve el
-- token o la dirección a la pantalla. Las *_secreto son solo para service_role.
create or replace function public.conta_gocardless_guardar_conexion(p_company uuid, p_entorno text, p_token text, p_quien text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_ref uuid; v_nombre text := 'conta_gocardless:' || p_company::text;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if p_entorno not in ('real', 'pruebas') then raise exception 'Entorno: real o pruebas.' using errcode = '22023'; end if;
  if coalesce(trim(p_token), '') = '' then raise exception 'Falta el token de GoCardless.' using errcode = '22023'; end if;
  select token_ref into v_ref from public.conta_cobro_gocardless where company_id = p_company for update;
  if v_ref is null or not exists (select 1 from vault.secrets where id = v_ref) then
    select id into v_ref from vault.secrets where name = v_nombre;
  end if;
  if v_ref is not null then
    perform vault.update_secret(v_ref, trim(p_token), v_nombre, 'Token de solo lectura de GoCardless de una empresa de Sumied');
  else
    v_ref := vault.create_secret(trim(p_token), v_nombre, 'Token de solo lectura de GoCardless de una empresa de Sumied');
  end if;
  insert into public.conta_cobro_gocardless (company_id, account_id, entorno, token_ref, conectada_at, conectada_por_name, updated_at)
  values (p_company, v_cuenta, p_entorno, v_ref, now(), p_quien, now())
  on conflict (company_id) do update set entorno = excluded.entorno, token_ref = excluded.token_ref,
    conectada_at = excluded.conectada_at, conectada_por_name = excluded.conectada_por_name, updated_at = now();
end $$;

create or replace function public.conta_gocardless_secreto(p_company uuid)
returns table (account_id uuid, entorno text, token text)
language sql stable security definer set search_path = public as $$
  select g.account_id, g.entorno, s.decrypted_secret
    from public.conta_cobro_gocardless g join vault.decrypted_secrets s on s.id = g.token_ref
   where g.company_id = p_company
$$;

create or replace function public.conta_bitrix_guardar_conexion(p_account uuid, p_entorno text, p_url text, p_portal text, p_quien text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ref uuid; v_nombre text := 'conta_bitrix:' || p_account::text;
begin
  if not exists (select 1 from public.accounts where id = p_account) then raise exception 'La cuenta no existe.' using errcode = 'P0002'; end if;
  if p_entorno not in ('real', 'pruebas') then raise exception 'Entorno: real o pruebas.' using errcode = '22023'; end if;
  if coalesce(trim(p_url), '') !~ '^https://[A-Za-z0-9.-]+/rest/[0-9]+/[A-Za-z0-9]+/?$' then
    raise exception 'La dirección de Bitrix24 es como https://<tu portal>/rest/<número>/<clave>/ (Bitrix24 › Aplicaciones › Webhooks › Webhook entrante).' using errcode = '22023';
  end if;
  select url_ref into v_ref from public.conta_crm_bitrix where account_id = p_account for update;
  if v_ref is null or not exists (select 1 from vault.secrets where id = v_ref) then
    select id into v_ref from vault.secrets where name = v_nombre;
  end if;
  if v_ref is not null then
    perform vault.update_secret(v_ref, trim(p_url), v_nombre, 'Dirección de lectura de Bitrix24 de una cuenta de Sumied');
  else
    v_ref := vault.create_secret(trim(p_url), v_nombre, 'Dirección de lectura de Bitrix24 de una cuenta de Sumied');
  end if;
  insert into public.conta_crm_bitrix (account_id, entorno, url_ref, portal, conectada_at, conectada_por_name, updated_at)
  values (p_account, p_entorno, v_ref, p_portal, now(), p_quien, now())
  on conflict (account_id) do update set entorno = excluded.entorno, url_ref = excluded.url_ref, portal = excluded.portal,
    conectada_at = excluded.conectada_at, conectada_por_name = excluded.conectada_por_name, updated_at = now();
end $$;

create or replace function public.conta_bitrix_secreto(p_account uuid)
returns table (entorno text, url text, mapa jsonb)
language sql stable security definer set search_path = public as $$
  select b.entorno, s.decrypted_secret, b.mapa
    from public.conta_crm_bitrix b join vault.decrypted_secrets s on s.id = b.url_ref
   where b.account_id = p_account
$$;

revoke all on function public.conta_gocardless_guardar_conexion(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.conta_gocardless_secreto(uuid) from public, anon, authenticated;
revoke all on function public.conta_bitrix_guardar_conexion(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.conta_bitrix_secreto(uuid) from public, anon, authenticated;
grant execute on function public.conta_gocardless_guardar_conexion(uuid, text, text, text) to service_role;
grant execute on function public.conta_gocardless_secreto(uuid) to service_role;
grant execute on function public.conta_bitrix_guardar_conexion(uuid, text, text, text, text) to service_role;
grant execute on function public.conta_bitrix_secreto(uuid) to service_role;

-- ── 8 · Las fichas de Bitrix24 → clientes (solo el servidor) ────────────────
-- Cada ficha: su party (nombre y NIF), su ficha fiscal (razón social y
-- dirección) y su conta_gestoria_cliente. Un cliente nuevo nace con origen
-- «crm». Dice cuántos salen nuevos, cambiados e iguales (por su huella).
create or replace function public.conta_bitrix_guardar_fichas(p_account uuid, p_fichas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f jsonb; v_party uuid; v_huella text; v_antes text; v_nif text; v_nuevos int := 0; v_cambiados int := 0; v_iguales int := 0;
begin
  if not exists (select 1 from public.accounts where id = p_account) then raise exception 'La cuenta no existe.' using errcode = 'P0002'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_fichas, '[]'::jsonb)) loop
    if coalesce(f->>'bitrixId', '') = '' then continue; end if;
    v_huella := md5(f::text);
    v_nif := nullif(public.party_nif(nullif(f->>'nif', '')), '');
    select c.party_id, c.huella into v_party, v_antes from public.conta_gestoria_cliente c where c.account_id = p_account and c.bitrix_id = f->>'bitrixId';
    if v_party is null then
      insert into public.party (account_id, name, tax_id, source, created_by_name)
      values (p_account, coalesce(nullif(trim(f->>'nombre'), ''), 'Empresa ' || (f->>'bitrixId') || ' de Bitrix24'), v_nif, 'crm', 'Bitrix24')
      returning id into v_party;
      v_nuevos := v_nuevos + 1;
    elsif v_antes is distinct from v_huella then
      update public.party set name = coalesce(nullif(trim(f->>'nombre'), ''), name), tax_id = coalesce(v_nif, tax_id), updated_at = now()
       where id = v_party and account_id = p_account;
      v_cambiados := v_cambiados + 1;
    else
      v_iguales := v_iguales + 1;
      update public.conta_gestoria_cliente set leido_at = now() where party_id = v_party;
      continue;
    end if;
    insert into public.customer_fiscal (party_id, account_id, legal_name, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province)
    values (v_party, p_account, nullif(trim(f->>'nombre'), ''), nullif(f->>'calle', ''), nullif(f->>'cp', ''), nullif(f->>'poblacion', ''), nullif(f->>'provincia', ''))
    on conflict (party_id) do update set legal_name = coalesce(excluded.legal_name, customer_fiscal.legal_name),
      fiscal_street = excluded.fiscal_street, fiscal_postal_code = excluded.fiscal_postal_code, fiscal_city = excluded.fiscal_city,
      fiscal_province = excluded.fiscal_province, updated_at = now();
    insert into public.conta_gestoria_cliente (party_id, account_id, bitrix_id, situacion, servicios, forma_pago_bitrix, emisor_segun_bitrix, ficha, huella, leido_at)
    values (v_party, p_account, f->>'bitrixId', nullif(f->>'situacion', ''),
            coalesce(array(select jsonb_array_elements_text(f->'servicios')), '{}'), nullif(f->>'formaPago', ''),
            (select id from public.company where id::text = f->>'emisorSegunBitrix' and account_id = p_account),
            f, v_huella, now())
    on conflict (party_id) do update set situacion = excluded.situacion, servicios = excluded.servicios, forma_pago_bitrix = excluded.forma_pago_bitrix,
      emisor_segun_bitrix = excluded.emisor_segun_bitrix, ficha = excluded.ficha, huella = excluded.huella, leido_at = now();
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'cambiados', v_cambiados, 'iguales', v_iguales);
end $$;
revoke all on function public.conta_bitrix_guardar_fichas(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conta_bitrix_guardar_fichas(uuid, jsonb) to service_role;

-- ── 9 · Lo que vale una línea un mes (la tarifa propia manda) ───────────────
-- El mismo cálculo que conta-gocardless-leer/comparacion.ts: importe propio;
-- si no, la tarifa propia del cliente que valga ese mes (la de «desde» más
-- reciente); si no, la general. Lo anual, al mes entre 12. Lo de por uso
-- (periodo «unidad») no tiene importe fijo: null hasta la fase 2.
create or replace function public.conta_linea_al_mes(p_linea uuid, p_mes date)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare l public.conta_linea; t public.conta_tarifa; v_mes date := date_trunc('month', p_mes)::date;
begin
  select * into l from public.conta_linea where id = p_linea;
  if l.id is null then return null; end if;
  -- Una persona con sesión solo ve las líneas de sus cuentas; el servidor y la base, todas.
  if auth.uid() is not null and not public.belongs_to_account(l.account_id) then return null; end if;
  -- Fuera de sus meses, la línea no cuenta.
  if l.desde > v_mes or (l.hasta is not null and l.hasta < v_mes) then return 0; end if;
  if l.importe_propio is not null then
    return case l.periodo when 'anio' then round(l.importe_propio / 12, 2) when 'unidad' then null else l.importe_propio end;
  end if;
  select * into t from public.conta_tarifa x
   where x.company_id = l.company_id and x.servicio_id = l.servicio_id and x.party_id = l.party_id
     and x.desde <= v_mes and (x.hasta is null or x.hasta >= v_mes)
   order by x.desde desc limit 1;
  if t.id is null then
    select * into t from public.conta_tarifa x
     where x.company_id = l.company_id and x.servicio_id = l.servicio_id and x.party_id is null
       and x.desde <= v_mes and (x.hasta is null or x.hasta >= v_mes)
     order by x.desde desc limit 1;
  end if;
  if t.id is null then return null; end if;   -- sin tarifa: no se inventa un precio
  return case t.periodo when 'anio' then round(t.importe / 12, 2) when 'unidad' then null else t.importe end;
end $$;
revoke all on function public.conta_linea_al_mes(uuid, date) from public, anon;
grant execute on function public.conta_linea_al_mes(uuid, date) to authenticated, service_role;

-- ── 10 · Las vistas de consulta del asistente (solo lectura, por cuenta) ────
-- security_invoker: cada vista lee con los permisos de quien pregunta, así que
-- solo enseña las filas de sus cuentas (la RLS de cada tabla).
create or replace view public.conta_consulta_clientes with (security_invoker = true) as
select
  c.account_id                                         as cuenta_id,
  c.party_id                                           as cliente_id,
  p.name                                               as cliente,
  p.tax_id                                             as nif,
  c.situacion,
  c.servicios,
  c.forma_pago_bitrix                                  as forma_de_pago_en_bitrix,
  e.id                                                 as emisor_id,
  coalesce(e.trade_name, e.legal_name)                 as emisor,
  cc.forma_cobro                                       as forma_de_cobro,
  cc.gc_cliente_id                                     as cliente_en_gocardless,
  (select m.estado from public.conta_gc_mandato m where m.company_id = e.id and m.gc_cliente_id = cc.gc_cliente_id
    order by m.creado desc nulls last limit 1)         as mandato,
  (select count(*) from public.conta_linea l where l.party_id = c.party_id and l.company_id = e.id and l.tipo = 'cuota'
     and l.desde <= date_trunc('month', current_date)::date and (l.hasta is null or l.hasta >= date_trunc('month', current_date)::date)) as lineas_de_alta,
  (select sum(public.conta_linea_al_mes(l.id, date_trunc('month', current_date)::date)) from public.conta_linea l
    where l.party_id = c.party_id and l.company_id = e.id)  as al_mes_en_sumied,
  (select sum(s.al_mes) from public.conta_gc_suscripcion s join public.conta_gc_cliente g on g.company_id = s.company_id and g.gc_id = s.gc_cliente_id
    where g.party_id = c.party_id and s.company_id = e.id and s.estado = 'active') as al_mes_en_gocardless,
  (select max(b.fecha) from public.conta_gc_cobro b join public.conta_gc_mandato m on m.company_id = b.company_id and m.gc_id = b.mandato_gc_id
    where m.gc_cliente_id = cc.gc_cliente_id and b.company_id = e.id) as ultimo_cobro,
  (select count(*) from public.conta_gestoria_diferencia d where d.party_id = c.party_id and d.vigente) as diferencias,
  c.cuenta_propia_account_id                           as cuenta_propia_id,
  c.leido_at                                           as leido_de_bitrix
from public.conta_gestoria_cliente c
join public.party p on p.id = c.party_id
left join public.company e on e.account_id = c.account_id
left join public.conta_cobro_cliente cc on cc.party_id = c.party_id and cc.company_id = e.id;
comment on view public.conta_consulta_clientes is 'G01 · Para el asistente (solo lectura): cada cliente de la gestoría con cada emisor de la cuenta, su forma de cobro, su mandato, lo que suma al mes en Sumied y en GoCardless, su último cobro y sus diferencias.';

create or replace view public.conta_consulta_lineas with (security_invoker = true) as
select
  l.account_id                     as cuenta_id,
  l.id                             as linea_id,
  l.party_id                       as cliente_id,
  p.name                           as cliente,
  coalesce(e.trade_name, e.legal_name) as emisor,
  s.nombre                         as servicio,
  s.forma                          as se_cobra,
  l.tipo,
  l.detalle,
  l.empleado_nombre                as empleado,
  l.origen,
  l.desde,
  l.hasta,
  l.importe_propio,
  public.conta_linea_al_mes(l.id, date_trunc('month', current_date)::date) as al_mes_este_mes
from public.conta_linea l
join public.party p on p.id = l.party_id
join public.company e on e.id = l.company_id
join public.conta_servicio s on s.id = l.servicio_id;
comment on view public.conta_consulta_lineas is 'G01 · Para el asistente (solo lectura): cada línea de cada cliente, con su servicio, emisor, empleado, origen, meses y lo que vale este mes.';

create or replace view public.conta_consulta_diferencias with (security_invoker = true) as
select
  d.account_id     as cuenta_id,
  d.id             as diferencia_id,
  d.tipo,
  d.porque_codigo,
  d.porque,
  d.datos,
  d.party_id       as cliente_id,
  p.name           as cliente,
  coalesce(e.trade_name, e.legal_name) as emisor,
  d.bitrix_id      as ficha_en_bitrix,
  d.gc_cliente_id  as cliente_en_gocardless,
  l.empezada_at    as leida_el
from public.conta_gestoria_diferencia d
join public.conta_gestoria_lectura l on l.id = d.lectura_id
left join public.party p on p.id = d.party_id
left join public.company e on e.id = d.company_id
where d.vigente;
comment on view public.conta_consulta_diferencias is 'G01 · Para el asistente (solo lectura): lo que no cuadra en la última lectura, con su porqué como dato (tipo, porque_codigo, datos) y en palabras.';

revoke all on table public.conta_consulta_clientes, public.conta_consulta_lineas, public.conta_consulta_diferencias from public, anon, authenticated;
grant select on table public.conta_consulta_clientes, public.conta_consulta_lineas, public.conta_consulta_diferencias to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.conta_consulta_clientes, public.conta_consulta_lineas, public.conta_consulta_diferencias to conta_lectura;
  end if;
end $$;

-- ── 11 · La lectura de cada noche ───────────────────────────────────────────
-- De madrugada (a las 4 de Madrid): primero Bitrix24 de cada cuenta, que al
-- acabar lanza la de sus cuentas de GoCardless; las cuentas de GoCardless de
-- una cuenta sin Bitrix24, directamente.
create or replace function public.conta_gestoria_despertar()
returns void language plpgsql security definer set search_path = public as $$
declare v_secreto text; r record;
begin
  if extract(hour from (now() at time zone 'Europe/Madrid')) <> 4 then return; end if;
  if not exists (select 1 from public.conta_crm_bitrix) and not exists (select 1 from public.conta_cobro_gocardless) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar la lectura de la gestoría.' using errcode = '55000';
  end if;
  for r in select account_id from public.conta_crm_bitrix where url_ref is not null loop
    perform net.http_post(url := public._project_url() || '/functions/v1/conta-bitrix-leer',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
      body := jsonb_build_object('accion', 'leer', 'cuenta', r.account_id, 'por', 'cada_noche'), timeout_milliseconds := 150000);
  end loop;
  for r in select g.company_id from public.conta_cobro_gocardless g
            where g.token_ref is not null and not exists (select 1 from public.conta_crm_bitrix b where b.account_id = g.account_id and b.url_ref is not null) loop
    perform net.http_post(url := public._project_url() || '/functions/v1/conta-gocardless-leer',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
      body := jsonb_build_object('accion', 'leer', 'empresa', r.company_id, 'por', 'cada_noche'), timeout_milliseconds := 150000);
  end loop;
end $$;
revoke all on function public.conta_gestoria_despertar() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'conta-gestoria-leer') then
      perform cron.unschedule('conta-gestoria-leer');
    end if;
    perform cron.schedule('conta-gestoria-leer', '17 * * * *', $cron$select public.conta_gestoria_despertar()$cron$);
  end if;
end $$;
