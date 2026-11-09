-- supabase/migrations/20261109T1006_g05_cobro_base.sql
-- cambia: public.conta_gestoria_ajustes · prueba: supabase/staging/sql/20261109_g05_cobro_prueba.sql
-- cambia: public.conta_cobro_cliente · prueba: supabase/staging/sql/20261109_g05_cobro_prueba.sql
--
-- G05 · Tarea 3 · EL COBRO DEL MES Y SU FACTURA, la base. AÑADE tablas,
-- columnas que admiten nulos y funciones nuevas; y tres CHECK sobre columnas
-- nuevas de dos tablas que existen (conta_gestoria_ajustes, 0 filas, y
-- conta_cobro_cliente, 865: todas pasan porque la columna nace vacía), por eso
-- las dos van declaradas arriba. No cambia ninguna función que ya exista, y
-- se puede pasar dos veces seguidas. Nada en el
-- camino del pedido. Lo que cambia (el formato del número en la emisión de la
-- V01) va aparte, en la 1007.
--
-- El flujo (flujo_recibos_qbo.md; decisiones_qbo.md del 09/11; nº 28, 29 y 31):
--   1. Preparar: el SERVIDOR (conta-cobro) calcula el recibo de cada cliente
--      con los núcleos de _shared/cobro (el cálculo único del G04) y lo guarda
--      aquí (conta_cobro_guardar). Un recibo por empresa, cliente y mes, con
--      clave única: imposible cobrar dos veces. Lo que se cobra nunca viene del
--      navegador.
--   2. Revisar: los iguales se aprueban de una vez (conta_cobro_aprobar_iguales);
--      los que cambian, uno a uno (conta_cobro_decidir: aprobar o «este mes no»).
--   3. Enviar el cobro: conta-cobro manda a GoCardless cada aprobado, SOLO con
--      una conexión del entorno de pruebas (sandbox) mientras Julio no encienda
--      otra cosa, y lo apunta (conta_cobro_enviado).
--   4. Seguir: después de cada lectura de GoCardless (y de sus avisos al
--      instante, G01d), conta_cobro_seguir pone el estado de cada recibo y:
--        · cobro confirmado → la FACTURA (la de la V01: serie del emisor, número
--          sin huecos, asiento 430 / 705 + 477 y Verifactu) y el asiento del
--          cobro, 57200002 / 430, con la fecha del cobro y el concepto
--          «nº de factura-nombre»;
--        · devuelto o retrocedido con el cobro ya contabilizado → se deshace
--          (430 / 57200002) y vuelve a «Te deben». Sin cobro, no hay factura.
--      La factura se emite en nombre de quien pulsó «Enviar el cobro» (su
--      nombre queda en ella): la emisión de la V01 pide un administrador o
--      encargado de la cuenta, y el seguimiento no tiene sesión.
--   5. El ingreso de GoCardless en el banco (57200000 / 57200002) lo casa
--      Bancos (la conciliación de siempre); no está aquí.
--
-- Las subcuentas de cada empresa son ajustes (sin ponerlos, las de QBO: 430 +
-- código de 5 cifras, 70500000, 47700021, 4730, 57200002 y 57200000). La
-- comisión de GoCardless no se contabiliza aquí: llega en su factura mensual
-- (fuera del 17/11); mientras, se queda en la 57200002.
--
-- No lee ni escribe en GoCardless: eso lo hace conta-cobro, y solo en pruebas.
-- Vuelta atrás: supabase/vuelta-atras/20261109T1006_g05_cobro_base.down.sql

-- ── 1 · Los ajustes del cobro de cada empresa emisora ──────────────────────────
alter table public.conta_gestoria_ajustes add column if not exists precios_con_iva   boolean;
alter table public.conta_gestoria_ajustes add column if not exists iva_pct           numeric(5,2);
alter table public.conta_gestoria_ajustes add column if not exists retencion_pct     numeric(5,2);
alter table public.conta_gestoria_ajustes add column if not exists serie_cobro       text;
alter table public.conta_gestoria_ajustes add column if not exists dia_aviso         smallint;
alter table public.conta_gestoria_ajustes add column if not exists dia_cargo         smallint;
alter table public.conta_gestoria_ajustes add column if not exists prefijo_cliente   text;
alter table public.conta_gestoria_ajustes add column if not exists cuenta_ingresos   text;
alter table public.conta_gestoria_ajustes add column if not exists cuenta_iva        text;
alter table public.conta_gestoria_ajustes add column if not exists cuenta_retencion  text;
alter table public.conta_gestoria_ajustes add column if not exists cuenta_plataforma text;
alter table public.conta_gestoria_ajustes add column if not exists cuenta_banco      text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conta_gestoria_ajustes_retencion_pct') then
    alter table public.conta_gestoria_ajustes add constraint conta_gestoria_ajustes_retencion_pct check (retencion_pct is null or retencion_pct in (0, 7, 15));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conta_gestoria_ajustes_dias_cobro') then
    alter table public.conta_gestoria_ajustes add constraint conta_gestoria_ajustes_dias_cobro
      check ((dia_aviso is null or dia_aviso between 1 and 28) and (dia_cargo is null or dia_cargo between 1 and 28));
  end if;
end $$;
comment on column public.conta_gestoria_ajustes.precios_con_iva is 'G05 · Si los precios de la tarifa llevan el IVA dentro (QBO: sí, nº 31). Sin poner: sí.';
comment on column public.conta_gestoria_ajustes.retencion_pct is 'G05 · La retención de IRPF que aplica el emisor: 0, 15 o 7 (nº 31). Sin poner: 0.';
comment on column public.conta_gestoria_ajustes.serie_cobro is 'G05 · La serie de las facturas de los recibos (invoice_series.code). Sin poner: «1», la de QBO.';
comment on column public.conta_gestoria_ajustes.cuenta_plataforma is 'G05 · La cuenta puente de GoCardless (QBO: 57200002 «Plataforma GoCardless»).';
comment on column public.conta_gestoria_ajustes.cuenta_banco is 'G05 · El banco donde ingresa GoCardless (QBO: 57200000).';

-- El formato del número de una serie (lo lee la emisión desde la 1007): «{año}/{serie}/{número}» en QBO.
alter table public.invoice_series add column if not exists formato text;
comment on column public.invoice_series.formato is 'G05 · La plantilla del número: {año}, {aa}, {serie} y {número} (o {número:6}). QBO: «{año}/{serie}/{número}» (2026/1/2740). Sin poner: el de siempre de la V01.';

-- El código de cada cliente en su empresa: su subcuenta es 430 + código (cliente 827 → 43000827).
alter table public.conta_cobro_cliente add column if not exists codigo_cliente integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conta_cobro_cliente_codigo_cliente') then
    alter table public.conta_cobro_cliente add constraint conta_cobro_cliente_codigo_cliente check (codigo_cliente is null or codigo_cliente between 1 and 99999);
  end if;
end $$;
create unique index if not exists conta_cobro_cliente_codigo on public.conta_cobro_cliente (company_id, codigo_cliente) where codigo_cliente is not null;

-- ── 2 · El cobro de un mes y sus recibos ────────────────────────────────────────
create table if not exists public.conta_cobro_mes (
  company_id         uuid not null references public.company(id) on delete cascade,
  mes                text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  -- Los clientes que se cobran y este mes no tienen recibo (de baja, sin cuota…), con su porqué: «No entran».
  sin_recibo         jsonb not null default '[]'::jsonb,
  iguales_aprobados  boolean not null default false,
  aviso_el           date,
  cargo_el           date,
  preparado_at       timestamptz,
  preparado_por_name text,
  enviado_at         timestamptz,
  enviado_por_name   text,
  primary key (company_id, mes)
);
comment on table public.conta_cobro_mes is 'G05 · El cobro de un mes de una empresa emisora: cuándo se preparó y se envió, los días de aviso y de cargo, y los clientes que no entran.';

create table if not exists public.conta_recibo (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id) on delete cascade,
  company_id             uuid not null references public.company(id) on delete cascade,
  party_id               uuid not null references public.party(id),
  mes                    text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  clave                  text not null unique,
  lineas                 jsonb not null default '[]'::jsonb,
  total_cent             integer not null check (total_cent >= 0),
  anterior_cent          integer,
  anterior_de_gocardless boolean not null default false,
  cambios                jsonb not null default '[]'::jsonb,
  pide_clic              text,
  parado                 text[] not null default '{}',
  factura                jsonb,
  cobrar_cent            integer check (cobrar_cent is null or cobrar_cent > 0),
  decision               text not null default 'pendiente' check (decision in ('pendiente', 'aprobado', 'este_mes_no')),
  decidido_por_name      text,
  decidido_at            timestamptz,
  estado                 text not null default 'preparado'
                           check (estado in ('preparado', 'enviado', 'en_el_banco', 'cobrado', 'devuelto', 'retrocedido', 'cancelado', 'facturado')),
  entorno                text check (entorno in ('pruebas', 'real')),
  mandato_gc_id          text,
  gc_cobro_id            text,
  gc_estado              text,
  cargo_el               date,
  enviado_at             timestamptz,
  enviado_por            uuid,
  enviado_por_name       text,
  confirmado_el          date,
  invoice_id             uuid references public.customer_invoice(id),
  asiento_cobro          uuid,
  asiento_devolucion     uuid,
  preparado_at           timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (company_id, party_id, mes),
  constraint conta_recibo_clave_de_verdad check (clave = 'recibo:' || company_id::text || ':' || party_id::text || ':' || mes)
);
create unique index if not exists conta_recibo_gc_cobro on public.conta_recibo (company_id, gc_cobro_id) where gc_cobro_id is not null;
create index if not exists conta_recibo_mes on public.conta_recibo (account_id, company_id, mes);
comment on table public.conta_recibo is
  'G05 · El recibo del mes de un cliente con su empresa emisora: lo calcula el servidor (conta-cobro, con _shared/cobro), uno por empresa, cliente y mes (clave única, la misma que va a GoCardless). Lleva sus líneas, lo que cambia frente al mes anterior, la factura que tendrá y su cobro. Solo lo escriben las funciones del G05.';

create table if not exists public.conta_recibo_evento (
  id          uuid primary key default gen_random_uuid(),
  recibo_id   uuid not null references public.conta_recibo(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  company_id  uuid not null references public.company(id) on delete cascade,
  tipo        text not null,
  texto       text not null,
  detalle     jsonb,
  quien_name  text,
  cuando      timestamptz not null default now()
);
create index if not exists conta_recibo_evento_recibo on public.conta_recibo_evento (recibo_id, cuando);
comment on table public.conta_recibo_evento is 'G05 · Lo que le ha pasado a cada recibo, en palabras: preparado, aprobado, enviado, cobrado, facturado, devuelto…';

alter table public.conta_cobro_mes enable row level security;
alter table public.conta_recibo enable row level security;
alter table public.conta_recibo_evento enable row level security;
drop policy if exists conta_cobro_mes_leer on public.conta_cobro_mes;
create policy conta_cobro_mes_leer on public.conta_cobro_mes for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_recibo_leer on public.conta_recibo;
create policy conta_recibo_leer on public.conta_recibo for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_recibo_evento_leer on public.conta_recibo_evento;
create policy conta_recibo_evento_leer on public.conta_recibo_evento for select to authenticated using (public.belongs_to_account(account_id));
revoke insert, update, delete on public.conta_cobro_mes, public.conta_recibo, public.conta_recibo_evento from anon, authenticated;
revoke all on public.conta_cobro_mes, public.conta_recibo, public.conta_recibo_evento from anon;
grant select on public.conta_cobro_mes, public.conta_recibo, public.conta_recibo_evento to authenticated;
grant all on public.conta_cobro_mes, public.conta_recibo, public.conta_recibo_evento to service_role;

-- ── 3 · Piezas de dentro ─────────────────────────────────────────────────────────
create or replace function public._conta_cobro_evento(p_recibo uuid, p_tipo text, p_texto text, p_detalle jsonb default null, p_quien text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.conta_recibo_evento (recibo_id, account_id, company_id, tipo, texto, detalle, quien_name)
  select r.id, r.account_id, r.company_id, p_tipo, p_texto, p_detalle, p_quien from public.conta_recibo r where r.id = p_recibo
$$;

/** Los ajustes del cobro de una empresa, con los de QBO donde no hay nada puesto. */
create or replace function public._conta_cobro_ajustes(p_company uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'precios_con_iva', coalesce(a.precios_con_iva, true), 'iva_pct', coalesce(a.iva_pct, 21), 'retencion_pct', coalesce(a.retencion_pct, 0),
    'serie', coalesce(a.serie_cobro, '1'), 'dia_aviso', coalesce(a.dia_aviso, 2), 'dia_cargo', coalesce(a.dia_cargo, 4),
    'prefijo_cliente', coalesce(a.prefijo_cliente, '430'), 'cuenta_ingresos', coalesce(a.cuenta_ingresos, '70500000'),
    'cuenta_iva', coalesce(a.cuenta_iva, '47700021'), 'cuenta_retencion', coalesce(a.cuenta_retencion, '47300000'),
    'cuenta_plataforma', coalesce(a.cuenta_plataforma, '57200002'), 'cuenta_banco', coalesce(a.cuenta_banco, '57200000'))
  from (select 1) x left join public.conta_gestoria_ajustes a on a.company_id = p_company
$$;

/** La subcuenta de una empresa con su código exacto: si no está, se crea (con el plan de la empresa ya activado). */
create or replace function public._conta_cobro_cuenta(p_company uuid, p_code text, p_nombre text, p_quien text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_plan text; v_d int; v_hoja text;
begin
  select id into v_id from public.company_account where company_id = p_company and code = p_code;
  if v_id is not null then return v_id; end if;
  select a.plan, length(a.code) into v_plan, v_d from public.company_account a where a.company_id = p_company limit 1;
  if v_plan is null then
    raise exception 'El plan contable de % no está activado: actívalo en Contabilidad antes de facturar.',
      coalesce((select coalesce(trade_name, legal_name) from public.company where id = p_company), 'la empresa') using errcode = '23514';
  end if;
  if length(p_code) <> v_d then raise exception 'La subcuenta % no tiene las % cifras del plan de la empresa.', p_code, v_d using errcode = '23514'; end if;
  -- La hoja del plan de la que cuelga: la más larga que sea su principio y admita apuntes.
  select p.code into v_hoja from public.pgc_account p where p.plan = v_plan and p.is_leaf and p.valid_to is null and p_code like p.code || '%'
   order by length(p.code) desc limit 1;
  if v_hoja is null then raise exception 'La subcuenta % no cuelga de ninguna cuenta del plan.', p_code using errcode = '23514'; end if;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  values ((select account_id from public.company where id = p_company), p_company, v_plan, p_code, v_hoja, p_nombre, 'own', 'manual', p_quien)
  returning id into v_id;
  return v_id;
end $$;

/** El código de un cliente en su empresa (el suyo, o el siguiente libre) y su subcuenta 430 + código, enlazada al cliente. */
create or replace function public._conta_cobro_cuenta_cliente(p_company uuid, p_party uuid, p_quien text)
returns text language plpgsql security definer set search_path = public as $$
declare v_aj jsonb := public._conta_cobro_ajustes(p_company); v_cod int; v_d int; v_code text; v_nombre text; v_id uuid;
begin
  select codigo_cliente into v_cod from public.conta_cobro_cliente where company_id = p_company and party_id = p_party for update;
  if v_cod is null then
    perform pg_advisory_xact_lock(hashtext('conta_cobro_codigo:' || p_company::text));
    select coalesce(max(codigo_cliente), 0) + 1 into v_cod from public.conta_cobro_cliente where company_id = p_company;
    insert into public.conta_cobro_cliente (company_id, party_id, account_id, codigo_cliente, updated_by_name)
    values (p_company, p_party, (select account_id from public.company where id = p_company), v_cod, p_quien)
    on conflict (company_id, party_id) do update set codigo_cliente = excluded.codigo_cliente where public.conta_cobro_cliente.codigo_cliente is null;
  end if;
  select length(a.code) into v_d from public.company_account a where a.company_id = p_company limit 1;
  v_code := (v_aj->>'prefijo_cliente') || lpad(v_cod::text, coalesce(v_d, 8) - length(v_aj->>'prefijo_cliente'), '0');
  select name into v_nombre from public.party where id = p_party;
  v_id := public._conta_cobro_cuenta(p_company, v_code, coalesce(v_nombre, 'Cliente'), p_quien);
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values ((select account_id from public.company where id = p_company), p_company, v_id, 'customer', p_party::text, 'principal', 'manual')
  on conflict (company_id, entity, entity_id, role) do update set company_account_id = excluded.company_account_id;
  return v_code;
end $$;

/** El estado de un recibo según el de su cobro en GoCardless (el mismo que _shared/cobro/gocardless.ts · estadoDelRecibo). */
create or replace function public._conta_cobro_estado(p_gc text, p_facturado boolean)
returns text language sql immutable as $$
  select case
    when p_gc is null then 'preparado'
    when p_gc = 'charged_back' then 'retrocedido'
    when p_gc in ('failed', 'customer_approval_denied') then 'devuelto'
    when p_gc = 'cancelled' then 'cancelado'
    when p_gc in ('confirmed', 'paid_out') then case when p_facturado then 'facturado' else 'cobrado' end
    when p_gc = 'submitted' then 'en_el_banco'
    else 'enviado' end
$$;

/**
 * Hacer algo en nombre de una persona (la que pulsó «Enviar el cobro»): la
 * emisión de la V01 pide un administrador o encargado de la cuenta, y el
 * seguimiento no tiene sesión. Solo dentro de esta transacción; se deshace al
 * acabar (_conta_cobro_dejar).
 */
create or replace function public._conta_cobro_como(p_user uuid, p_account uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_antes jsonb := jsonb_build_object('claims', current_setting('request.jwt.claims', true), 'sub', current_setting('request.jwt.claim.sub', true),
                                            'cuenta', current_setting('folvy.cuenta_activa', true));
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('folvy.cuenta_activa', p_user::text || ':' || p_account::text, true);
  return v_antes;
end $$;
create or replace function public._conta_cobro_dejar(p_antes jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('request.jwt.claims', coalesce(p_antes->>'claims', ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(p_antes->>'sub', ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(p_antes->>'cuenta', ''), true);
end $$;

/** Un asiento validado con el motor de siempre: cabecera y líneas {cuenta, tercero_id, concepto, debe, haber}. */
create or replace function public._conta_cobro_asiento(p_company uuid, p_fecha date, p_concepto text, p_documento text, p_party uuid,
  p_source uuid, p_lineas jsonb, p_quien text, p_uid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_r jsonb; v_entry uuid; v_l jsonb := '[]'::jsonb; v_x jsonb;
begin
  for v_x in select * from jsonb_array_elements(p_lineas) loop
    v_l := v_l || jsonb_build_array(v_x || jsonb_build_object('documento', p_documento, 'comun', true));
  end loop;
  v_r := public._journal_entry_proponer(p_company,
    jsonb_build_object('series', 4, 'fecha', p_fecha, 'source_type', 'customer_invoice', 'source_id', p_source, 'concepto', p_concepto,
      'party_id', p_party, 'documento', p_documento, 'confianza', 'seguro', 'porque', 'Cobro de un recibo por GoCardless (G05).'),
    v_l, null, p_quien, p_uid);
  v_entry := (v_r->>'id')::uuid;
  perform public.journal_entry_validar(v_entry, p_quien);
  return v_entry;
end $$;

-- ── 4 · Lo que hace el servidor (conta-cobro), con la clave de servicio ─────────
/**
 * Guardar los recibos preparados de un mes (los calcula conta-cobro con
 * _shared/cobro). Solo se tocan los que siguen preparados: uno enviado no se
 * cambia nunca. Si un recibo cambia de importe, su decisión vuelve a
 * pendiente. Los preparados que ya no salen, se quitan.
 */
create or replace function public.conta_cobro_guardar(p_company uuid, p_mes text, p_recibos jsonb, p_sin_recibo jsonb, p_quien text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_x jsonb; v_n int := 0; v_ya int := 0; v_quitados int := 0; v_claves text[] := '{}'; v_r public.conta_recibo;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'El mes tiene que ser AAAA-MM.' using errcode = '22023'; end if;
  for v_x in select * from jsonb_array_elements(coalesce(p_recibos, '[]'::jsonb)) loop
    v_claves := v_claves || (v_x->>'clave');
    select * into v_r from public.conta_recibo where clave = v_x->>'clave' for update;
    if v_r.id is not null and v_r.estado <> 'preparado' then v_ya := v_ya + 1; continue; end if;
    insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, lineas, total_cent, anterior_cent, anterior_de_gocardless,
      cambios, pide_clic, parado, factura, cobrar_cent)
    values (v_cuenta, p_company, (v_x->>'party_id')::uuid, p_mes, v_x->>'clave', coalesce(v_x->'lineas', '[]'), (v_x->>'total_cent')::int,
      nullif(v_x->>'anterior_cent', '')::int, coalesce((v_x->>'anterior_de_gocardless')::boolean, false), coalesce(v_x->'cambios', '[]'),
      nullif(v_x->>'pide_clic', ''), coalesce(array(select jsonb_array_elements_text(v_x->'parado')), '{}'), v_x->'factura', nullif(v_x->>'cobrar_cent', '')::int)
    on conflict (clave) do update set lineas = excluded.lineas, total_cent = excluded.total_cent, anterior_cent = excluded.anterior_cent,
      anterior_de_gocardless = excluded.anterior_de_gocardless, cambios = excluded.cambios, pide_clic = excluded.pide_clic, parado = excluded.parado,
      factura = excluded.factura, cobrar_cent = excluded.cobrar_cent, updated_at = now(),
      decision = case when public.conta_recibo.total_cent <> excluded.total_cent or cardinality(excluded.parado) > 0 then 'pendiente' else public.conta_recibo.decision end
    where public.conta_recibo.estado = 'preparado';
    v_n := v_n + 1;
  end loop;
  with q as (delete from public.conta_recibo where company_id = p_company and mes = p_mes and estado = 'preparado' and not (clave = any (v_claves)) returning 1)
  select count(*) into v_quitados from q;
  insert into public.conta_cobro_mes (company_id, mes, account_id, sin_recibo, aviso_el, cargo_el, preparado_at, preparado_por_name)
  values (p_company, p_mes, v_cuenta, coalesce(p_sin_recibo, '[]'),
    (p_mes || '-' || lpad((public._conta_cobro_ajustes(p_company)->>'dia_aviso'), 2, '0'))::date,
    (p_mes || '-' || lpad((public._conta_cobro_ajustes(p_company)->>'dia_cargo'), 2, '0'))::date, now(), p_quien)
  on conflict (company_id, mes) do update set sin_recibo = excluded.sin_recibo, preparado_at = now(), preparado_por_name = excluded.preparado_por_name;
  return jsonb_build_object('guardados', v_n, 'ya_enviados', v_ya, 'quitados', v_quitados,
    'frase', case when v_n = 1 then format('Preparado 1 recibo de %s.', p_mes) else format('Preparados %s recibos de %s.', v_n, p_mes) end || case when v_ya > 0 then format(' %s ya estaban enviados y no se tocan.', v_ya) else '' end);
end $$;

/** Lo que conta-cobro manda a GoCardless: los aprobados, sin parar, con su mandato que cobra. */
create or replace function public.conta_cobro_para_enviar(p_company uuid, p_mes text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'clave', r.clave, 'party_id', r.party_id, 'cobrar_cent', r.cobrar_cent, 'total_cent', r.total_cent,
           'mandato_gc_id', m.gc_id, 'mandato_estado', m.estado, 'cargo_el', cm.cargo_el) order by r.clave), '[]'::jsonb)
    from public.conta_recibo r
    join public.conta_cobro_mes cm on cm.company_id = r.company_id and cm.mes = r.mes
    left join public.conta_cobro_cliente cc on cc.company_id = r.company_id and cc.party_id = r.party_id
    left join lateral (select x.gc_id, x.estado from public.conta_gc_mandato x
                        where x.company_id = r.company_id and x.gc_cliente_id = cc.gc_cliente_id
                          and x.estado in ('pending_customer_approval', 'pending_submission', 'submitted', 'active')
                        order by x.creado desc nulls last limit 1) m on true
   where r.company_id = p_company and r.mes = p_mes and r.estado = 'preparado' and r.decision = 'aprobado' and cardinality(r.parado) = 0
     and r.cobrar_cent is not null
$$;

/** Apuntar que un recibo se ha mandado a GoCardless (o que ya estaba: la misma clave). */
create or replace function public.conta_cobro_enviado(p_recibo uuid, p_gc_cobro text, p_gc_estado text, p_cargo_el date, p_mandato text,
  p_entorno text, p_por uuid, p_por_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.conta_recibo;
begin
  select * into v_r from public.conta_recibo where id = p_recibo for update;
  if v_r.id is null then raise exception 'Ese recibo no está.' using errcode = 'P0002'; end if;
  if v_r.gc_cobro_id is not null and v_r.gc_cobro_id <> p_gc_cobro then
    raise exception 'El recibo % ya tiene otro cobro en GoCardless (%).', v_r.clave, v_r.gc_cobro_id using errcode = '23505';
  end if;
  update public.conta_recibo set gc_cobro_id = p_gc_cobro, gc_estado = coalesce(p_gc_estado, 'pending_submission'), cargo_el = coalesce(p_cargo_el, cargo_el),
    mandato_gc_id = p_mandato, entorno = p_entorno, estado = public._conta_cobro_estado(coalesce(p_gc_estado, 'pending_submission'), false),
    enviado_at = coalesce(enviado_at, now()), enviado_por = coalesce(enviado_por, p_por), enviado_por_name = coalesce(enviado_por_name, p_por_name), updated_at = now()
   where id = p_recibo;
  -- El cobro, también en la lectura de GoCardless (la siguiente lectura lo pone al día).
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, mandato_gc_id, estado, fecha, importe, moneda)
  values (v_r.company_id, p_gc_cobro, v_r.account_id, p_mandato, coalesce(p_gc_estado, 'pending_submission'), p_cargo_el, v_r.cobrar_cent / 100.0, 'EUR')
  on conflict do nothing;
  perform public._conta_cobro_evento(p_recibo, 'enviado', format('Cobro de %s enviado a GoCardless%s.', public._conta_gestoria_euros(v_r.cobrar_cent / 100.0),
    case when p_cargo_el is not null then ', con cargo el ' || to_char(p_cargo_el, 'DD/MM/YYYY') else '' end), jsonb_build_object('cobro', p_gc_cobro, 'entorno', p_entorno), p_por_name);
  update public.conta_cobro_mes set enviado_at = coalesce(enviado_at, now()), enviado_por_name = coalesce(enviado_por_name, p_por_name)
   where company_id = v_r.company_id and mes = v_r.mes;
  return jsonb_build_object('id', p_recibo, 'estado', public._conta_cobro_estado(coalesce(p_gc_estado, 'pending_submission'), false));
end $$;

/** Apuntar por qué un recibo no se ha podido mandar (lo dice GoCardless, en palabras). */
create or replace function public.conta_cobro_no_enviado(p_recibo uuid, p_frase text, p_por_name text)
returns void language sql security definer set search_path = public as $$
  select public._conta_cobro_evento(p_recibo, 'no_enviado', p_frase, null, p_por_name)
$$;

-- ── 5 · La factura y los asientos, al confirmarse o deshacerse un cobro ─────────
create or replace function public._conta_cobro_facturar(p_recibo uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r public.conta_recibo; v_aj jsonb; v_antes jsonb; v_id uuid; v_g jsonb; v_e jsonb; v_numero text; v_fecha date; v_tipo uuid; v_ret uuid;
  v_705 uuid; v_lin jsonb := '[]'::jsonb; v_x jsonb; v_cli text; v_nombre text; v_pago uuid; v_entry uuid; v_total numeric;
begin
  select * into v_r from public.conta_recibo where id = p_recibo for update;
  if v_r.invoice_id is not null then return jsonb_build_object('ya', true, 'factura', v_r.invoice_id); end if;
  if v_r.gc_estado not in ('confirmed', 'paid_out') then raise exception 'Sin el cobro confirmado no hay factura.' using errcode = '23514'; end if;
  if v_r.enviado_por is null then raise exception 'No se sabe quién envió el cobro: la factura se emite en su nombre.' using errcode = '23514'; end if;
  v_aj := public._conta_cobro_ajustes(v_r.company_id);
  v_fecha := least(coalesce(v_r.confirmado_el, v_r.cargo_el, (now() at time zone 'Europe/Madrid')::date), (now() at time zone 'Europe/Madrid')::date);
  v_antes := public._conta_cobro_como(v_r.enviado_por, v_r.account_id);
  begin
    -- Las subcuentas que hacen falta, con su código exacto: 705, 477 (enlazada al IVA general), 430 + código del cliente y la puente.
    v_705 := public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_ingresos', 'Prestaciones de servicios', v_r.enviado_por_name);
    select id into v_tipo from public.tax_rate where is_system and code = 'iva_general' and rate = (v_aj->>'iva_pct')::numeric limit 1;
    if v_tipo is null then raise exception 'No encuentro el IVA general al % %%.', v_aj->>'iva_pct' using errcode = '23514'; end if;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (v_r.account_id, v_r.company_id, public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_iva', 'IVA repercutido ' || (v_aj->>'iva_pct') || ' %', v_r.enviado_por_name),
            'tax_rate', v_tipo::text, 'repercutido', 'manual')
    on conflict (company_id, entity, entity_id, role) do nothing;
    v_cli := public._conta_cobro_cuenta_cliente(v_r.company_id, v_r.party_id, v_r.enviado_por_name);
    perform public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_plataforma', 'Plataforma GoCardless', v_r.enviado_por_name);
    if (v_aj->>'retencion_pct')::numeric > 0 then
      perform public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_retencion', 'Hacienda Pública, retenciones y pagos a cuenta', v_r.enviado_por_name);
      select id into v_ret from public.withholding_rate where is_system and code = case when (v_aj->>'retencion_pct')::numeric = 7 then 'profesional_inicio' else 'profesional' end limit 1;
    end if;
    -- La factura de la V01, con las líneas que calculó el núcleo (cantidad × precio, la base sin IVA).
    for v_x in select * from jsonb_array_elements(v_r.factura->'lineas') loop
      v_lin := v_lin || jsonb_build_array(jsonb_build_object('concepto', v_x->>'concepto', 'cantidad', (v_x->>'cantidad')::numeric,
        'precio', (v_x->>'precioCent')::numeric / 100, 'descuento', 0, 'tipo_id', v_tipo, 'cuenta_id', v_705));
    end loop;
    v_g := public.conta_venta_guardar(v_r.company_id, null, jsonb_build_object('cliente_id', v_r.party_id, 'fecha', v_fecha, 'serie', v_aj->>'serie',
      'retencion_id', v_ret, 'notas', 'Recibo de ' || v_r.mes || ', cobrado por domiciliación SEPA (GoCardless).'), v_lin, v_r.enviado_por_name);
    v_id := (v_g->>'id')::uuid;
    v_total := (v_g->>'total')::numeric;
    -- Nunca una factura que no cuadra con su cobro.
    if round(v_total * 100) <> v_r.cobrar_cent then
      raise exception 'La factura saldría por % € y el cobro fue de % €: no se emite.', v_total, v_r.cobrar_cent / 100.0 using errcode = '23514';
    end if;
    v_e := public.conta_venta_emitir(v_id, v_r.enviado_por_name);
    select number_text into v_numero from public.customer_invoice where id = v_id;
    -- Cobrada: su cobro (sin asiento en la V01: no es en efectivo) y el asiento del G05, 57200002 / 430, con la fecha del cobro.
    perform public.conta_venta_cobrar(v_id, v_fecha, v_r.cobrar_cent / 100.0, 'GoCardless', 'Domiciliación SEPA ' || coalesce(v_r.gc_cobro_id, ''), v_r.enviado_por_name);
    select id into v_pago from public.customer_invoice_payment where invoice_id = v_id order by created_at desc limit 1;
    select name into v_nombre from public.party where id = v_r.party_id;
    v_entry := public._conta_cobro_asiento(v_r.company_id, v_fecha, v_numero || '-' || coalesce(v_nombre, 'Cliente'), v_numero, v_r.party_id, v_pago,
      jsonb_build_array(
        jsonb_build_object('cuenta', v_aj->>'cuenta_plataforma', 'concepto', v_numero || '-' || coalesce(v_nombre, 'Cliente'), 'debe', v_r.cobrar_cent / 100.0, 'haber', 0),
        jsonb_build_object('cuenta', v_cli, 'tercero_id', v_r.party_id, 'concepto', v_numero || '-' || coalesce(v_nombre, 'Cliente'), 'debe', 0, 'haber', v_r.cobrar_cent / 100.0)),
      v_r.enviado_por_name, v_r.enviado_por);
    update public.customer_invoice_payment set entry_id = v_entry where id = v_pago;
  exception when others then
    perform public._conta_cobro_dejar(v_antes);
    raise;
  end;
  perform public._conta_cobro_dejar(v_antes);
  update public.conta_recibo set invoice_id = v_id, asiento_cobro = v_entry, confirmado_el = v_fecha, estado = 'facturado', updated_at = now() where id = p_recibo;
  perform public._conta_cobro_evento(p_recibo, 'facturado', format('Cobrado el %s y facturado: %s.', to_char(v_fecha, 'DD/MM/YYYY'), v_numero),
    jsonb_build_object('factura', v_id, 'numero', v_numero, 'asiento', v_entry), v_r.enviado_por_name);
  return jsonb_build_object('factura', v_id, 'numero', v_numero, 'asiento', v_entry);
end $$;

/** Deshacer el cobro ya contabilizado de un recibo devuelto o retrocedido: 430 / 57200002, y vuelve a «Te deben». */
create or replace function public._conta_cobro_devolver(p_recibo uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.conta_recibo; v_aj jsonb; v_antes jsonb; v_cli text; v_numero text; v_nombre text; v_entry uuid; v_fecha date := (now() at time zone 'Europe/Madrid')::date;
  v_que text;
begin
  select * into v_r from public.conta_recibo where id = p_recibo for update;
  if v_r.asiento_cobro is null or v_r.asiento_devolucion is not null then return jsonb_build_object('nada', true); end if;
  v_aj := public._conta_cobro_ajustes(v_r.company_id);
  v_que := case when v_r.gc_estado = 'charged_back' then 'Retrocedido' else 'Devuelto' end;
  select number_text into v_numero from public.customer_invoice where id = v_r.invoice_id;
  select name into v_nombre from public.party where id = v_r.party_id;
  v_antes := public._conta_cobro_como(v_r.enviado_por, v_r.account_id);
  begin
    v_cli := public._conta_cobro_cuenta_cliente(v_r.company_id, v_r.party_id, v_r.enviado_por_name);
    v_entry := public._conta_cobro_asiento(v_r.company_id, v_fecha, v_que || ' ' || v_numero || '-' || coalesce(v_nombre, 'Cliente'), v_numero, v_r.party_id, v_r.id,
      jsonb_build_array(
        jsonb_build_object('cuenta', v_cli, 'tercero_id', v_r.party_id, 'concepto', v_que || ' ' || v_numero || '-' || coalesce(v_nombre, 'Cliente'), 'debe', v_r.cobrar_cent / 100.0, 'haber', 0),
        jsonb_build_object('cuenta', v_aj->>'cuenta_plataforma', 'concepto', v_que || ' ' || v_numero || '-' || coalesce(v_nombre, 'Cliente'), 'debe', 0, 'haber', v_r.cobrar_cent / 100.0)),
      v_r.enviado_por_name, v_r.enviado_por);
  exception when others then
    perform public._conta_cobro_dejar(v_antes);
    raise;
  end;
  perform public._conta_cobro_dejar(v_antes);
  update public.conta_recibo set asiento_devolucion = v_entry, updated_at = now() where id = p_recibo;
  perform public._conta_cobro_evento(p_recibo, 'devuelto',
    format('%s después de cobrarse: se deshace el cobro de la %s y pasa a «Te deben»; la factura se queda.', v_que, v_numero), jsonb_build_object('asiento', v_entry), null);
  return jsonb_build_object('asiento', v_entry);
end $$;

/**
 * Poner al día los recibos de una empresa con lo leído de GoCardless (lo
 * llama conta-gocardless-leer después de cada lectura, también la de los
 * avisos al instante). Cada recibo, aparte: si uno falla, los demás siguen, y
 * el fallo queda en su historial.
 */
create or replace function public.conta_cobro_seguir(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_x record; v_nuevo text; v_facturadas int := 0; v_deshechos int := 0; v_cambios int := 0; v_fallos int := 0; v_msg text;
begin
  for v_x in
    select r.id, r.estado, r.gc_estado, r.invoice_id, r.asiento_cobro, r.asiento_devolucion, b.estado as gc, b.fecha
      from public.conta_recibo r join public.conta_gc_cobro b on b.company_id = r.company_id and b.gc_id = r.gc_cobro_id
     where r.company_id = p_company and r.gc_cobro_id is not null
  loop
    if v_x.gc is distinct from v_x.gc_estado then
      v_nuevo := public._conta_cobro_estado(v_x.gc, v_x.invoice_id is not null);
      update public.conta_recibo set gc_estado = v_x.gc, estado = v_nuevo,
        confirmado_el = case when v_x.gc in ('confirmed', 'paid_out') then coalesce(confirmado_el, v_x.fecha) else confirmado_el end, updated_at = now()
       where id = v_x.id;
      perform public._conta_cobro_evento(v_x.id, v_nuevo, case v_nuevo
        when 'en_el_banco' then 'Cobro en el banco del cliente.'
        when 'cobrado' then 'Cobro confirmado.'
        when 'devuelto' then case when v_x.asiento_cobro is null then 'Devuelto sin fondos: pasa a «Te deben» y no tiene factura.' else 'Devuelto.' end
        when 'retrocedido' then 'Retrocedido: el cliente lo reclamó a su banco.'
        when 'cancelado' then 'Cancelado en GoCardless: no se ha cobrado.'
        else 'Enviado.' end, jsonb_build_object('gocardless', v_x.gc), null);
      v_cambios := v_cambios + 1;
    end if;
    begin
      if v_x.gc in ('confirmed', 'paid_out') and v_x.invoice_id is null then
        perform public._conta_cobro_facturar(v_x.id);
        v_facturadas := v_facturadas + 1;
      elsif v_x.gc in ('failed', 'charged_back') and v_x.asiento_cobro is not null and v_x.asiento_devolucion is null then
        perform public._conta_cobro_devolver(v_x.id);
        v_deshechos := v_deshechos + 1;
      end if;
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_fallos := v_fallos + 1;
      perform public._conta_cobro_evento(v_x.id, 'fallo', 'No se ha podido terminar: ' || v_msg, null, null);
    end;
  end loop;
  return jsonb_build_object('cambios', v_cambios, 'facturadas', v_facturadas, 'deshechos', v_deshechos, 'fallos', v_fallos);
end $$;

-- ── 6 · Lo que hace una persona, desde «Revisar el cobro» ───────────────────────
create or replace function public.conta_cobro_decidir(p_recibo uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.conta_recibo; v_quien text := public.conta_nombre_actor(); v_nombre text;
begin
  select * into v_r from public.conta_recibo where id = p_recibo for update;
  if v_r.id is null or not public.belongs_to_account(v_r.account_id) then raise exception 'Ese recibo no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_r.account_id) then raise exception 'Solo un administrador o un encargado decide el cobro.' using errcode = '42501'; end if;
  if p_decision not in ('pendiente', 'aprobado', 'este_mes_no') then raise exception 'Esa decisión no existe.' using errcode = '22023'; end if;
  if v_r.estado <> 'preparado' then raise exception 'Ese recibo ya se ha enviado: no se puede cambiar.' using errcode = '23514'; end if;
  if p_decision = 'aprobado' and cardinality(v_r.parado) > 0 then raise exception 'No se puede aprobar: %.', array_to_string(v_r.parado, '; ') using errcode = '23514'; end if;
  update public.conta_recibo set decision = p_decision, decidido_por_name = v_quien, decidido_at = now(), updated_at = now() where id = p_recibo;
  select name into v_nombre from public.party where id = v_r.party_id;
  perform public._conta_cobro_evento(p_recibo, p_decision, case p_decision when 'aprobado' then 'Aprobado.' when 'este_mes_no' then 'Este mes no se cobra.' else 'Vuelve a estar por revisar.' end, null, v_quien);
  return jsonb_build_object('frase', case p_decision
    when 'aprobado' then format('Aprobado el recibo de %s: %s.', coalesce(v_nombre, 'el cliente'), public._conta_gestoria_euros(coalesce(v_r.cobrar_cent, v_r.total_cent) / 100.0))
    when 'este_mes_no' then format('%s no se cobra este mes.', coalesce(v_nombre, 'El cliente'))
    else 'Vuelve a estar por revisar.' end);
end $$;

create or replace function public.conta_cobro_aprobar_iguales(p_company uuid, p_mes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_quien text := public.conta_nombre_actor(); v_n int; v_cent bigint;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then raise exception 'Solo un administrador o un encargado decide el cobro.' using errcode = '42501'; end if;
  with q as (
    update public.conta_recibo set decision = 'aprobado', decidido_por_name = v_quien, decidido_at = now(), updated_at = now()
     where company_id = p_company and mes = p_mes and estado = 'preparado' and decision = 'pendiente'
       and cambios = '[]'::jsonb and pide_clic is null and cardinality(parado) = 0
    returning coalesce(cobrar_cent, total_cent) as c)
  select count(*), coalesce(sum(c), 0) into v_n, v_cent from q;
  update public.conta_cobro_mes set iguales_aprobados = true where company_id = p_company and mes = p_mes;
  return jsonb_build_object('n', v_n, 'frase', case when v_n = 1 then format('Aprobado 1 recibo igual que el mes pasado: %s.', public._conta_gestoria_euros(v_cent / 100.0)) else format('Aprobados %s recibos iguales que el mes pasado: %s.', v_n, public._conta_gestoria_euros(v_cent / 100.0)) end);
end $$;

-- ── 7 · La pantalla «Revisar el cobro», en una sola lectura ──────────────────────
create or replace function public.conta_pantalla_cobro(p_cuenta uuid, p_company uuid, p_mes text)
returns jsonb language sql stable security definer set search_path = public as $$
  with permiso as (select p_cuenta as cuenta where public.belongs_to_account(p_cuenta))
  select jsonb_build_object(
    'mes', (select to_jsonb(m) - 'account_id' from public.conta_cobro_mes m where m.company_id = p_company and m.mes = p_mes and m.account_id = (select cuenta from permiso)),
    'ajustes', (select public._conta_cobro_ajustes(p_company) where exists (select 1 from public.company c where c.id = p_company and c.account_id = (select cuenta from permiso))),
    'conexion', (select jsonb_build_object('entorno', g.entorno) from public.conta_cobro_gocardless g where g.company_id = p_company and g.account_id = (select cuenta from permiso)),
    'recibos', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'cliente_id', r.party_id, 'cliente', p.name, 'clave', r.clave, 'lineas', r.lineas,
        'total_cent', r.total_cent, 'cobrar_cent', r.cobrar_cent, 'anterior_cent', r.anterior_cent, 'cambios', r.cambios, 'pide_clic', r.pide_clic,
        'parado', to_jsonb(r.parado), 'decision', r.decision, 'estado', r.estado, 'cargo_el', r.cargo_el, 'confirmado_el', r.confirmado_el,
        'factura', (select i.number_text from public.customer_invoice i where i.id = r.invoice_id), 'factura_id', r.invoice_id) order by p.name)
      from public.conta_recibo r join public.party p on p.id = r.party_id
     where r.company_id = p_company and r.mes = p_mes and r.account_id = (select cuenta from permiso)), '[]'::jsonb))
$$;

-- ── 8 · Quién puede llamar a qué ────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._conta_cobro_evento(uuid, text, text, jsonb, text)', 'public._conta_cobro_ajustes(uuid)', 'public._conta_cobro_cuenta(uuid, text, text, text)',
    'public._conta_cobro_cuenta_cliente(uuid, uuid, text)', 'public._conta_cobro_estado(text, boolean)', 'public._conta_cobro_como(uuid, uuid)',
    'public._conta_cobro_dejar(jsonb)', 'public._conta_cobro_asiento(uuid, date, text, text, uuid, uuid, jsonb, text, uuid)',
    'public._conta_cobro_facturar(uuid)', 'public._conta_cobro_devolver(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- Solo el servidor (conta-cobro y conta-gocardless-leer, con la clave de servicio).
  foreach f in array array[
    'public.conta_cobro_guardar(uuid, text, jsonb, jsonb, text)', 'public.conta_cobro_para_enviar(uuid, text)',
    'public.conta_cobro_enviado(uuid, text, text, date, text, text, uuid, text)', 'public.conta_cobro_no_enviado(uuid, text, text)',
    'public.conta_cobro_seguir(uuid)', 'public._conta_cobro_ajustes(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Una persona, desde la pantalla.
  foreach f in array array['public.conta_cobro_decidir(uuid, text)', 'public.conta_cobro_aprobar_iguales(uuid, text)', 'public.conta_pantalla_cobro(uuid, uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
