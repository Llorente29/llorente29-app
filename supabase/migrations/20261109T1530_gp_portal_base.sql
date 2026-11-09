-- supabase/migrations/20261109T1530_gp_portal_base.sql
-- cambia: public.conta_solicitud · prueba: supabase/staging/sql/20261109_gp_portal_base_prueba.sql
--
-- GP · Tarea 2 · EL PORTAL DEL CLIENTE DE LA GESTORÍA, la base (Code 3; Julio,
-- nº 2 y nº 3 del 09/11). SOLO AÑADE:
--   · tablas nuevas conta_portal_* (el acceso de cada persona a su cliente, los
--     mensajes, lo que pide la gestoría, la firma con código, las incidencias,
--     lo subido, lo que se pide al banco, los avisos por correo y los ajustes);
--   · cinco columnas que admiten nulos en conta_solicitud (G01: el alta que pide
--     el cliente), con dos CHECK y una clave ajena que solo miran esas columnas
--     nuevas (la tabla, declarada arriba: 0 filas en producción el 09/11; las
--     tres restricciones toman su cierre un instante y no hay filas que revisar);
--   · funciones nuevas: una lectura por pantalla del portal (la regla del
--     segundo), lo que hace el cliente, lo que hace la gestoría y lo que solo
--     hace el servidor;
--   · el almacén privado conta-portal y sus políticas.
-- No cambia ninguna tabla, función ni fila que exista. Se puede pasar dos veces
-- seguidas. Nada en el camino del pedido.
--
-- LA SEGURIDAD, en una frase: el cliente NUNCA lee una tabla de la gestoría ni
-- de Code 1 (recibos, facturas). Lee con funciones SECURITY DEFINER que sacan
-- su cliente de auth.uid() (conta_portal_acceso) y solo de ese cliente. Las
-- tablas conta_portal_* tienen RLS: la gestoría ve las de su cuenta; la
-- persona del portal, solo las de su cliente. Lo prueba
-- supabase/staging/sql/20261109_gp_portal_base_prueba.sql, que entra como la
-- persona del cliente A y pide lo del cliente B: falla en cada función.
--
-- Lo de otros, solo se lee: conta_recibo, customer_invoice y conta_gc_mandato
-- (Code 1), la siembra de la demo (Code 2). Parar un recibo con «No estoy de
-- acuerdo» lo hace la función de Code 1 conta_recibo_parar (nº 4), que se llama
-- con la clave de servicio: aquí se crea la incidencia comprobando que el
-- recibo es de ese cliente, y DESPUÉS el servidor del portal llama a Code 1 y
-- apunta lo que contestó (conta_portal_incidencia_parada). No lee ni escribe en
-- GoCardless, Stripe ni el CRM: eso lo hacen las funciones conta-portal-*, con
-- la puerta de las demos.
--
-- Vuelta atrás: supabase/vuelta-atras/20261109T1530_gp_portal_base.down.sql

-- ── 1 · Quién entra y a qué cliente ────────────────────────────────────────────
create table if not exists public.conta_portal_acceso (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  party_id           uuid not null references public.party(id) on delete cascade,
  correo             text not null check (correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nombre             text,
  user_id            uuid,
  permiso            text not null default 'todo' check (permiso in ('todo', 'facturas_documentos')),
  invitado_por       uuid,
  invitado_por_name  text,
  invitado_at        timestamptz not null default now(),
  entro_at           timestamptz,
  ultima_vez_at      timestamptz,
  revocado_at        timestamptz,
  revocado_por_name  text
);
create unique index if not exists conta_portal_acceso_correo_idx on public.conta_portal_acceso (party_id, lower(correo));
create index if not exists conta_portal_acceso_usuario_idx on public.conta_portal_acceso (user_id) where revocado_at is null;
create index if not exists conta_portal_acceso_cuenta_idx on public.conta_portal_acceso (account_id);
comment on table public.conta_portal_acceso is
  'GP · Una persona con acceso al portal de UN cliente (party) de una gestoría (account). user_id: su usuario (lo pone el servidor al invitar). permiso: todo o solo facturas y documentos. Revocado = ya no entra.';

-- ── 2 · Los ajustes del portal de cada gestoría ────────────────────────────────
create table if not exists public.conta_portal_ajustes (
  account_id        uuid primary key references public.accounts(id) on delete cascade,
  pagar_devuelto    text[] not null default array['banco']::text[]
                      check (pagar_devuelto <@ array['banco', 'tarjeta']::text[]),
  updated_at        timestamptz not null default now(),
  updated_by_name   text
);
comment on table public.conta_portal_ajustes is
  'GP · Ajustes del portal de una gestoría. pagar_devuelto: cómo puede pagar el cliente un recibo devuelto: banco (GoCardless, al momento desde la app del banco) y/o tarjeta (el enlace de pago de Sumied: tarjeta o Bizum). Sin fila: solo banco.';

-- ── 3 · Mensajes entre el cliente y su gestoría ────────────────────────────────
create table if not exists public.conta_portal_mensaje (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  party_id      uuid not null references public.party(id) on delete cascade,
  de            text not null check (de in ('cliente', 'gestoria')),
  autor         uuid,
  autor_nombre  text not null,
  texto         text not null default '' check (length(texto) <= 5000),
  adjuntos      jsonb not null default '[]'::jsonb check (jsonb_typeof(adjuntos) = 'array'),
  created_at    timestamptz not null default now(),
  leido_at      timestamptz,
  avisado_at    timestamptz,
  check (length(trim(texto)) > 0 or jsonb_array_length(adjuntos) > 0)
);
create index if not exists conta_portal_mensaje_cliente_idx on public.conta_portal_mensaje (party_id, created_at desc);
create index if not exists conta_portal_mensaje_sin_leer_idx on public.conta_portal_mensaje (account_id) where leido_at is null;
comment on table public.conta_portal_mensaje is
  'GP · La conversación de un cliente con su gestoría. de: quién lo escribe. adjuntos: [{ruta, nombre, tipo, bytes}] en el almacén conta-portal. leido_at: cuando lo abrió el otro lado.';

-- ── 4 · Lo que la gestoría le pide al cliente ──────────────────────────────────
create table if not exists public.conta_portal_peticion (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  party_id         uuid not null references public.party(id) on delete cascade,
  tipo             text not null check (tipo in ('firmar', 'subir', 'contestar')),
  titulo           text not null check (length(trim(titulo)) > 0),
  detalle          text,
  fecha_limite     date,
  documento_ruta   text,
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'hecha', 'anulada')),
  respuesta        text,
  creada_por_name  text,
  created_at       timestamptz not null default now(),
  hecha_at         timestamptz,
  hecha_por_name   text,
  avisado_at       timestamptz,
  check (tipo <> 'firmar' or documento_ruta is not null),
  check ((estado = 'pendiente') = (hecha_at is null))
);
create index if not exists conta_portal_peticion_cliente_idx on public.conta_portal_peticion (party_id, estado);
comment on table public.conta_portal_peticion is
  'GP · «Lo que te pide tu gestoría»: firmar un documento (documento_ruta, en conta-portal), subir algo o contestar, con fecha límite. La hace el cliente; la gestoría puede anularla.';

-- ── 5 · La firma: aceptación con un código de un solo uso ──────────────────────
create table if not exists public.conta_portal_firma (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  party_id      uuid not null references public.party(id) on delete cascade,
  peticion_id   uuid not null references public.conta_portal_peticion(id) on delete cascade,
  acceso_id     uuid not null references public.conta_portal_acceso(id) on delete cascade,
  canal         text not null check (canal in ('correo', 'movil')),
  destino       text not null,
  codigo_hash   text not null,
  expira_at     timestamptz not null,
  intentos      smallint not null default 0,
  firmada_at    timestamptz,
  ip            text,
  navegador     text,
  pdf_ruta      text,
  pdf_sha256    text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now()
);
create index if not exists conta_portal_firma_peticion_idx on public.conta_portal_firma (peticion_id);
comment on table public.conta_portal_firma is
  'GP · Una firma por aceptación (17/11): el código va al correo o al móvil (destino, enmascarado); se guarda su huella, nunca el código. Firmada: quién (acceso), cuándo, desde dónde (ip, navegador) y el PDF firmado con su huella.';

-- ── 6 · Lo que el cliente le dice a la gestoría: incidencias ───────────────────
create table if not exists public.conta_portal_incidencia (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  party_id           uuid not null references public.party(id) on delete cascade,
  tipo               text not null check (tipo in ('no_de_acuerdo', 'cambio_datos')),
  recibo_id          uuid references public.conta_recibo(id) on delete set null,
  texto              text not null check (length(trim(texto)) > 0 and length(texto) <= 3000),
  recibo_parado      boolean,
  estado             text not null default 'abierta' check (estado in ('abierta', 'resuelta')),
  acceso_id          uuid references public.conta_portal_acceso(id) on delete set null,
  creada_por_name    text,
  created_at         timestamptz not null default now(),
  respuesta          text,
  resuelta_at        timestamptz,
  resuelta_por_name  text,
  avisado_at         timestamptz,
  check ((estado = 'abierta') = (resuelta_at is null))
);
create index if not exists conta_portal_incidencia_abiertas_idx on public.conta_portal_incidencia (account_id) where estado = 'abierta';
create unique index if not exists conta_portal_incidencia_recibo_idx on public.conta_portal_incidencia (recibo_id)
  where estado = 'abierta' and tipo = 'no_de_acuerdo';
comment on table public.conta_portal_incidencia is
  'GP · «No estoy de acuerdo» con un recibo (recibo_id; recibo_parado: lo que contestó conta_recibo_parar de Code 1, que llama el servidor después; nulo = aún sin llamar) o «Pedir un cambio de datos». Sale en «Pendiente de revisar» y en «Lo que tienes que hacer» hasta que la gestoría la resuelve.';

-- ── 7 · Lo que el cliente sube (va al buzón de su cuenta en Sumied) ────────────
create table if not exists public.conta_portal_subida (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  party_id            uuid not null references public.party(id) on delete cascade,
  acceso_id           uuid references public.conta_portal_acceso(id) on delete set null,
  peticion_id         uuid references public.conta_portal_peticion(id) on delete set null,
  ruta                text not null,
  nombre              text not null,
  tipo_mime           text,
  bytes               integer check (bytes is null or bytes > 0),
  estado              text not null default 'recibido' check (estado in ('recibido', 'en_el_buzon', 'sin_buzon', 'error')),
  buzon_account_id    uuid references public.accounts(id) on delete set null,
  document_inbox_id   uuid,
  error               text,
  created_at          timestamptz not null default now()
);
create index if not exists conta_portal_subida_cliente_idx on public.conta_portal_subida (party_id, created_at desc);
comment on table public.conta_portal_subida is
  'GP · Un papel que sube el cliente. Se guarda en conta-portal y el servidor lo pasa al buzón de documentos de la cuenta propia del cliente (document_inbox, canal portal). Sin cuenta propia: sin_buzon, y lo ve la gestoría.';

-- ── 8 · Lo que el portal pide al banco o a la pasarela ─────────────────────────
create table if not exists public.conta_portal_operacion (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid references public.company(id) on delete cascade,
  party_id        uuid not null references public.party(id) on delete cascade,
  recibo_id       uuid references public.conta_recibo(id) on delete set null,
  tipo            text not null check (tipo in ('pagar_banco', 'pagar_tarjeta', 'reintentar', 'cambiar_cuenta')),
  entorno         text check (entorno in ('pruebas', 'real')),
  estado          text not null default 'creada' check (estado in ('creada', 'esperando', 'hecha', 'fallida', 'caducada')),
  importe_cent    integer check (importe_cent is null or importe_cent > 0),
  externo_id      text,
  externo_url     text,
  mandato_nuevo   text,
  detalle         jsonb not null default '{}'::jsonb,
  error           text,
  acceso_id       uuid references public.conta_portal_acceso(id) on delete set null,
  creada_por_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  hecha_at        timestamptz
);
create index if not exists conta_portal_operacion_recibo_idx on public.conta_portal_operacion (recibo_id, tipo);
create index if not exists conta_portal_operacion_cliente_idx on public.conta_portal_operacion (party_id, created_at desc);
comment on table public.conta_portal_operacion is
  'GP · Lo que el cliente pide desde el portal al banco o a la pasarela: pagar un devuelto desde su banco (GoCardless, pago al momento), con tarjeta o Bizum (el enlace de pago de Sumied), que se lo pasen de nuevo (reintento en GoCardless) o cambiar la cuenta de cargo (domiciliación nueva). externo_id: el de GoCardless o el del enlace.';

-- ── 9 · Los avisos por correo al cliente ───────────────────────────────────────
create table if not exists public.conta_portal_aviso (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  party_id    uuid not null references public.party(id) on delete cascade,
  tipo        text not null check (tipo in ('factura', 'recibo_proximo', 'devuelto', 'mensaje', 'peticion', 'invitacion', 'enlace', 'firma')),
  clave       text not null unique,
  para        text,
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'buzon_de_pruebas', 'no_enviado', 'error')),
  detalle     text,
  created_at  timestamptz not null default now(),
  enviado_at  timestamptz
);
create index if not exists conta_portal_aviso_cliente_idx on public.conta_portal_aviso (party_id, created_at desc);
comment on table public.conta_portal_aviso is
  'GP · Cada correo al cliente, con una clave única por lo que avisa (factura:<id>, recibo_proximo:<recibo>, devuelto:<recibo>, mensaje:<id>…): nunca dos veces el mismo. En la demo, buzon_de_pruebas.';

-- ── 10 · conta_solicitud (G01): lo que pide el alta desde el portal ────────────
alter table public.conta_solicitud add column if not exists empleado_documento text;
alter table public.conta_solicitud add column if not exists fecha_efecto date;
alter table public.conta_solicitud add column if not exists tipo_contrato text;
alter table public.conta_solicitud add column if not exists horas_semana numeric(4,1);
alter table public.conta_solicitud add column if not exists portal_acceso_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conta_solicitud_horas_semana') then
    alter table public.conta_solicitud add constraint conta_solicitud_horas_semana check (horas_semana is null or (horas_semana > 0 and horas_semana <= 60));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conta_solicitud_empleado_documento') then
    alter table public.conta_solicitud add constraint conta_solicitud_empleado_documento
      check (empleado_documento is null or empleado_documento ~ '^[0-9XYZ][0-9]{7}[A-Z]$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conta_solicitud_portal_acceso') then
    alter table public.conta_solicitud add constraint conta_solicitud_portal_acceso
      foreign key (portal_acceso_id) references public.conta_portal_acceso(id) on delete set null;
  end if;
end $$;
comment on column public.conta_solicitud.empleado_documento is 'GP · DNI o NIE del trabajador del alta (sin espacios ni guiones). Lo da el cliente en el portal.';
comment on column public.conta_solicitud.fecha_efecto is 'GP · Desde qué día (alta) o hasta qué día (baja). mes es su mes.';
comment on column public.conta_solicitud.tipo_contrato is 'GP · El tipo de contrato que dice el cliente, en sus palabras (indefinido, temporal…).';
comment on column public.conta_solicitud.horas_semana is 'GP · Horas a la semana del contrato.';
comment on column public.conta_solicitud.portal_acceso_id is 'GP · Si la pidió una persona desde el portal, quién.';

-- ── 11 · Piezas de dentro ──────────────────────────────────────────────────────

-- Si la persona que llama ve ese cliente en el portal (para la RLS y el almacén).
create or replace function public.conta_portal_ve(p_party uuid, p_todo boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conta_portal_acceso a
                  where a.user_id = auth.uid() and a.revocado_at is null and a.party_id = p_party
                    and (not p_todo or a.permiso = 'todo'))
$$;

-- El acceso de quien llama a ese cliente (o al único que tenga), o error en palabras.
create or replace function public._conta_portal_yo(p_party uuid, p_todo boolean default false)
returns public.conta_portal_acceso language plpgsql stable security definer set search_path = public as $$
declare v public.conta_portal_acceso;
begin
  if auth.uid() is null then raise exception 'Entra con el enlace que te ha llegado por correo.' using errcode = '42501'; end if;
  select * into v from public.conta_portal_acceso
   where user_id = auth.uid() and revocado_at is null and (p_party is null or party_id = p_party)
   order by invitado_at limit 1;
  if v.id is null then raise exception 'No tienes acceso a este cliente.' using errcode = '42501'; end if;
  if p_todo and v.permiso <> 'todo' then
    raise exception 'Tu acceso es solo para facturas y documentos. Esto lo ve quien tiene acceso a todo.' using errcode = '42501';
  end if;
  return v;
end $$;

-- La empresa de la gestoría que le cobra (para la marca y las facturas): la del último recibo, si no la del cobro, si no la del CRM.
create or replace function public._conta_portal_empresa(p_account uuid, p_party uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.company_id from public.conta_recibo r where r.account_id = p_account and r.party_id = p_party order by r.mes desc limit 1),
    (select c.company_id from public.conta_cobro_cliente c where c.account_id = p_account and c.party_id = p_party order by c.updated_at desc limit 1),
    (select g.emisor_segun_bitrix from public.conta_gestoria_cliente g where g.account_id = p_account and g.party_id = p_party),
    (select e.id from public.company e where e.account_id = p_account and e.is_active order by e.created_at limit 1))
$$;

-- La marca de la gestoría: nombre, logo, color y cómo contactar.
create or replace function public._conta_portal_marca(p_account uuid, p_party uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nombre', coalesce(e.trade_name, e.legal_name, a.name),
    'logo_ruta', e.logo_path, 'color', e.color, 'correo', e.email, 'telefono', e.phone, 'empresa_id', e.id)
    from public.accounts a
    left join public.company e on e.id = public._conta_portal_empresa(p_account, p_party)
   where a.id = p_account
$$;

-- El estado de un recibo, en palabras del cliente.
create or replace function public._conta_portal_estado_recibo(p_estado text)
returns text language sql immutable as $$
  select case p_estado
    when 'preparado' then 'Próximo' when 'enviado' then 'Próximo' when 'en_el_banco' then 'En el banco'
    when 'cobrado' then 'Cobrado' when 'facturado' then 'Cobrado' when 'devuelto' then 'Devuelto'
    when 'retrocedido' then 'Devuelto' when 'cancelado' then 'Anulado' else p_estado end
$$;

-- Si un devuelto ya está pagado desde el portal (con tarjeta o desde el banco).
create or replace function public._conta_portal_devuelto_pagado(p_recibo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conta_portal_operacion o
                  where o.recibo_id = p_recibo and o.tipo in ('pagar_banco', 'pagar_tarjeta') and o.estado = 'hecha')
$$;

-- Los recibos devueltos que siguen debiéndose, con lo que se puede hacer.
create or replace function public._conta_portal_devueltos(p_account uuid, p_party uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'recibo_id', r.id, 'mes', r.mes, 'importe_cent', coalesce(r.cobrar_cent, r.total_cent),
           'devuelto_el', (select max(ev.cuando) from public.conta_recibo_evento ev where ev.recibo_id = r.id and ev.tipo in ('devuelto', 'retrocedido')),
           'gc_estado', r.gc_estado,
           'en_marcha', (select jsonb_build_object('tipo', o.tipo, 'estado', o.estado, 'url', o.externo_url, 'creada', o.created_at)
                           from public.conta_portal_operacion o
                          where o.recibo_id = r.id and o.estado in ('creada', 'esperando') order by o.created_at desc limit 1))
           order by r.mes), '[]'::jsonb)
    from public.conta_recibo r
   where r.account_id = p_account and r.party_id = p_party and r.estado in ('devuelto', 'retrocedido')
     and not public._conta_portal_devuelto_pagado(r.id)
$$;

-- El recibo que viene (el último que aún no se ha cobrado ni devuelto), con su desglose y por qué cambia.
create or replace function public._conta_portal_proximo(p_account uuid, p_party uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'recibo_id', r.id, 'mes', r.mes, 'estado', r.estado, 'estado_texto', public._conta_portal_estado_recibo(r.estado),
           'total_cent', coalesce(r.cobrar_cent, r.total_cent), 'anterior_cent', r.anterior_cent,
           'lineas', r.lineas, 'cambios', r.cambios, 'cargo_el', r.cargo_el, 'parado', to_jsonb(r.parado),
           'incidencia', (select jsonb_build_object('id', i.id, 'texto', i.texto, 'creada', i.created_at, 'parado', i.recibo_parado)
                            from public.conta_portal_incidencia i
                           where i.recibo_id = r.id and i.tipo = 'no_de_acuerdo' and i.estado = 'abierta' limit 1))
    from public.conta_recibo r
   where r.account_id = p_account and r.party_id = p_party
     and r.estado in ('preparado', 'enviado', 'en_el_banco') and r.decision <> 'este_mes_no'
   order by r.mes desc limit 1
$$;

-- La cuenta propia del cliente en Sumied (sus impuestos, nóminas y su buzón), si la tiene.
create or replace function public._conta_portal_cuenta_propia(p_account uuid, p_party uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select g.cuenta_propia_account_id from public.conta_gestoria_cliente g where g.account_id = p_account and g.party_id = p_party
$$;

-- ── 12 · Lo que lee el portal: una función por pantalla ────────────────────────

-- Al entrar: a qué clientes tiene acceso esta persona (normalmente uno) y apunta que ha entrado.
create or replace function public.conta_portal_entrada()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'Entra con el enlace que te ha llegado por correo.' using errcode = '42501'; end if;
  update public.conta_portal_acceso set entro_at = coalesce(entro_at, now()), ultima_vez_at = now()
   where user_id = auth.uid() and revocado_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('cliente_id', a.party_id, 'cliente', p.name, 'permiso', a.permiso,
           'gestoria', public._conta_portal_marca(a.account_id, a.party_id)) order by p.name), '[]'::jsonb)
    into v
    from public.conta_portal_acceso a join public.party p on p.id = a.party_id
   where a.user_id = auth.uid() and a.revocado_at is null;
  return jsonb_build_object('clientes', v);
end $$;

-- Inicio.
create or replace function public.conta_portal_inicio(p_party uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party); todo boolean; a uuid; c uuid; v_prop uuid;
begin
  todo := y.permiso = 'todo'; a := y.account_id; c := y.party_id; v_prop := public._conta_portal_cuenta_propia(a, c);
  return jsonb_build_object(
    'gestoria', public._conta_portal_marca(a, c),
    'cliente', (select jsonb_build_object('id', p.id, 'nombre', p.name, 'nif', p.tax_id) from public.party p where p.id = c),
    'yo', jsonb_build_object('nombre', coalesce(y.nombre, y.correo), 'correo', y.correo, 'permiso', y.permiso),
    'peticiones', case when todo then coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'tipo', q.tipo, 'titulo', q.titulo, 'detalle', q.detalle,
                     'fecha_limite', q.fecha_limite, 'creada', q.created_at) order by q.fecha_limite nulls last, q.created_at)
                     from public.conta_portal_peticion q where q.party_id = c and q.estado = 'pendiente'), '[]'::jsonb) else '[]'::jsonb end,
    'proximo', case when todo then public._conta_portal_proximo(a, c) end,
    'devueltos', case when todo then public._conta_portal_devueltos(a, c) else '[]'::jsonb end,
    'pagar_devuelto', coalesce((select to_jsonb(j.pagar_devuelto) from public.conta_portal_ajustes j where j.account_id = a), '["banco"]'::jsonb),
    'mensajes_sin_leer', case when todo then (select count(*) from public.conta_portal_mensaje m where m.party_id = c and m.de = 'gestoria' and m.leido_at is null) else 0 end,
    'puede_subir', v_prop is not null,
    'novedades', coalesce((select jsonb_agg(z.n order by z.n ->> 'cuando' desc) from (select x.n from (
        (select jsonb_build_object('tipo', 'factura', 'id', f.id, 'titulo', 'Factura ' || f.number_text, 'total', f.total, 'cuando', f.issue_date::timestamptz)
           from public.customer_invoice f where f.account_id = a and f.party_id = c and f.status = 'emitida' order by f.issue_date desc limit 3)
        union all
        (select jsonb_build_object('tipo', 'impuesto', 'id', t.id, 'titulo', t.form_code, 'periodo', t.period, 'ejercicio', t.fiscal_year,
                                   'importe', t.amount, 'resultado', t.result_kind, 'cuando', t.filed_at)
           from public.tax_return t where v_prop is not null and t.account_id = v_prop and t.filed_at is not null order by t.filed_at desc limit 2)
        union all
        (select jsonb_build_object('tipo', 'alta', 'id', s.id, 'titulo', s.empleado_nombre, 'alta', s.tipo, 'estado', s.estado,
                                   'desde', coalesce(s.fecha_efecto, s.mes), 'cuando', s.resuelta_at)
           from public.conta_solicitud s where todo and s.account_id = a and s.party_id = c and s.estado <> 'pedida' order by s.resuelta_at desc limit 2)
        union all
        (select jsonb_build_object('tipo', 'mensaje', 'id', m.id, 'titulo', left(m.texto, 120), 'cuando', m.created_at)
           from public.conta_portal_mensaje m where todo and m.party_id = c and m.de = 'gestoria' order by m.created_at desc limit 1)
      ) x(n) where x.n ->> 'cuando' is not null order by x.n ->> 'cuando' desc limit 6) z), '[]'::jsonb)
  );
end $$;

-- Facturas: todas, con su estado de pago. El buscador y el año, en la pantalla (son pocas).
create or replace function public.conta_portal_facturas(p_party uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party);
begin
  return jsonb_build_object('facturas', coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'numero', f.number_text, 'fecha', f.issue_date, 'anio', extract(year from f.issue_date)::int,
      'tipo', f.doc_type, 'base', f.base, 'iva', f.tax, 'retencion', f.withholding_amount, 'total', f.total,
      'concepto', coalesce(r.mes, f.notes), 'recibo_mes', r.mes, 'tiene_pdf', f.pdf_path is not null,
      'estado', case
        when r.estado in ('devuelto', 'retrocedido') and not public._conta_portal_devuelto_pagado(r.id) then 'Devuelta'
        when r.estado in ('cobrado', 'facturado', 'devuelto', 'retrocedido') then 'Pagada'
        when exists (select 1 from public.conta_enlace_pago e where e.invoice_id = f.id and e.pagado_at is not null) then 'Pagada'
        else 'Pendiente' end)
      order by f.issue_date desc, f.number desc)
    from public.customer_invoice f
    left join public.conta_recibo r on r.invoice_id = f.id
   where f.account_id = y.account_id and f.party_id = y.party_id and f.status = 'emitida'), '[]'::jsonb));
end $$;

-- Pagos: los recibos, lo pagado en el año, lo pendiente y el próximo cargo.
create or replace function public.conta_portal_pagos(p_party uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party, true); anio text := to_char(now() at time zone 'Europe/Madrid', 'YYYY');
begin
  return jsonb_build_object(
    'pagado_anio_cent', (select coalesce(sum(coalesce(r.cobrar_cent, r.total_cent)), 0) from public.conta_recibo r
                          where r.account_id = y.account_id and r.party_id = y.party_id and left(r.mes, 4) = anio
                            and (r.estado in ('cobrado', 'facturado') or public._conta_portal_devuelto_pagado(r.id))),
    'devueltos', public._conta_portal_devueltos(y.account_id, y.party_id),
    'proximo', public._conta_portal_proximo(y.account_id, y.party_id),
    'recibos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'mes', r.mes, 'importe_cent', coalesce(r.cobrar_cent, r.total_cent), 'estado', r.estado,
        'estado_texto', case when r.estado in ('devuelto', 'retrocedido') and public._conta_portal_devuelto_pagado(r.id) then 'Pagado después'
                             else public._conta_portal_estado_recibo(r.estado) end,
        'cargo_el', r.cargo_el, 'cobrado_el', r.confirmado_el, 'factura_id', r.invoice_id) order by r.mes desc)
      from public.conta_recibo r where r.account_id = y.account_id and r.party_id = y.party_id and r.estado <> 'cancelado'), '[]'::jsonb));
end $$;

-- Documentos: impuestos presentados con su justificante, nóminas y seguros sociales, y lo que ha subido.
create or replace function public.conta_portal_documentos(p_party uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party); v_prop uuid;
begin
  v_prop := public._conta_portal_cuenta_propia(y.account_id, y.party_id);
  return jsonb_build_object(
    'puede_subir', v_prop is not null,
    'impuestos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'modelo', t.form_code, 'ejercicio', t.fiscal_year, 'periodo', t.period,
        'presentado', t.filed_at, 'resultado', t.result_kind, 'importe', t.amount, 'justificante', t.receipt_document_path is not null)
        order by t.filed_at desc)
      from public.tax_return t where v_prop is not null and t.account_id = v_prop and t.filed_at is not null), '[]'::jsonb),
    'nominas', case when y.permiso <> 'todo' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nombre', d.name,
        'carpeta', d.carpeta, 'trabajador', e.name, 'fecha', d.created_at) order by d.created_at desc)
      from public.documents d join public.employees e on e.id = d.employee_id
     where v_prop is not null and e.account_id = v_prop and d.carpeta in ('nominas', 'ss_sepe') and d.archivado_at is null), '[]'::jsonb) end,
    'subidas', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'estado', s.estado, 'subida', s.created_at,
        'contabilizada', exists (select 1 from public.document_inbox di where di.id = s.document_inbox_id and di.status = 'factura'))
        order by s.created_at desc)
      from public.conta_portal_subida s where s.party_id = y.party_id), '[]'::jsonb));
end $$;

-- Trabajadores: los de alta (las líneas del recibo con trabajador) y lo pedido.
create or replace function public.conta_portal_trabajadores(p_party uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party, true); v_mes date := date_trunc('month', now() at time zone 'Europe/Madrid')::date;
begin
  return jsonb_build_object(
    'trabajadores', coalesce((select jsonb_agg(jsonb_build_object('linea_id', l.id, 'nombre', l.empleado_nombre, 'desde', l.desde, 'hasta', l.hasta,
        'servicio', s.nombre, 'nuevo', l.desde >= v_mes) order by l.desde, l.empleado_nombre)
      from public.conta_linea l join public.conta_servicio s on s.id = l.servicio_id
     where l.account_id = y.account_id and l.party_id = y.party_id and l.empleado_nombre is not null
       and (l.hasta is null or l.hasta >= v_mes)), '[]'::jsonb),
    'peticiones', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'tipo', s.tipo, 'nombre', s.empleado_nombre, 'fecha', coalesce(s.fecha_efecto, s.mes),
        'estado', s.estado, 'pedida', s.pedida_at, 'resuelta', s.resuelta_at, 'motivo', s.motivo_rechazo) order by s.pedida_at desc)
      from public.conta_solicitud s where s.account_id = y.account_id and s.party_id = y.party_id
       and (s.estado = 'pedida' or s.resuelta_at > now() - interval '60 days')), '[]'::jsonb));
end $$;

-- Mensajes.
create or replace function public.conta_portal_mensajes(p_party uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party, true);
begin
  return jsonb_build_object('mensajes', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'de', m.de, 'autor', m.autor_nombre,
      'texto', m.texto, 'adjuntos', m.adjuntos, 'cuando', m.created_at, 'leido', m.leido_at) order by m.created_at)
    from (select * from public.conta_portal_mensaje where party_id = y.party_id order by created_at desc limit 200) m), '[]'::jsonb));
end $$;

-- Tu cuenta: la cuenta de cargo, los datos para las facturas, las personas con acceso y lo contratado.
create or replace function public.conta_portal_cuenta(p_party uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party, true); e uuid;
begin
  e := public._conta_portal_empresa(y.account_id, y.party_id);
  return jsonb_build_object(
    'domiciliacion', (select jsonb_build_object('estado', m.estado, 'firmada', m.creado,
                        'cuenta_ultimos', to_jsonb(m) ->> 'cuenta_ultimos', 'banco', to_jsonb(m) ->> 'cuenta_banco')
                        from public.conta_gc_mandato m
                        join public.conta_cobro_cliente cc on cc.company_id = m.company_id and cc.gc_cliente_id = m.gc_cliente_id
                       where cc.account_id = y.account_id and cc.party_id = y.party_id and m.estado not in ('cancelled', 'failed', 'expired', 'consumed', 'blocked')
                       order by m.creado desc nulls last limit 1),
    'cambio_en_marcha', (select jsonb_build_object('estado', o.estado, 'url', o.externo_url, 'creada', o.created_at)
                           from public.conta_portal_operacion o where o.party_id = y.party_id and o.tipo = 'cambiar_cuenta'
                            and o.estado in ('creada', 'esperando') order by o.created_at desc limit 1),
    'datos', (select jsonb_build_object('razon_social', coalesce(cf.legal_name, p.name), 'nif', p.tax_id,
                'direccion', concat_ws(' · ', cf.fiscal_street, nullif(concat_ws(' ', cf.fiscal_postal_code, cf.fiscal_city), '')),
                'correo_facturas', (select f.email_to from public.customer_invoice f where f.party_id = p.id and f.email_to is not null order by f.issue_date desc limit 1))
                from public.party p left join public.customer_fiscal cf on cf.party_id = p.id where p.id = y.party_id),
    'cambio_datos_abierto', exists (select 1 from public.conta_portal_incidencia i where i.party_id = y.party_id and i.tipo = 'cambio_datos' and i.estado = 'abierta'),
    'personas', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', coalesce(x.nombre, x.correo), 'correo', x.correo,
        'permiso', x.permiso, 'soy_yo', x.id = y.id, 'ha_entrado', x.entro_at is not null) order by x.invitado_at)
      from public.conta_portal_acceso x where x.party_id = y.party_id and x.revocado_at is null), '[]'::jsonb),
    'contratado', coalesce((public._conta_portal_proximo(y.account_id, y.party_id)) -> 'lineas',
                           (select r.lineas from public.conta_recibo r where r.account_id = y.account_id and r.party_id = y.party_id order by r.mes desc limit 1),
                           '[]'::jsonb),
    'empresa_id', e);
end $$;

-- Un fichero que el cliente puede abrir: dónde está (el servidor lo firma). Si no es suyo, error.
create or replace function public.conta_portal_archivo(p_party uuid, p_tipo text, p_id uuid, p_indice int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party); v_prop uuid; r jsonb;
begin
  v_prop := public._conta_portal_cuenta_propia(y.account_id, y.party_id);
  if p_tipo = 'factura' then
    select jsonb_build_object('ruta', f.pdf_path, 'nombre', 'Factura ' || replace(f.number_text, '/', '-') || '.pdf') into r
      from public.customer_invoice f where f.id = p_id and f.account_id = y.account_id and f.party_id = y.party_id and f.status = 'emitida' and f.pdf_path is not null;
  elsif p_tipo = 'impuesto' then
    select jsonb_build_object('ruta', t.receipt_document_path, 'nombre', 'Justificante ' || t.form_code || ' ' || t.fiscal_year || ' ' || coalesce(t.period, '') || '.pdf') into r
      from public.tax_return t where t.id = p_id and v_prop is not null and t.account_id = v_prop and t.receipt_document_path is not null;
  elsif p_tipo = 'nomina' and y.permiso = 'todo' then
    select jsonb_build_object('ruta', d.file_path, 'nombre', d.name) into r
      from public.documents d join public.employees e on e.id = d.employee_id
     where d.id = p_id and v_prop is not null and e.account_id = v_prop and d.carpeta in ('nominas', 'ss_sepe');
  elsif p_tipo = 'subida' then
    select jsonb_build_object('ruta', s.ruta, 'nombre', s.nombre) into r from public.conta_portal_subida s where s.id = p_id and s.party_id = y.party_id;
  elsif p_tipo = 'adjunto' and y.permiso = 'todo' then
    select jsonb_build_object('ruta', m.adjuntos -> p_indice ->> 'ruta', 'nombre', m.adjuntos -> p_indice ->> 'nombre') into r
      from public.conta_portal_mensaje m where m.id = p_id and m.party_id = y.party_id and jsonb_array_length(m.adjuntos) > p_indice;
  elsif p_tipo = 'peticion' and y.permiso = 'todo' then
    select jsonb_build_object('ruta', coalesce((select fi.pdf_ruta from public.conta_portal_firma fi where fi.peticion_id = q.id and fi.firmada_at is not null order by fi.firmada_at desc limit 1), q.documento_ruta),
                              'nombre', q.titulo || '.pdf') into r
      from public.conta_portal_peticion q where q.id = p_id and q.party_id = y.party_id and q.documento_ruta is not null;
  end if;
  if r is null or r ->> 'ruta' is null then raise exception 'Ese documento no está o no es tuyo.' using errcode = 'P0002'; end if;
  return r || jsonb_build_object('almacen', case p_tipo
    when 'factura' then 'conta-documentos' when 'impuesto' then 'conta-documentos' when 'nomina' then 'employee-documents' else 'conta-portal' end);
end $$;

-- ── 13 · Lo que hace el cliente ───────────────────────────────────────────────

-- Escribir a la gestoría (o la gestoría al cliente: lo decide quién llama).
create or replace function public.conta_portal_mensaje_enviar(p_party uuid, p_texto text, p_adjuntos jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_de text; v_autor text; v_id uuid; y public.conta_portal_acceso; v_adj jsonb := coalesce(p_adjuntos, '[]'::jsonb); x jsonb;
begin
  select account_id into v_cuenta from public.party where id = p_party;
  if v_cuenta is null then raise exception 'Ese cliente no existe.' using errcode = 'P0002'; end if;
  if public.belongs_to_account(v_cuenta) then
    v_de := 'gestoria'; v_autor := public.conta_nombre_actor();
  else
    y := public._conta_portal_yo(p_party, true); v_de := 'cliente'; v_autor := coalesce(y.nombre, y.correo);
  end if;
  if jsonb_typeof(v_adj) <> 'array' or jsonb_array_length(v_adj) > 5 then raise exception 'Como mucho cinco adjuntos por mensaje.' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(v_adj) loop
    if coalesce(x ->> 'ruta', '') not like v_cuenta::text || '/' || p_party::text || '/mensajes/%' then
      raise exception 'Ese adjunto no está en la carpeta de este cliente.' using errcode = '42501';
    end if;
  end loop;
  if length(trim(coalesce(p_texto, ''))) = 0 and jsonb_array_length(v_adj) = 0 then raise exception 'Escribe algo o adjunta un fichero.' using errcode = '22023'; end if;
  insert into public.conta_portal_mensaje (account_id, party_id, de, autor, autor_nombre, texto, adjuntos)
  values (v_cuenta, p_party, v_de, auth.uid(), coalesce(v_autor, 'Sin nombre'), trim(coalesce(p_texto, '')), v_adj) returning id into v_id;
  return jsonb_build_object('id', v_id, 'de', v_de, 'frase', case v_de when 'cliente' then 'Enviado a tu gestoría. Te avisamos por correo cuando conteste.'
                                                                   else 'Enviado. Al cliente le llega un aviso por correo.' end);
end $$;

-- Marcar como leídos los mensajes del otro lado.
create or replace function public.conta_portal_mensajes_leidos(p_party uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_de text; n integer;
begin
  select account_id into v_cuenta from public.party where id = p_party;
  if v_cuenta is null then raise exception 'Ese cliente no existe.' using errcode = 'P0002'; end if;
  if public.belongs_to_account(v_cuenta) then v_de := 'cliente'; else perform public._conta_portal_yo(p_party, true); v_de := 'gestoria'; end if;
  update public.conta_portal_mensaje set leido_at = now() where party_id = p_party and de = v_de and leido_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Pedir un alta o una baja de un trabajador. La gestoría la da por hecha desde la ficha.
create or replace function public.conta_portal_solicitud_pedir(p_party uuid, p_tipo text, p_nombre text, p_documento text, p_fecha date,
  p_contrato text default null, p_horas numeric default null, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party, true); v_emp uuid; v_id uuid;
        v_doc text := upper(regexp_replace(coalesce(p_documento, ''), '[\s.-]', '', 'g')); v_nombre text := trim(coalesce(p_nombre, ''));
begin
  if p_tipo not in ('alta', 'baja') then raise exception 'Di si es un alta o una baja.' using errcode = '22023'; end if;
  if v_nombre = '' then raise exception 'Escribe el nombre y los apellidos.' using errcode = '22023'; end if;
  if p_fecha is null then raise exception 'Di la fecha.' using errcode = '22023'; end if;
  if p_tipo = 'alta' and v_doc !~ '^[0-9XYZ][0-9]{7}[A-Z]$' then raise exception 'El DNI o NIE no tiene la forma de uno (8 cifras y una letra, o X, Y o Z al principio).' using errcode = '22023'; end if;
  if p_horas is not null and (p_horas <= 0 or p_horas > 60) then raise exception 'Las horas a la semana van de 1 a 60.' using errcode = '22023'; end if;
  if exists (select 1 from public.conta_solicitud s where s.party_id = y.party_id and s.estado = 'pedida' and s.tipo = p_tipo
               and upper(s.empleado_nombre) = upper(v_nombre)) then
    raise exception 'Ya hay una petición igual esperando a tu gestoría.' using errcode = '23505';
  end if;
  v_emp := public._conta_portal_empresa(y.account_id, y.party_id);
  if v_emp is null then raise exception 'Tu gestoría aún no tiene una empresa dada de alta en Sumied.' using errcode = 'P0002'; end if;
  insert into public.conta_solicitud (account_id, company_id, party_id, tipo, empleado_nombre, mes, nota, pedida_por_name,
                                      empleado_documento, fecha_efecto, tipo_contrato, horas_semana, portal_acceso_id)
  values (y.account_id, v_emp, y.party_id, p_tipo, v_nombre, date_trunc('month', p_fecha)::date, nullif(trim(coalesce(p_nota, '')), ''),
          coalesce(y.nombre, y.correo), nullif(v_doc, ''), p_fecha, nullif(trim(coalesce(p_contrato, '')), ''), p_horas, y.id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'frase', format('Pedida %s de %s desde el %s. Tu gestoría te avisa cuando esté hecha.',
    case p_tipo when 'alta' then 'el alta' else 'la baja' end, v_nombre, to_char(p_fecha, 'DD/MM/YYYY')));
end $$;

-- «No estoy de acuerdo» con un recibo, o «Pedir un cambio de datos».
create or replace function public.conta_portal_incidencia_crear(p_party uuid, p_tipo text, p_texto text, p_recibo uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party, true); v_r public.conta_recibo; v_id uuid;
begin
  if p_tipo not in ('no_de_acuerdo', 'cambio_datos') then raise exception 'Ese tipo de aviso no existe.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_texto, ''))) = 0 then raise exception 'Cuéntanos qué no cuadra.' using errcode = '22023'; end if;
  if p_tipo = 'no_de_acuerdo' then
    select * into v_r from public.conta_recibo where id = p_recibo and account_id = y.account_id and party_id = y.party_id;
    if v_r.id is null then raise exception 'Ese recibo no es tuyo.' using errcode = '42501'; end if;
    if v_r.estado not in ('preparado', 'enviado') then
      raise exception 'Ese recibo ya está en el banco: escríbele a tu gestoría desde Mensajes.' using errcode = '22023';
    end if;
    if exists (select 1 from public.conta_portal_incidencia i where i.recibo_id = v_r.id and i.tipo = 'no_de_acuerdo' and i.estado = 'abierta') then
      raise exception 'Ya le has dicho a tu gestoría que no estás de acuerdo con este recibo: lo está revisando.' using errcode = '23505';
    end if;
    -- Parar el recibo es de Code 1 (conta_recibo_parar, con la clave de servicio): lo llama el servidor del portal
    -- con esta incidencia ya creada, y apunta lo que contestó (conta_portal_incidencia_parada).
  end if;
  insert into public.conta_portal_incidencia (account_id, party_id, tipo, recibo_id, texto, recibo_parado, acceso_id, creada_por_name)
  values (y.account_id, y.party_id, p_tipo, case when p_tipo = 'no_de_acuerdo' then v_r.id end, trim(p_texto), null, y.id, coalesce(y.nombre, y.correo))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'recibo_id', v_r.id, 'parar', p_tipo = 'no_de_acuerdo',
    'motivo', case when p_tipo = 'no_de_acuerdo' then left('El cliente no está de acuerdo: ' || trim(p_texto), 500) end,
    'quien', coalesce(y.nombre, y.correo),
    'frase', case when p_tipo = 'cambio_datos' then 'Enviado a tu gestoría. Te avisamos cuando lo cambie.'
                  else 'Enviado a tu gestoría, que lo revisa antes de cobrarlo.' end);
end $$;

-- Contestar o dar por hecha una petición de subir o contestar (la de firmar va por la firma).
create or replace function public.conta_portal_peticion_contestar(p_peticion uuid, p_respuesta text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q public.conta_portal_peticion; y public.conta_portal_acceso;
begin
  select * into q from public.conta_portal_peticion where id = p_peticion;
  if q.id is null then raise exception 'Esa petición no existe.' using errcode = 'P0002'; end if;
  y := public._conta_portal_yo(q.party_id, true);
  if q.estado <> 'pendiente' then raise exception 'Esa petición ya está cerrada.' using errcode = '22023'; end if;
  if q.tipo = 'firmar' then raise exception 'Esta se firma con el código que te mandamos.' using errcode = '22023'; end if;
  if q.tipo = 'contestar' and length(trim(coalesce(p_respuesta, ''))) = 0 then raise exception 'Escribe tu respuesta.' using errcode = '22023'; end if;
  update public.conta_portal_peticion set estado = 'hecha', respuesta = nullif(trim(coalesce(p_respuesta, '')), ''), hecha_at = now(),
         hecha_por_name = coalesce(y.nombre, y.correo) where id = q.id;
  if q.tipo = 'contestar' then
    insert into public.conta_portal_mensaje (account_id, party_id, de, autor, autor_nombre, texto)
    values (q.account_id, q.party_id, 'cliente', auth.uid(), coalesce(y.nombre, y.correo), q.titulo || E'\n' || trim(p_respuesta));
  end if;
  return jsonb_build_object('id', q.id, 'frase', 'Hecho. Tu gestoría ya lo tiene.');
end $$;

-- Invitar a otra persona del cliente (lo hace quien tiene «todo», o la gestoría). El correo con el enlace lo manda el servidor.
create or replace function public.conta_portal_invitar(p_party uuid, p_correo text, p_nombre text, p_permiso text default 'todo')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_quien text; v_id uuid; v_correo text := lower(trim(coalesce(p_correo, ''))); y public.conta_portal_acceso; v_ya public.conta_portal_acceso;
begin
  select account_id into v_cuenta from public.party where id = p_party;
  if v_cuenta is null then raise exception 'Ese cliente no existe.' using errcode = 'P0002'; end if;
  if public.current_user_is_admin_or_manager_of(v_cuenta) then
    v_quien := public.conta_nombre_actor();
  else
    y := public._conta_portal_yo(p_party, true); v_quien := coalesce(y.nombre, y.correo);
  end if;
  if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Ese correo no tiene la forma de uno.' using errcode = '22023'; end if;
  if p_permiso not in ('todo', 'facturas_documentos') then raise exception 'El permiso es «Todo» o «Facturas y documentos».' using errcode = '22023'; end if;
  select * into v_ya from public.conta_portal_acceso where party_id = p_party and lower(correo) = v_correo;
  if v_ya.id is not null and v_ya.revocado_at is null then
    update public.conta_portal_acceso set permiso = p_permiso, nombre = coalesce(nullif(trim(coalesce(p_nombre, '')), ''), nombre) where id = v_ya.id;
    return jsonb_build_object('id', v_ya.id, 'nuevo', false, 'frase', format('%s ya tenía acceso: se le vuelve a mandar el enlace.', v_correo));
  end if;
  if v_ya.id is not null then
    update public.conta_portal_acceso set revocado_at = null, revocado_por_name = null, permiso = p_permiso, invitado_at = now(),
           invitado_por = auth.uid(), invitado_por_name = v_quien, nombre = coalesce(nullif(trim(coalesce(p_nombre, '')), ''), nombre)
     where id = v_ya.id returning id into v_id;
  else
    insert into public.conta_portal_acceso (account_id, party_id, correo, nombre, permiso, invitado_por, invitado_por_name)
    values (v_cuenta, p_party, v_correo, nullif(trim(coalesce(p_nombre, '')), ''), p_permiso, auth.uid(), v_quien) returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id, 'nuevo', true, 'frase', format('Invitada %s. Le llega un correo con el enlace para entrar.', v_correo));
end $$;

-- Quitar el acceso a una persona (quien tiene «todo», o la gestoría). Nadie se quita a sí mismo.
create or replace function public.conta_portal_acceso_quitar(p_acceso uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.conta_portal_acceso; v_quien text; y public.conta_portal_acceso;
begin
  select * into x from public.conta_portal_acceso where id = p_acceso;
  if x.id is null then raise exception 'Esa persona no tiene acceso.' using errcode = 'P0002'; end if;
  if public.current_user_is_admin_or_manager_of(x.account_id) then
    v_quien := public.conta_nombre_actor();
  else
    y := public._conta_portal_yo(x.party_id, true); v_quien := coalesce(y.nombre, y.correo);
    if y.id = x.id then raise exception 'No puedes quitarte el acceso a ti: pídeselo a tu gestoría.' using errcode = '22023'; end if;
  end if;
  update public.conta_portal_acceso set revocado_at = now(), revocado_por_name = v_quien where id = x.id and revocado_at is null;
  return jsonb_build_object('id', x.id, 'frase', format('%s ya no entra en el portal.', coalesce(x.nombre, x.correo)));
end $$;

-- Comprobar el código de la firma. Firmada: quién, cuándo y desde dónde. El PDF firmado lo pone el servidor.
create or replace function public.conta_portal_firma_comprobar(p_firma uuid, p_codigo text, p_ip text default null, p_navegador text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.conta_portal_firma; y public.conta_portal_acceso;
begin
  select * into f from public.conta_portal_firma where id = p_firma for update;
  if f.id is null then raise exception 'Esa firma no existe.' using errcode = 'P0002'; end if;
  y := public._conta_portal_yo(f.party_id, true);
  if f.acceso_id <> y.id then raise exception 'Ese código no es tuyo.' using errcode = '42501'; end if;
  if f.firmada_at is not null then return jsonb_build_object('id', f.id, 'firmada', true, 'frase', 'Ya estaba firmado.'); end if;
  if f.expira_at < now() then raise exception 'El código ha caducado. Pide otro.' using errcode = '22023'; end if;
  if f.intentos >= 5 then raise exception 'Demasiados intentos. Pide otro código.' using errcode = '22023'; end if;
  if encode(extensions.digest(regexp_replace(coalesce(p_codigo, ''), '\D', '', 'g') || ':' || f.id::text, 'sha256'), 'hex') <> f.codigo_hash then
    update public.conta_portal_firma set intentos = intentos + 1 where id = f.id;
    return jsonb_build_object('id', f.id, 'firmada', false, 'frase', format('Ese código no es. Te quedan %s intentos.', 4 - f.intentos));
  end if;
  update public.conta_portal_firma set firmada_at = now(), ip = left(p_ip, 64), navegador = left(p_navegador, 300) where id = f.id;
  update public.conta_portal_peticion set estado = 'hecha', hecha_at = now(), hecha_por_name = coalesce(y.nombre, y.correo)
   where id = f.peticion_id and estado = 'pendiente';
  return jsonb_build_object('id', f.id, 'firmada', true, 'frase', 'Firmado. Tu gestoría ya lo tiene, y tú tienes la copia en Documentos.');
end $$;

-- ── 14 · Lo que hace la gestoría ──────────────────────────────────────────────

-- La pestaña del portal en la ficha del cliente: quién entra, mensajes, peticiones, incidencias y altas pedidas.
create or replace function public.conta_portal_ficha(p_party uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.party where id = p_party;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Ese cliente no es de esta cuenta.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'accesos', coalesce((select jsonb_agg(to_jsonb(a) - 'user_id' order by a.invitado_at) from public.conta_portal_acceso a where a.party_id = p_party), '[]'::jsonb),
    'mensajes', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'de', m.de, 'autor', m.autor_nombre, 'texto', m.texto, 'adjuntos', m.adjuntos,
        'cuando', m.created_at, 'leido', m.leido_at) order by m.created_at)
      from (select * from public.conta_portal_mensaje where party_id = p_party order by created_at desc limit 200) m), '[]'::jsonb),
    'peticiones', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from public.conta_portal_peticion q where q.party_id = p_party), '[]'::jsonb),
    'incidencias', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from public.conta_portal_incidencia i where i.party_id = p_party), '[]'::jsonb),
    'solicitudes', coalesce((select jsonb_agg(to_jsonb(s) order by s.pedida_at desc) from public.conta_solicitud s where s.party_id = p_party and s.account_id = v_cuenta), '[]'::jsonb),
    'subidas', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc) from public.conta_portal_subida s where s.party_id = p_party), '[]'::jsonb));
end $$;

-- Lo pendiente del portal de toda la cuenta, para «Lo que tienes que hacer» y «Pendiente de revisar».
create or replace function public.conta_portal_pendiente(p_cuenta uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.belongs_to_account(p_cuenta) then return jsonb_build_object('mensajes', '[]'::jsonb, 'incidencias', '[]'::jsonb, 'solicitudes', '[]'::jsonb, 'subidas', '[]'::jsonb); end if;
  return jsonb_build_object(
    'mensajes', coalesce((select jsonb_agg(jsonb_build_object('cliente_id', m.party_id, 'cliente', p.name, 'sin_leer', m.n, 'ultimo', m.ultimo) order by m.ultimo)
      from (select party_id, count(*) n, max(created_at) ultimo from public.conta_portal_mensaje
             where account_id = p_cuenta and de = 'cliente' and leido_at is null group by party_id) m join public.party p on p.id = m.party_id), '[]'::jsonb),
    'incidencias', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'cliente_id', i.party_id, 'cliente', p.name, 'tipo', i.tipo, 'texto', i.texto,
        'recibo_id', i.recibo_id, 'recibo_parado', i.recibo_parado, 'cuando', i.created_at) order by i.created_at)
      from public.conta_portal_incidencia i join public.party p on p.id = i.party_id where i.account_id = p_cuenta and i.estado = 'abierta'
       -- Las que paró Code 1 ya salen en su «Pendiente de revisar»: aquí no se repiten.
       and not (i.tipo = 'no_de_acuerdo' and i.recibo_parado is true)), '[]'::jsonb),
    'solicitudes', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'cliente_id', s.party_id, 'cliente', p.name, 'tipo', s.tipo, 'nombre', s.empleado_nombre,
        'fecha', coalesce(s.fecha_efecto, s.mes), 'cuando', s.pedida_at, 'desde_el_portal', s.portal_acceso_id is not null) order by s.pedida_at)
      from public.conta_solicitud s join public.party p on p.id = s.party_id where s.account_id = p_cuenta and s.estado = 'pedida'), '[]'::jsonb),
    'subidas', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'cliente_id', s.party_id, 'cliente', p.name, 'nombre', s.nombre, 'estado', s.estado, 'cuando', s.created_at) order by s.created_at)
      from public.conta_portal_subida s join public.party p on p.id = s.party_id where s.account_id = p_cuenta and s.estado in ('sin_buzon', 'error')), '[]'::jsonb));
end $$;

-- Pedirle algo al cliente: firmar, subir o contestar, con fecha límite.
create or replace function public.conta_portal_peticion_crear(p_party uuid, p_tipo text, p_titulo text, p_detalle text default null,
  p_fecha_limite date default null, p_documento_ruta text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_id uuid;
begin
  select account_id into v_cuenta from public.party where id = p_party;
  if v_cuenta is null or not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la gestoría le pide cosas al cliente.' using errcode = '42501';
  end if;
  if p_tipo not in ('firmar', 'subir', 'contestar') then raise exception 'Se le puede pedir firmar, subir o contestar.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_titulo, ''))) = 0 then raise exception 'Escribe qué le pides.' using errcode = '22023'; end if;
  if p_tipo = 'firmar' and coalesce(p_documento_ruta, '') not like v_cuenta::text || '/' || p_party::text || '/peticiones/%' then
    raise exception 'Para pedir una firma, sube antes el PDF a la carpeta del cliente.' using errcode = '22023';
  end if;
  if p_fecha_limite is not null and p_fecha_limite < (now() at time zone 'Europe/Madrid')::date then raise exception 'La fecha límite ya ha pasado.' using errcode = '22023'; end if;
  insert into public.conta_portal_peticion (account_id, party_id, tipo, titulo, detalle, fecha_limite, documento_ruta, creada_por_name)
  values (v_cuenta, p_party, p_tipo, trim(p_titulo), nullif(trim(coalesce(p_detalle, '')), ''), p_fecha_limite, p_documento_ruta, public.conta_nombre_actor())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'frase', 'Pedido. Al cliente le llega un aviso por correo y lo ve en su portal.');
end $$;

create or replace function public.conta_portal_peticion_anular(p_peticion uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q public.conta_portal_peticion;
begin
  select * into q from public.conta_portal_peticion where id = p_peticion;
  if q.id is null or not public.current_user_is_admin_or_manager_of(q.account_id) then raise exception 'Esa petición no es de esta cuenta.' using errcode = '42501'; end if;
  if q.estado <> 'pendiente' then raise exception 'Esa petición ya está cerrada.' using errcode = '22023'; end if;
  update public.conta_portal_peticion set estado = 'anulada', hecha_at = now(), hecha_por_name = public.conta_nombre_actor() where id = q.id;
  return jsonb_build_object('id', q.id, 'frase', 'Anulada. El cliente ya no la ve.');
end $$;

create or replace function public.conta_portal_incidencia_resolver(p_incidencia uuid, p_respuesta text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.conta_portal_incidencia;
begin
  select * into i from public.conta_portal_incidencia where id = p_incidencia;
  if i.id is null or not public.current_user_is_admin_or_manager_of(i.account_id) then raise exception 'Ese aviso no es de esta cuenta.' using errcode = '42501'; end if;
  if i.estado <> 'abierta' then raise exception 'Ya estaba resuelto.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_respuesta, ''))) = 0 then raise exception 'Escribe qué le contestas al cliente.' using errcode = '22023'; end if;
  update public.conta_portal_incidencia set estado = 'resuelta', respuesta = trim(p_respuesta), resuelta_at = now(), resuelta_por_name = public.conta_nombre_actor()
   where id = i.id;
  insert into public.conta_portal_mensaje (account_id, party_id, de, autor, autor_nombre, texto)
  values (i.account_id, i.party_id, 'gestoria', auth.uid(), coalesce(public.conta_nombre_actor(), 'Tu gestoría'), trim(p_respuesta));
  return jsonb_build_object('id', i.id, 'frase', 'Resuelto. Al cliente le llega tu respuesta en Mensajes.');
end $$;

create or replace function public.conta_portal_ajustes_guardar(p_cuenta uuid, p_pagar_devuelto text[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin_or_manager_of(p_cuenta) then raise exception 'Solo un administrador o un encargado cambia los ajustes del portal.' using errcode = '42501'; end if;
  if p_pagar_devuelto is null or not (p_pagar_devuelto <@ array['banco', 'tarjeta']::text[]) then
    raise exception 'Las formas de pagar un devuelto son «desde el banco» y «con tarjeta o Bizum».' using errcode = '22023';
  end if;
  insert into public.conta_portal_ajustes (account_id, pagar_devuelto, updated_at, updated_by_name)
  values (p_cuenta, (select coalesce(array_agg(distinct x order by x), '{}') from unnest(p_pagar_devuelto) x), now(), public.conta_nombre_actor())
  on conflict (account_id) do update set pagar_devuelto = excluded.pagar_devuelto, updated_at = now(), updated_by_name = excluded.updated_by_name;
  return jsonb_build_object('frase', case cardinality(p_pagar_devuelto) when 0 then 'Guardado: el cliente no paga los devueltos desde el portal.'
    else 'Guardado: el cliente puede pagar un devuelto ' || array_to_string(array(select case x when 'banco' then 'desde su banco' else 'con tarjeta o Bizum' end
      from unnest(p_pagar_devuelto) x order by x), ' o ') || '.' end);
end $$;

-- ── 15 · Lo que solo hace el servidor (clave de servicio) ─────────────────────

-- El usuario de una persona invitada (lo crea el servidor al mandar el enlace).
create or replace function public.conta_portal_acceso_usuario(p_acceso uuid, p_user uuid)
returns void language sql security definer set search_path = public as $$
  update public.conta_portal_acceso set user_id = p_user where id = p_acceso
$$;

-- Pedir un código de firma: devuelve el código UNA vez (para mandarlo); en la base, solo su huella.
create or replace function public.conta_portal_firma_pedir(p_user uuid, p_peticion uuid, p_canal text, p_destino text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q public.conta_portal_peticion; y public.conta_portal_acceso; v_id uuid := gen_random_uuid(); v_codigo text;
begin
  select * into q from public.conta_portal_peticion where id = p_peticion;
  if q.id is null or q.tipo <> 'firmar' or q.estado <> 'pendiente' then raise exception 'No hay nada que firmar ahí.' using errcode = '22023'; end if;
  select * into y from public.conta_portal_acceso where user_id = p_user and party_id = q.party_id and revocado_at is null and permiso = 'todo' limit 1;
  if y.id is null then raise exception 'No tienes acceso para firmar por este cliente.' using errcode = '42501'; end if;
  if p_canal not in ('correo', 'movil') then raise exception 'El código va al correo o al móvil.' using errcode = '22023'; end if;
  if (select count(*) from public.conta_portal_firma where peticion_id = q.id and acceso_id = y.id and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'Ya te hemos mandado tres códigos: espera unos minutos.' using errcode = '22023';
  end if;
  v_codigo := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000))::text, 6, '0');
  insert into public.conta_portal_firma (id, account_id, party_id, peticion_id, acceso_id, canal, destino, codigo_hash, expira_at)
  values (v_id, q.account_id, q.party_id, q.id, y.id, p_canal, p_destino,
          encode(extensions.digest(v_codigo || ':' || v_id::text, 'sha256'), 'hex'), now() + interval '10 minutes');
  return jsonb_build_object('firma_id', v_id, 'codigo', v_codigo, 'expira', now() + interval '10 minutes');
end $$;

-- Lo que contestó conta_recibo_parar (Code 1) para una incidencia «No estoy de acuerdo».
create or replace function public.conta_portal_incidencia_parada(p_incidencia uuid, p_parado boolean, p_frase text default null)
returns void language sql security definer set search_path = public as $$
  update public.conta_portal_incidencia set recibo_parado = p_parado,
         respuesta = case when not p_parado then coalesce(respuesta, left(p_frase, 500)) else respuesta end
   where id = p_incidencia and tipo = 'no_de_acuerdo'
$$;

-- El PDF firmado (con la página de la firma), ya subido.
create or replace function public.conta_portal_firma_pdf(p_firma uuid, p_ruta text, p_sha256 text)
returns void language sql security definer set search_path = public as $$
  update public.conta_portal_firma set pdf_ruta = p_ruta, pdf_sha256 = p_sha256 where id = p_firma and firmada_at is not null
$$;

-- ── 16 · RLS y permisos ────────────────────────────────────────────────────────
alter table public.conta_portal_acceso enable row level security;
alter table public.conta_portal_ajustes enable row level security;
alter table public.conta_portal_mensaje enable row level security;
alter table public.conta_portal_peticion enable row level security;
alter table public.conta_portal_firma enable row level security;
alter table public.conta_portal_incidencia enable row level security;
alter table public.conta_portal_subida enable row level security;
alter table public.conta_portal_operacion enable row level security;
alter table public.conta_portal_aviso enable row level security;

drop policy if exists conta_portal_acceso_leer on public.conta_portal_acceso;
create policy conta_portal_acceso_leer on public.conta_portal_acceso for select to authenticated
  using (public.belongs_to_account(account_id) or user_id = auth.uid() or public.conta_portal_ve(party_id, true));
drop policy if exists conta_portal_ajustes_leer on public.conta_portal_ajustes;
create policy conta_portal_ajustes_leer on public.conta_portal_ajustes for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_portal_mensaje_leer on public.conta_portal_mensaje;
create policy conta_portal_mensaje_leer on public.conta_portal_mensaje for select to authenticated
  using (public.belongs_to_account(account_id) or public.conta_portal_ve(party_id, true));
drop policy if exists conta_portal_peticion_leer on public.conta_portal_peticion;
create policy conta_portal_peticion_leer on public.conta_portal_peticion for select to authenticated
  using (public.belongs_to_account(account_id) or public.conta_portal_ve(party_id, true));
drop policy if exists conta_portal_firma_leer on public.conta_portal_firma;
create policy conta_portal_firma_leer on public.conta_portal_firma for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_portal_incidencia_leer on public.conta_portal_incidencia;
create policy conta_portal_incidencia_leer on public.conta_portal_incidencia for select to authenticated
  using (public.belongs_to_account(account_id) or public.conta_portal_ve(party_id, true));
drop policy if exists conta_portal_subida_leer on public.conta_portal_subida;
create policy conta_portal_subida_leer on public.conta_portal_subida for select to authenticated
  using (public.belongs_to_account(account_id) or public.conta_portal_ve(party_id));
drop policy if exists conta_portal_operacion_leer on public.conta_portal_operacion;
create policy conta_portal_operacion_leer on public.conta_portal_operacion for select to authenticated
  using (public.belongs_to_account(account_id) or public.conta_portal_ve(party_id, true));
drop policy if exists conta_portal_aviso_leer on public.conta_portal_aviso;
create policy conta_portal_aviso_leer on public.conta_portal_aviso for select to authenticated using (public.belongs_to_account(account_id));

revoke all on public.conta_portal_acceso, public.conta_portal_ajustes, public.conta_portal_mensaje, public.conta_portal_peticion,
  public.conta_portal_firma, public.conta_portal_incidencia, public.conta_portal_subida, public.conta_portal_operacion, public.conta_portal_aviso
  from anon, authenticated;
grant select on public.conta_portal_acceso, public.conta_portal_ajustes, public.conta_portal_mensaje, public.conta_portal_peticion,
  public.conta_portal_incidencia, public.conta_portal_subida, public.conta_portal_operacion, public.conta_portal_aviso to authenticated;
-- De la firma, la gestoría ve todo menos la huella del código.
grant select (id, account_id, party_id, peticion_id, acceso_id, canal, destino, expira_at, intentos, firmada_at, ip, navegador, pdf_ruta, pdf_sha256, created_at)
  on public.conta_portal_firma to authenticated;
grant all on public.conta_portal_acceso, public.conta_portal_ajustes, public.conta_portal_mensaje, public.conta_portal_peticion,
  public.conta_portal_firma, public.conta_portal_incidencia, public.conta_portal_subida, public.conta_portal_operacion, public.conta_portal_aviso
  to service_role;

-- Las funciones: las de leer y hacer, a authenticated; las de dentro y las del servidor, a nadie más.
revoke all on function public.conta_portal_ve(uuid, boolean), public._conta_portal_yo(uuid, boolean), public._conta_portal_empresa(uuid, uuid),
  public._conta_portal_marca(uuid, uuid), public._conta_portal_estado_recibo(text), public._conta_portal_devuelto_pagado(uuid),
  public._conta_portal_devueltos(uuid, uuid), public._conta_portal_proximo(uuid, uuid), public._conta_portal_cuenta_propia(uuid, uuid),
  public.conta_portal_entrada(), public.conta_portal_inicio(uuid), public.conta_portal_facturas(uuid), public.conta_portal_pagos(uuid),
  public.conta_portal_documentos(uuid), public.conta_portal_trabajadores(uuid), public.conta_portal_mensajes(uuid), public.conta_portal_cuenta(uuid),
  public.conta_portal_archivo(uuid, text, uuid, int), public.conta_portal_mensaje_enviar(uuid, text, jsonb), public.conta_portal_mensajes_leidos(uuid),
  public.conta_portal_solicitud_pedir(uuid, text, text, text, date, text, numeric, text), public.conta_portal_incidencia_crear(uuid, text, text, uuid),
  public.conta_portal_peticion_contestar(uuid, text), public.conta_portal_invitar(uuid, text, text, text), public.conta_portal_acceso_quitar(uuid),
  public.conta_portal_firma_comprobar(uuid, text, text, text), public.conta_portal_ficha(uuid), public.conta_portal_pendiente(uuid),
  public.conta_portal_peticion_crear(uuid, text, text, text, date, text), public.conta_portal_peticion_anular(uuid),
  public.conta_portal_incidencia_resolver(uuid, text), public.conta_portal_ajustes_guardar(uuid, text[]),
  public.conta_portal_acceso_usuario(uuid, uuid), public.conta_portal_firma_pedir(uuid, uuid, text, text), public.conta_portal_firma_pdf(uuid, text, text),
  public.conta_portal_incidencia_parada(uuid, boolean, text)
  from public, anon;
grant execute on function public.conta_portal_ve(uuid, boolean),
  public.conta_portal_entrada(), public.conta_portal_inicio(uuid), public.conta_portal_facturas(uuid), public.conta_portal_pagos(uuid),
  public.conta_portal_documentos(uuid), public.conta_portal_trabajadores(uuid), public.conta_portal_mensajes(uuid), public.conta_portal_cuenta(uuid),
  public.conta_portal_archivo(uuid, text, uuid, int), public.conta_portal_mensaje_enviar(uuid, text, jsonb), public.conta_portal_mensajes_leidos(uuid),
  public.conta_portal_solicitud_pedir(uuid, text, text, text, date, text, numeric, text), public.conta_portal_incidencia_crear(uuid, text, text, uuid),
  public.conta_portal_peticion_contestar(uuid, text), public.conta_portal_invitar(uuid, text, text, text), public.conta_portal_acceso_quitar(uuid),
  public.conta_portal_firma_comprobar(uuid, text, text, text), public.conta_portal_ficha(uuid), public.conta_portal_pendiente(uuid),
  public.conta_portal_peticion_crear(uuid, text, text, text, date, text), public.conta_portal_peticion_anular(uuid),
  public.conta_portal_incidencia_resolver(uuid, text), public.conta_portal_ajustes_guardar(uuid, text[])
  to authenticated;
grant execute on function public.conta_portal_acceso_usuario(uuid, uuid), public.conta_portal_firma_pedir(uuid, uuid, text, text),
  public.conta_portal_firma_pdf(uuid, text, text), public.conta_portal_incidencia_parada(uuid, boolean, text), public.conta_portal_archivo(uuid, text, uuid, int) to service_role;

-- ── 17 · El almacén conta-portal: <cuenta>/<cliente>/<mensajes|subidas|peticiones|firmas>/… ──
-- La gestoría lee y sube en las carpetas de su cuenta; la persona del portal,
-- solo en las de su cliente, y solo sube a mensajes y subidas. Nadie borra.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('conta-portal', 'conta-portal', false, 15728640,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create or replace function public.conta_portal_ruta_puede(p_ruta text, p_subir boolean default false)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_partes text[] := string_to_array(coalesce(p_ruta, ''), '/'); v_cuenta uuid; v_cliente uuid;
begin
  if array_length(v_partes, 1) < 4 or v_partes[1] !~ '^[0-9a-f-]{36}$' or v_partes[2] !~ '^[0-9a-f-]{36}$' then return false; end if;
  v_cuenta := v_partes[1]::uuid; v_cliente := v_partes[2]::uuid;
  if not exists (select 1 from public.party where id = v_cliente and account_id = v_cuenta) then return false; end if;
  if public.belongs_to_account(v_cuenta) then return v_partes[3] in ('mensajes', 'subidas', 'peticiones', 'firmas'); end if;
  if p_subir then
    return (v_partes[3] = 'mensajes' and public.conta_portal_ve(v_cliente, true)) or (v_partes[3] = 'subidas' and public.conta_portal_ve(v_cliente));
  end if;
  return (v_partes[3] = 'subidas' and public.conta_portal_ve(v_cliente)) or (v_partes[3] in ('mensajes', 'peticiones', 'firmas') and public.conta_portal_ve(v_cliente, true));
end $$;
revoke all on function public.conta_portal_ruta_puede(text, boolean) from public, anon;
grant execute on function public.conta_portal_ruta_puede(text, boolean) to authenticated;

drop policy if exists conta_portal_leer on storage.objects;
create policy conta_portal_leer on storage.objects for select to authenticated
  using (bucket_id = 'conta-portal' and public.conta_portal_ruta_puede(name, false));
drop policy if exists conta_portal_subir on storage.objects;
create policy conta_portal_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'conta-portal' and public.conta_portal_ruta_puede(name, true));
