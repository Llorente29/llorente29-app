-- supabase/migrations/20261108T0930_g04_tarifa_y_clientes.sql
--
-- G04 · Tarea 3 (08/11/2026) · Clientes, ficha y «Tarifa y paquetes». SOLO
-- AÑADE: tablas nuevas, columnas que admiten nulos, funciones nuevas y vistas
-- nuevas. Lo importado en el G01 (conta_servicio, conta_tarifa, conta_linea)
-- queda como está: un servicio sin niveles, con su forma de cobro.
--
-- Todo lo que define una tarifa es dato (Julio, 07/11): servicios, niveles,
-- paquetes, formas de cobro, tramos y nombres. El cálculo del precio NO está
-- aquí: es uno solo, en supabase/functions/_shared/tarifa/precio.ts, y lo usan
-- la pantalla, las descargas y el recibo (G05). Las vistas dan los datos con
-- los que calcula, y las cifras de GoCardless (que hasta el G05 son las que
-- mandan: mandaEnLosCobros.ts).
--
--   1. conta_gestoria_ajustes: los ajustes de cobro de cada empresa. «Altas y
--      bajas a mitad de mes: mes entero / proporcional» (por defecto, mes
--      entero, lo de hoy) y si los cambios de tarifa están encendidos (por
--      defecto, NO: en la cuenta real de QBO, apagados hasta que Julio diga sí;
--      se prueban en la cuenta de pruebas, 06/11).
--   2. Niveles, paquetes (con sus líneas y su exceso), precios con su forma y
--      sus tramos (generales o de un cliente), paquetes de un cliente, el
--      cambio de precios guardado como operación (con sus líneas y lo que hizo,
--      para verlo después y deshacerlo) y «Cobrado por otra vía».
--   3. conta_linea: el nivel y el día del alta y de la baja (para lo
--      proporcional). conta_gc_suscripcion: el siguiente cobro (fecha e
--      importe), que guarda la lectura de GoCardless (Julio, 08/11).
--   4. Funciones con nombre, permiso y ensayo (asistente_sumied.md, regla 1).
--      Todas ensayan por defecto (p_ensayo = true) y solo escriben con
--      p_ensayo = false, una persona administradora o encargada, y los cambios
--      de tarifa encendidos en esa empresa. Cada una devuelve su frase (regla 8).
--   5. Vistas de consulta, con security_invoker y solo lectura, todas con
--      nombre nuevo: la lista (una fila por cliente y empresa), el próximo
--      cobro, los cargos devueltos, «Lo que tienes que hacer», los precios y lo
--      que tiene cada cliente.
--
-- No escribe nada en GoCardless ni en el CRM. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261108T0930_g04_tarifa_y_clientes.down.sql

-- ── 1 · Los ajustes de cobro de la gestoría ─────────────────────────────────
create table if not exists public.conta_gestoria_ajustes (
  company_id          uuid primary key references public.company(id) on delete cascade,
  account_id          uuid not null references public.accounts(id) on delete cascade,
  mitad_de_mes        text not null default 'mes_entero' check (mitad_de_mes in ('mes_entero', 'proporcional')),
  cambios_de_tarifa   boolean not null default false,
  updated_at          timestamptz not null default now(),
  updated_by_name     text
);
comment on table public.conta_gestoria_ajustes is
  'G04 · Los ajustes de cobro de cada empresa de una gestoría. mitad_de_mes: las altas y bajas a mitad de mes se cobran el mes entero (por defecto) o la parte proporcional. cambios_de_tarifa: si las acciones que cambian precios o servicios escriben (por defecto no: se prueban en la cuenta de pruebas hasta que Julio diga sí). Sin fila, lo de por defecto.';

-- ── 2 · Niveles, paquetes, precios, tramos, cambios ─────────────────────────
create table if not exists public.conta_servicio_nivel (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete cascade,
  servicio_id     uuid not null references public.conta_servicio(id) on delete cascade,
  nombre          text not null check (length(trim(nombre)) > 0),
  orden           integer not null default 1,
  incluye         text[] not null default '{}',
  mas_elegido     boolean not null default false,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by_name text,
  unique (servicio_id, nombre)
);
comment on table public.conta_servicio_nivel is 'G04 · Un nivel de un servicio (Básica, Estándar, Premium…), con su orden, lo que incluye y la marca «el más elegido». Su precio, en conta_precio.';

create table if not exists public.conta_paquete (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id) on delete cascade,
  company_id             uuid not null references public.company(id) on delete cascade,
  nombre                 text not null check (length(trim(nombre)) > 0),
  descripcion            text,
  exceso_por_trabajador  numeric check (exceso_por_trabajador is null or exceso_por_trabajador >= 0),
  activo                 boolean not null default true,
  created_at             timestamptz not null default now(),
  created_by_name        text,
  unique (company_id, nombre)
);
comment on table public.conta_paquete is 'G04 · Un paquete: varios servicios (o un nivel de un servicio) por un precio cerrado. exceso_por_trabajador: cada trabajador de más sobre el límite de una de sus líneas. Su precio, en conta_precio.';

create table if not exists public.conta_paquete_linea (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  paquete_id           uuid not null references public.conta_paquete(id) on delete cascade,
  servicio_id          uuid not null references public.conta_servicio(id) on delete restrict,
  nivel_id             uuid references public.conta_servicio_nivel(id) on delete restrict,
  limite_trabajadores  integer check (limite_trabajadores is null or limite_trabajadores >= 0),
  orden                integer not null default 1
);
comment on table public.conta_paquete_linea is 'G04 · Lo que incluye un paquete: un servicio o un nivel, con un límite de trabajadores opcional.';

create table if not exists public.conta_precio (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete cascade,
  servicio_id     uuid references public.conta_servicio(id) on delete cascade,
  nivel_id        uuid references public.conta_servicio_nivel(id) on delete cascade,
  paquete_id      uuid references public.conta_paquete(id) on delete cascade,
  party_id        uuid references public.party(id) on delete cascade,
  forma           text not null check (forma in ('fijo', 'por_trabajador', 'tramos', 'tramo_y_por_trabajador')),
  periodo         text check (periodo is null or periodo in ('mes', 'anio', 'vez')),
  importe         numeric check (importe is null or importe >= 0),
  desde           date not null check (extract(day from desde) = 1),
  hasta           date check (hasta is null or (extract(day from hasta) = 1 and hasta >= desde)),
  cambio_id       uuid,
  created_at      timestamptz not null default now(),
  created_by_name text,
  -- Un precio es de un servicio sin nivel, de un nivel (con su servicio) o de un paquete.
  check ((paquete_id is null) = (servicio_id is not null)),
  check (nivel_id is null or servicio_id is not null),
  check ((forma = 'fijo') = (periodo is not null)),
  check (forma not in ('fijo', 'por_trabajador') or importe is not null)
);
comment on table public.conta_precio is
  'G04 · Un precio, con su historia (de su mes «desde» a su mes «hasta», incluido): el general de la tarifa (sin cliente) o el de un cliente. Su forma: fijo (al mes, al año o por vez), por trabajador, por tramos o tramo y por trabajador (los tramos, en conta_precio_tramo). Los importados en el G01 siguen en conta_tarifa: conta_consulta_tarifa_precio los junta. cambio_id: el «Cambiar precios» que lo creó.';
create index if not exists conta_precio_empresa_idx on public.conta_precio (company_id, servicio_id, nivel_id, paquete_id, party_id);

create table if not exists public.conta_precio_tramo (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  precio_id   uuid not null references public.conta_precio(id) on delete cascade,
  desde       integer not null check (desde >= 0),
  hasta       integer check (hasta is null or hasta >= desde),
  importe     numeric not null check (importe >= 0),
  por_unidad  boolean not null default false
);
comment on table public.conta_precio_tramo is 'G04 · Un tramo de un precio: de cuántos a cuántos trabajadores, y su importe (el del tramo entero, o por cada unidad).';

create table if not exists public.conta_cliente_paquete (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete cascade,
  party_id        uuid not null references public.party(id) on delete cascade,
  paquete_id      uuid not null references public.conta_paquete(id) on delete restrict,
  desde           date not null check (extract(day from desde) = 1),
  hasta           date check (hasta is null or (extract(day from hasta) = 1 and hasta >= desde)),
  alta_el         date,
  baja_el         date,
  created_at      timestamptz not null default now(),
  created_by_name text,
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
comment on table public.conta_cliente_paquete is 'G04 · Un paquete que tiene un cliente con la empresa que le factura, de su mes «desde» a su mes «hasta». Los servicios sueltos siguen en conta_linea.';

create table if not exists public.conta_cambio_precios (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  company_id     uuid not null references public.company(id) on delete cascade,
  estado         text not null default 'ensayo' check (estado in ('ensayo', 'aplicado', 'deshecho')),
  operacion      jsonb not null,
  resultado      jsonb not null,
  frase          text not null,
  clientes       integer not null,
  antes          numeric not null,
  despues        numeric not null,
  desde          date not null check (extract(day from desde) = 1),
  huella         text not null,
  efectos        jsonb not null default '[]',
  ensayado_at    timestamptz not null default now(),
  ensayado_por   uuid,
  ensayado_por_name text,
  aplicado_at    timestamptz,
  aplicado_por_name text,
  deshecho_at    timestamptz,
  deshecho_por_name text
);
comment on table public.conta_cambio_precios is
  'G04 · Un «Cambiar precios» como operación: qué, a quién, cuánto y desde cuándo (operacion), el ensayo cliente a cliente (resultado y sus líneas en conta_cambio_precios_linea), la huella de los precios al ensayar (si cambian, hay que volver a ensayar) y lo que hizo al aplicarse (efectos), para deshacerlo.';

create table if not exists public.conta_cambio_precios_linea (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  cambio_id   uuid not null references public.conta_cambio_precios(id) on delete cascade,
  party_id    uuid references public.party(id) on delete set null,
  objetivo    jsonb not null,
  antes       numeric,
  despues     numeric,
  como        text not null check (como in ('tarifa', 'suyo', 'nuevo_suyo'))
);
comment on table public.conta_cambio_precios_linea is 'G04 · Cada cliente de un «Cambiar precios», con su precio de antes y el nuevo.';

create table if not exists public.conta_gc_cobro_otra_via (
  company_id   uuid not null references public.company(id) on delete cascade,
  gc_id        text not null,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  via          text not null check (via in ('transferencia', 'efectivo')),
  fecha        date not null,
  nota         text,
  quien        uuid,
  quien_name   text,
  cuando       timestamptz not null default now(),
  primary key (company_id, gc_id)
);
comment on table public.conta_gc_cobro_otra_via is 'G04 · «Cobrado por otra vía»: un cargo devuelto en GoCardless que se cobró por transferencia o en efectivo, con su fecha. Solo se guarda en Sumied (nada en GoCardless) y saca ese cargo de «Te deben».';

-- ── 3 · Columnas nuevas, que admiten nulos ──────────────────────────────────
alter table public.conta_linea add column if not exists nivel_id uuid references public.conta_servicio_nivel(id) on delete restrict;
alter table public.conta_linea add column if not exists alta_el date;
alter table public.conta_linea add column if not exists baja_el date;
comment on column public.conta_linea.nivel_id is 'G04 · El nivel del servicio, si tiene niveles.';
comment on column public.conta_linea.alta_el is 'G04 · El día del alta, si se sabe (para cobrar la parte proporcional).';
comment on column public.conta_linea.baja_el is 'G04 · El día de la baja, si se sabe (para cobrar la parte proporcional).';
alter table public.conta_gc_suscripcion add column if not exists proximo_cobro_fecha date;
alter table public.conta_gc_suscripcion add column if not exists proximo_cobro_importe numeric;
comment on column public.conta_gc_suscripcion.proximo_cobro_fecha is 'G04 · El siguiente cobro de la suscripción (upcoming_payments de GoCardless), de la última lectura.';
comment on column public.conta_gc_suscripcion.proximo_cobro_importe is 'G04 · El importe del siguiente cobro de la suscripción, de la última lectura.';

-- ── 4 · RLS: se lee con la cuenta; se escribe con las funciones ─────────────
do $$
declare t text;
begin
  foreach t in array array['conta_gestoria_ajustes', 'conta_servicio_nivel', 'conta_paquete', 'conta_paquete_linea', 'conta_precio',
                           'conta_precio_tramo', 'conta_cliente_paquete', 'conta_cambio_precios', 'conta_cambio_precios_linea',
                           'conta_gc_cobro_otra_via'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.belongs_to_account(account_id))', t || '_leer', t);
    if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
      execute format('grant select on table public.%I to conta_lectura', t);
    end if;
  end loop;
end $$;

-- ── 5 · Piezas de las funciones ─────────────────────────────────────────────
-- Quién puede, y si los cambios de tarifa están encendidos (solo para escribir).
create or replace function public._conta_tarifa_puede(p_company uuid, p_escribir boolean)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company);
begin
  if p_escribir and not coalesce((select cambios_de_tarifa from public.conta_gestoria_ajustes where company_id = p_company), false) then
    raise exception 'Los cambios de precios y de servicios aún no están encendidos en esta empresa. De momento se prueban en la cuenta de pruebas.' using errcode = '42501';
  end if;
  return v_cuenta;
end $$;
revoke all on function public._conta_tarifa_puede(uuid, boolean) from public, anon, authenticated;

create or replace function public._conta_tarifa_mes(p date)
returns date language sql immutable set search_path = public as $$ select date_trunc('month', p)::date $$;

-- La huella de los precios de una empresa: si cambia entre el ensayo y el aplicar, hay que volver a ensayar.
create or replace function public._conta_tarifa_huella(p_company uuid)
returns text language sql stable security definer set search_path = public as $$
  select md5(coalesce(string_agg(x, '|' order by x), ''))
  from (
    select 'tarifa:' || t.id || ':' || t.importe || ':' || t.periodo || ':' || t.desde || ':' || coalesce(t.hasta::text, '') x from public.conta_tarifa t where t.company_id = p_company
    union all
    select 'precio:' || p.id || ':' || p.forma || ':' || coalesce(p.periodo, '') || ':' || coalesce(p.importe::text, '') || ':' || p.desde || ':' || coalesce(p.hasta::text, '')
           || ':' || coalesce((select string_agg(r.desde || '-' || coalesce(r.hasta::text, '') || '-' || r.importe || '-' || r.por_unidad, ',' order by r.desde) from public.conta_precio_tramo r where r.precio_id = p.id), '')
      from public.conta_precio p where p.company_id = p_company
  ) q
$$;
revoke all on function public._conta_tarifa_huella(uuid) from public, anon, authenticated;

-- El nombre de un servicio, nivel o paquete, para las frases.
create or replace function public._conta_tarifa_nombre(p_servicio uuid, p_nivel uuid, p_paquete uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nombre from public.conta_paquete where id = p_paquete),
    (select s.nombre || coalesce(' · ' || n.nombre, '') from public.conta_servicio s left join public.conta_servicio_nivel n on n.id = p_nivel where s.id = p_servicio),
    'ese servicio')
$$;
revoke all on function public._conta_tarifa_nombre(uuid, uuid, uuid) from public, anon, authenticated;

-- Un precio guardado (con sus tramos), comprobado. Devuelve su id.
create or replace function public._conta_precio_insertar(p_cuenta uuid, p_company uuid, p_servicio uuid, p_nivel uuid, p_paquete uuid, p_party uuid,
  p_forma text, p_periodo text, p_importe numeric, p_tramos jsonb, p_desde date, p_hasta date, p_cambio uuid, p_quien text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_t jsonb; v_ant record; v_primero boolean := true;
begin
  if p_forma in ('tramos', 'tramo_y_por_trabajador') then
    if jsonb_typeof(p_tramos) <> 'array' or jsonb_array_length(p_tramos) = 0 then raise exception 'Faltan los tramos.' using errcode = '22023'; end if;
    for v_t in select value from jsonb_array_elements(p_tramos) order by (value->>'desde')::int loop
      if not v_primero then
        if v_ant.hasta is null then raise exception 'El tramo desde % no tiene final y hay otro después.', v_ant.desde using errcode = '22023'; end if;
        if (v_t->>'desde')::int <= v_ant.hasta then raise exception 'Los tramos que empiezan en % y en % se pisan.', v_ant.desde, v_t->>'desde' using errcode = '22023'; end if;
        if (v_t->>'desde')::int > v_ant.hasta + 1 then raise exception 'Entre % y % no hay tramo.', v_ant.hasta, v_t->>'desde' using errcode = '22023'; end if;
      end if;
      select (v_t->>'desde')::int as desde, nullif(v_t->>'hasta', '')::int as hasta into v_ant;
      v_primero := false;
    end loop;
  end if;
  insert into public.conta_precio (account_id, company_id, servicio_id, nivel_id, paquete_id, party_id, forma, periodo, importe, desde, hasta, cambio_id, created_by_name)
  values (p_cuenta, p_company, p_servicio, p_nivel, p_paquete, p_party, p_forma, case when p_forma = 'fijo' then coalesce(p_periodo, 'mes') end,
          case when p_forma in ('fijo', 'por_trabajador') then p_importe end, public._conta_tarifa_mes(p_desde), p_hasta, p_cambio, p_quien)
  returning id into v_id;
  if p_forma in ('tramos', 'tramo_y_por_trabajador') then
    insert into public.conta_precio_tramo (account_id, precio_id, desde, hasta, importe, por_unidad)
    select p_cuenta, v_id, (x->>'desde')::int, nullif(x->>'hasta', '')::int, (x->>'importe')::numeric, coalesce((x->>'porUnidad')::boolean, false)
      from jsonb_array_elements(p_tramos) x;
  end if;
  return v_id;
end $$;
revoke all on function public._conta_precio_insertar(uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, jsonb, date, date, uuid, text) from public, anon, authenticated;

-- ── 6 · Las acciones ────────────────────────────────────────────────────────

-- Ajustes › «Altas y bajas a mitad de mes».
create or replace function public.conta_gestoria_ajustes_guardar(p_company uuid, p_mitad_de_mes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company);
begin
  if p_mitad_de_mes not in ('mes_entero', 'proporcional') then raise exception 'Elige «el mes entero» o «la parte proporcional».' using errcode = '22023'; end if;
  insert into public.conta_gestoria_ajustes (company_id, account_id, mitad_de_mes, updated_by_name)
  values (p_company, v_cuenta, p_mitad_de_mes, public.conta_nombre_actor())
  on conflict (company_id) do update set mitad_de_mes = excluded.mitad_de_mes, updated_at = now(), updated_by_name = excluded.updated_by_name;
  return jsonb_build_object('frase', case p_mitad_de_mes when 'mes_entero'
    then 'Guardado: las altas y bajas a mitad de mes se cobran el mes entero.'
    else 'Guardado: las altas y bajas a mitad de mes se cobran por los días de alta.' end);
end $$;

-- «+ Crear › Nivel» o cambiar uno: nombre, orden, lo que incluye y «el más elegido».
create or replace function public.conta_tarifa_nivel_guardar(p_company uuid, p_servicio uuid, p_nivel uuid, p_nombre text, p_orden integer, p_incluye text[], p_mas_elegido boolean, p_ensayo boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_tarifa_puede(p_company, not p_ensayo); v_serv text; v_id uuid := p_nivel; v_frase text;
begin
  select nombre into v_serv from public.conta_servicio where id = p_servicio and company_id = p_company;
  if v_serv is null then raise exception 'Ese servicio no es de esta empresa.' using errcode = 'P0002'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Ponle un nombre al nivel.' using errcode = '22023'; end if;
  if p_nivel is not null and not exists (select 1 from public.conta_servicio_nivel where id = p_nivel and servicio_id = p_servicio) then
    raise exception 'Ese nivel no es de ese servicio.' using errcode = 'P0002';
  end if;
  v_frase := format('%s · %s%s.', v_serv, trim(p_nombre), case when p_mas_elegido then ', marcado como el más elegido' else '' end);
  if p_ensayo then return jsonb_build_object('ensayo', true, 'frase', (case when p_nivel is null then 'Se creará el nivel ' else 'Se cambiará el nivel ' end) || v_frase); end if;
  if p_mas_elegido then update public.conta_servicio_nivel set mas_elegido = false where servicio_id = p_servicio and id is distinct from p_nivel; end if;
  if p_nivel is null then
    insert into public.conta_servicio_nivel (account_id, company_id, servicio_id, nombre, orden, incluye, mas_elegido, created_by_name)
    values (v_cuenta, p_company, p_servicio, trim(p_nombre), coalesce(p_orden, 1), coalesce(p_incluye, '{}'), coalesce(p_mas_elegido, false), public.conta_nombre_actor())
    returning id into v_id;
  else
    update public.conta_servicio_nivel set nombre = trim(p_nombre), orden = coalesce(p_orden, orden), incluye = coalesce(p_incluye, incluye), mas_elegido = coalesce(p_mas_elegido, false) where id = p_nivel;
  end if;
  return jsonb_build_object('id', v_id, 'frase', (case when p_nivel is null then 'Creado el nivel ' else 'Cambiado el nivel ' end) || v_frase);
end $$;

-- «+ Crear › Paquete» o cambiar uno: lo que incluye (servicio o nivel, con su límite) y el exceso.
create or replace function public.conta_tarifa_paquete_guardar(p_company uuid, p_paquete uuid, p_nombre text, p_descripcion text, p_exceso numeric, p_lineas jsonb, p_ensayo boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_tarifa_puede(p_company, not p_ensayo); v_id uuid := p_paquete; v_l jsonb; v_n int; v_frase text;
begin
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Ponle un nombre al paquete.' using errcode = '22023'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'Un paquete incluye al menos un servicio.' using errcode = '22023'; end if;
  if p_paquete is not null and not exists (select 1 from public.conta_paquete where id = p_paquete and company_id = p_company) then
    raise exception 'Ese paquete no es de esta empresa.' using errcode = 'P0002';
  end if;
  for v_l in select value from jsonb_array_elements(p_lineas) loop
    if not exists (select 1 from public.conta_servicio where id = (v_l->>'servicio')::uuid and company_id = p_company) then
      raise exception 'Un servicio del paquete no es de esta empresa.' using errcode = 'P0002';
    end if;
    if v_l->>'nivel' is not null and not exists (select 1 from public.conta_servicio_nivel where id = (v_l->>'nivel')::uuid and servicio_id = (v_l->>'servicio')::uuid) then
      raise exception 'Un nivel del paquete no es de su servicio.' using errcode = 'P0002';
    end if;
  end loop;
  v_n := jsonb_array_length(p_lineas);
  v_frase := format('«%s», con %s %s%s.', trim(p_nombre), v_n, case when v_n = 1 then 'servicio' else 'servicios' end,
    case when p_exceso is not null then format('; cada trabajador de más, %s', public._conta_gestoria_euros(p_exceso)) else '' end);
  if p_ensayo then return jsonb_build_object('ensayo', true, 'frase', (case when p_paquete is null then 'Se creará el paquete ' else 'Se cambiará el paquete ' end) || v_frase); end if;
  if p_paquete is null then
    insert into public.conta_paquete (account_id, company_id, nombre, descripcion, exceso_por_trabajador, created_by_name)
    values (v_cuenta, p_company, trim(p_nombre), nullif(trim(coalesce(p_descripcion, '')), ''), p_exceso, public.conta_nombre_actor()) returning id into v_id;
  else
    update public.conta_paquete set nombre = trim(p_nombre), descripcion = nullif(trim(coalesce(p_descripcion, '')), ''), exceso_por_trabajador = p_exceso where id = p_paquete;
    delete from public.conta_paquete_linea where paquete_id = p_paquete;
  end if;
  insert into public.conta_paquete_linea (account_id, paquete_id, servicio_id, nivel_id, limite_trabajadores, orden)
  select v_cuenta, v_id, (x->>'servicio')::uuid, (x->>'nivel')::uuid, nullif(x->>'limiteTrabajadores', '')::int, o::int
    from jsonb_array_elements(p_lineas) with ordinality as e(x, o);
  return jsonb_build_object('id', v_id, 'frase', (case when p_paquete is null then 'Creado el paquete ' else 'Cambiado el paquete ' end) || v_frase);
end $$;

-- Un precio desde un mes: el general (sin cliente) o «Poner precio especial» (con cliente).
-- El que valía para el mismo dueño acaba el mes anterior.
create or replace function public.conta_tarifa_precio_guardar(p_company uuid, p_servicio uuid, p_nivel uuid, p_paquete uuid, p_party uuid,
  p_forma text, p_periodo text, p_importe numeric, p_tramos jsonb, p_desde date, p_ensayo boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_tarifa_puede(p_company, not p_ensayo); v_mes date := public._conta_tarifa_mes(p_desde);
        v_nombre text; v_cliente text; v_quien text := public.conta_nombre_actor(); v_id uuid; v_acaba int := 0; v_frase text; v_como text;
begin
  if v_mes is null then raise exception 'Di desde qué mes vale el precio.' using errcode = '22023'; end if;
  if p_forma not in ('fijo', 'por_trabajador', 'tramos', 'tramo_y_por_trabajador') then raise exception 'Esa forma de cobro no existe.' using errcode = '22023'; end if;
  if p_forma in ('fijo', 'por_trabajador') and (p_importe is null or p_importe < 0) then raise exception 'El importe tiene que ser cero o más.' using errcode = '22023'; end if;
  if (p_paquete is null) = (p_servicio is null) then raise exception 'Di si el precio es de un servicio o de un paquete.' using errcode = '22023'; end if;
  if p_servicio is not null and not exists (select 1 from public.conta_servicio where id = p_servicio and company_id = p_company) then raise exception 'Ese servicio no es de esta empresa.' using errcode = 'P0002'; end if;
  if p_nivel is not null and not exists (select 1 from public.conta_servicio_nivel where id = p_nivel and servicio_id = p_servicio) then raise exception 'Ese nivel no es de ese servicio.' using errcode = 'P0002'; end if;
  if p_paquete is not null and not exists (select 1 from public.conta_paquete where id = p_paquete and company_id = p_company) then raise exception 'Ese paquete no es de esta empresa.' using errcode = 'P0002'; end if;
  if p_party is not null then
    select name into v_cliente from public.party where id = p_party and account_id = v_cuenta;
    if v_cliente is null then raise exception 'Ese cliente no es de esta cuenta.' using errcode = 'P0002'; end if;
  end if;
  v_nombre := public._conta_tarifa_nombre(p_servicio, p_nivel, p_paquete);
  v_como := case p_forma
    when 'fijo' then public._conta_gestoria_euros(p_importe) || case coalesce(p_periodo, 'mes') when 'anio' then ' al año' when 'vez' then ' cada vez' else ' al mes' end
    when 'por_trabajador' then public._conta_gestoria_euros(p_importe) || ' por trabajador'
    else jsonb_array_length(p_tramos) || ' tramos' end;
  v_frase := format('%s%s: %s desde %s de %s.', v_nombre, case when p_party is null then ' (precio de tarifa)' else format(' para %s', v_cliente) end,
    v_como, public._conta_gestoria_mes(v_mes), extract(year from v_mes));
  if p_ensayo then return jsonb_build_object('ensayo', true, 'frase', 'Se guardará ' || v_frase); end if;
  -- El que valía para el mismo dueño, del mismo servicio, nivel o paquete, acaba el mes anterior.
  update public.conta_precio set hasta = (v_mes - interval '1 month')::date
   where company_id = p_company and servicio_id is not distinct from p_servicio and nivel_id is not distinct from p_nivel and paquete_id is not distinct from p_paquete
     and party_id is not distinct from p_party and desde < v_mes and (hasta is null or hasta >= v_mes);
  get diagnostics v_acaba = row_count;
  delete from public.conta_precio
   where company_id = p_company and servicio_id is not distinct from p_servicio and nivel_id is not distinct from p_nivel and paquete_id is not distinct from p_paquete
     and party_id is not distinct from p_party and desde = v_mes;
  if p_servicio is not null and p_nivel is null then
    update public.conta_tarifa set hasta = (v_mes - interval '1 month')::date
     where company_id = p_company and servicio_id = p_servicio and party_id is not distinct from p_party and desde < v_mes and (hasta is null or hasta >= v_mes);
  end if;
  v_id := public._conta_precio_insertar(v_cuenta, p_company, p_servicio, p_nivel, p_paquete, p_party, p_forma, p_periodo, p_importe, p_tramos, v_mes, null, null, v_quien);
  return jsonb_build_object('id', v_id, 'frase', 'Guardado ' || v_frase);
end $$;

-- «+ Añadir» en la ficha: un servicio (o un nivel) o un paquete, desde un mes; con precio de tarifa o uno suyo.
create or replace function public.conta_tarifa_servicio_anadir(p_company uuid, p_party uuid, p_servicio uuid, p_nivel uuid, p_paquete uuid, p_desde date,
  p_precio jsonb default null, p_ensayo boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_tarifa_puede(p_company, not p_ensayo); v_mes date := public._conta_tarifa_mes(p_desde);
        v_cliente text; v_nombre text; v_id uuid; v_frase text; v_quien text := public.conta_nombre_actor();
begin
  if v_mes is null then raise exception 'Di desde qué mes se le cobra.' using errcode = '22023'; end if;
  select name into v_cliente from public.party where id = p_party and account_id = v_cuenta;
  if v_cliente is null then raise exception 'Ese cliente no es de esta cuenta.' using errcode = 'P0002'; end if;
  if (p_paquete is null) = (p_servicio is null) then raise exception 'Elige un servicio o un paquete.' using errcode = '22023'; end if;
  if p_servicio is not null and not exists (select 1 from public.conta_servicio where id = p_servicio and company_id = p_company) then raise exception 'Ese servicio no es de esta empresa.' using errcode = 'P0002'; end if;
  if p_nivel is not null and not exists (select 1 from public.conta_servicio_nivel where id = p_nivel and servicio_id = p_servicio) then raise exception 'Ese nivel no es de ese servicio.' using errcode = 'P0002'; end if;
  if p_nivel is null and p_servicio is not null and exists (select 1 from public.conta_servicio_nivel where servicio_id = p_servicio and activo) then
    raise exception 'Ese servicio tiene niveles: elige uno.' using errcode = '22023';
  end if;
  if p_paquete is not null and not exists (select 1 from public.conta_paquete where id = p_paquete and company_id = p_company) then raise exception 'Ese paquete no es de esta empresa.' using errcode = 'P0002'; end if;
  v_nombre := public._conta_tarifa_nombre(p_servicio, p_nivel, p_paquete);
  v_frase := format('%s para %s desde %s de %s, %s.', v_nombre, v_cliente, public._conta_gestoria_mes(v_mes), extract(year from v_mes),
    case when p_precio is null then 'a precio de tarifa' else 'con un precio suyo' end);
  if p_ensayo then return jsonb_build_object('ensayo', true, 'frase', 'Se añadirá ' || v_frase); end if;
  if p_paquete is not null then
    insert into public.conta_cliente_paquete (account_id, company_id, party_id, paquete_id, desde, created_by_name, updated_by_name)
    values (v_cuenta, p_company, p_party, p_paquete, v_mes, v_quien, v_quien) returning id into v_id;
  else
    insert into public.conta_linea (account_id, company_id, party_id, servicio_id, nivel_id, tipo, origen, periodo, desde, created_by_name, updated_by_name)
    values (v_cuenta, p_company, p_party, p_servicio, p_nivel, 'cuota', 'manual', 'mes', v_mes, v_quien, v_quien) returning id into v_id;
  end if;
  if p_precio is not null then
    perform public.conta_tarifa_precio_guardar(p_company, p_servicio, p_nivel, p_paquete, p_party, p_precio->>'forma', p_precio->>'periodo',
      (p_precio->>'importe')::numeric, p_precio->'tramos', v_mes, false);
  end if;
  return jsonb_build_object('id', v_id, 'frase', 'Añadido ' || v_frase);
end $$;

-- «Cambiar de nivel» en la ficha: la línea acaba el mes anterior y sigue con el nivel nuevo.
create or replace function public.conta_tarifa_nivel_cambiar(p_linea uuid, p_nivel uuid, p_desde date, p_ensayo boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l public.conta_linea; v_mes date := public._conta_tarifa_mes(p_desde); v_cuenta uuid; v_cliente text; v_de text; v_a text; v_id uuid; v_frase text;
        v_quien text := public.conta_nombre_actor();
begin
  select * into v_l from public.conta_linea where id = p_linea;
  if v_l.id is null then raise exception 'Esa línea no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public._conta_tarifa_puede(v_l.company_id, not p_ensayo);
  if not exists (select 1 from public.conta_servicio_nivel where id = p_nivel and servicio_id = v_l.servicio_id) then raise exception 'Ese nivel no es del servicio de la línea.' using errcode = 'P0002'; end if;
  if p_nivel is not distinct from v_l.nivel_id then raise exception 'Ya está en ese nivel.' using errcode = '22023'; end if;
  if v_mes is null or v_mes <= v_l.desde then raise exception 'El cambio de nivel va desde un mes posterior al alta (%).', public._conta_gestoria_mes(v_l.desde) using errcode = '22023'; end if;
  if v_l.hasta is not null and v_l.hasta < v_mes then raise exception 'La línea ya está de baja ese mes.' using errcode = '22023'; end if;
  select name into v_cliente from public.party where id = v_l.party_id;
  v_de := public._conta_tarifa_nombre(v_l.servicio_id, v_l.nivel_id, null);
  v_a := public._conta_tarifa_nombre(v_l.servicio_id, p_nivel, null);
  v_frase := format('%s pasa de %s a %s desde %s de %s.', v_cliente, v_de, v_a, public._conta_gestoria_mes(v_mes), extract(year from v_mes));
  if p_ensayo then return jsonb_build_object('ensayo', true, 'frase', v_frase); end if;
  update public.conta_linea set hasta = (v_mes - interval '1 month')::date, updated_at = now(), updated_by_name = v_quien where id = p_linea;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, nivel_id, tipo, detalle, empleado_nombre, employee_id, origen, importe_propio, periodo, desde, hasta, created_by_name, updated_by_name)
  values (v_l.account_id, v_l.company_id, v_l.party_id, v_l.servicio_id, p_nivel, v_l.tipo, v_l.detalle, v_l.empleado_nombre, v_l.employee_id, 'manual', v_l.importe_propio, v_l.periodo, v_mes, v_l.hasta, v_quien, v_quien)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'frase', v_frase);
end $$;

-- «Cambiar precios», paso 1: guarda el ensayo (lo calcula cambioPrecios.ts, el mismo núcleo que la pantalla) con la huella de los precios.
-- p_resultado: { lineas: [{clienteId, objetivo, antesCent, despuesCent, como}], guardar: { nuevos: [...], acabanAntes: ['precio:<id>' | 'tarifa:<id>'] },
--                clientes, antesCent, despuesCent, frase }
create or replace function public.conta_tarifa_cambio_ensayar(p_company uuid, p_operacion jsonb, p_resultado jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_tarifa_puede(p_company, false); v_id uuid; v_desde date := public._conta_tarifa_mes((p_operacion->>'desde' || '-01')::date);
        v_ref text; v_n jsonb;
begin
  if v_desde is null then raise exception 'Di desde qué mes cambian los precios.' using errcode = '22023'; end if;
  for v_ref in select jsonb_array_elements_text(coalesce(p_resultado->'guardar'->'acabanAntes', '[]')) loop
    if not ((split_part(v_ref, ':', 1) = 'precio' and exists (select 1 from public.conta_precio where id = split_part(v_ref, ':', 2)::uuid and company_id = p_company))
         or (split_part(v_ref, ':', 1) = 'tarifa' and exists (select 1 from public.conta_tarifa where id = split_part(v_ref, ':', 2)::uuid and company_id = p_company))) then
      raise exception 'Un precio del ensayo no es de esta empresa.' using errcode = 'P0002';
    end if;
  end loop;
  for v_n in select value from jsonb_array_elements(coalesce(p_resultado->'guardar'->'nuevos', '[]')) loop
    if v_n->>'empresaId' is distinct from p_company::text then raise exception 'Un precio nuevo del ensayo no es de esta empresa.' using errcode = 'P0002'; end if;
    if v_n->>'clienteId' is not null and not exists (select 1 from public.party where id = (v_n->>'clienteId')::uuid and account_id = v_cuenta) then
      raise exception 'Un cliente del ensayo no es de esta cuenta.' using errcode = 'P0002';
    end if;
  end loop;
  insert into public.conta_cambio_precios (account_id, company_id, operacion, resultado, frase, clientes, antes, despues, desde, huella, ensayado_por, ensayado_por_name)
  values (v_cuenta, p_company, p_operacion, p_resultado, coalesce(p_resultado->>'frase', ''), coalesce((p_resultado->>'clientes')::int, 0),
          coalesce((p_resultado->>'antesCent')::numeric, 0) / 100, coalesce((p_resultado->>'despuesCent')::numeric, 0) / 100, v_desde,
          public._conta_tarifa_huella(p_company), auth.uid(), public.conta_nombre_actor())
  returning id into v_id;
  insert into public.conta_cambio_precios_linea (account_id, cambio_id, party_id, objetivo, antes, despues, como)
  select v_cuenta, v_id, (x->>'clienteId')::uuid, x->'objetivo', (x->>'antesCent')::numeric / 100, (x->>'despuesCent')::numeric / 100, x->>'como'
    from jsonb_array_elements(coalesce(p_resultado->'lineas', '[]')) x
   where exists (select 1 from public.party where id = (x->>'clienteId')::uuid and account_id = v_cuenta);
  return jsonb_build_object('id', v_id, 'ensayo', true, 'frase', coalesce(p_resultado->>'frase', ''));
end $$;

-- «Cambiar precios», paso 2: aplica exactamente lo ensayado, si los precios no han cambiado desde el ensayo.
create or replace function public.conta_tarifa_cambio_aplicar(p_cambio uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.conta_cambio_precios; v_ref text; v_n jsonb; v_efectos jsonb := '[]'; v_hasta date; v_id uuid; v_quien text := public.conta_nombre_actor();
begin
  select * into v_c from public.conta_cambio_precios where id = p_cambio for update;
  if v_c.id is null then raise exception 'Ese cambio de precios no existe.' using errcode = 'P0002'; end if;
  perform public._conta_tarifa_puede(v_c.company_id, true);
  if v_c.estado <> 'ensayo' then raise exception 'Ese cambio de precios ya está %.', case v_c.estado when 'aplicado' then 'aplicado' else 'deshecho' end using errcode = '22023'; end if;
  if public._conta_tarifa_huella(v_c.company_id) <> v_c.huella then
    raise exception 'Los precios han cambiado desde el ensayo: vuelve a ensayar.' using errcode = '40001';
  end if;
  for v_ref in select jsonb_array_elements_text(coalesce(v_c.resultado->'guardar'->'acabanAntes', '[]')) loop
    if split_part(v_ref, ':', 1) = 'precio' then
      select hasta into v_hasta from public.conta_precio where id = split_part(v_ref, ':', 2)::uuid;
      update public.conta_precio set hasta = (v_c.desde - interval '1 month')::date where id = split_part(v_ref, ':', 2)::uuid;
    else
      select hasta into v_hasta from public.conta_tarifa where id = split_part(v_ref, ':', 2)::uuid;
      update public.conta_tarifa set hasta = (v_c.desde - interval '1 month')::date where id = split_part(v_ref, ':', 2)::uuid;
    end if;
    v_efectos := v_efectos || jsonb_build_array(jsonb_build_object('acaba', v_ref, 'hastaAntes', v_hasta));
  end loop;
  for v_n in select value from jsonb_array_elements(coalesce(v_c.resultado->'guardar'->'nuevos', '[]')) loop
    v_id := public._conta_precio_insertar(v_c.account_id, v_c.company_id,
      case when v_n->'objetivo'->>'tipo' in ('servicio', 'nivel') then (v_n->'objetivo'->>'servicioId')::uuid end,
      case when v_n->'objetivo'->>'tipo' = 'nivel' then (v_n->'objetivo'->>'nivelId')::uuid end,
      case when v_n->'objetivo'->>'tipo' = 'paquete' then (v_n->'objetivo'->>'paqueteId')::uuid end,
      (v_n->>'clienteId')::uuid, v_n->'forma'->>'tipo', v_n->'forma'->>'periodo', (v_n->'forma'->>'importeCent')::numeric / 100,
      (select jsonb_agg(jsonb_build_object('desde', t->'desde', 'hasta', t->'hasta', 'importe', (t->>'importeCent')::numeric / 100, 'porUnidad', t->'porUnidad'))
         from jsonb_array_elements(coalesce(v_n->'forma'->'tramos', '[]')) t),
      v_c.desde, case when v_n->>'hasta' is null then null else (v_n->>'hasta' || '-01')::date end, v_c.id, v_quien);
    v_efectos := v_efectos || jsonb_build_array(jsonb_build_object('crea', 'precio:' || v_id));
  end loop;
  update public.conta_cambio_precios set estado = 'aplicado', efectos = v_efectos, aplicado_at = now(), aplicado_por_name = v_quien where id = p_cambio;
  return jsonb_build_object('id', p_cambio, 'frase', 'Hecho. ' || v_c.frase);
end $$;

-- «Cambiar precios», deshacer: quita los precios que creó y devuelve a cada uno su final de antes.
create or replace function public.conta_tarifa_cambio_deshacer(p_cambio uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.conta_cambio_precios; v_e jsonb; v_ref text; v_quien text := public.conta_nombre_actor();
begin
  select * into v_c from public.conta_cambio_precios where id = p_cambio for update;
  if v_c.id is null then raise exception 'Ese cambio de precios no existe.' using errcode = 'P0002'; end if;
  perform public._conta_tarifa_puede(v_c.company_id, true);
  if v_c.estado <> 'aplicado' then raise exception 'Solo se deshace un cambio de precios aplicado.' using errcode = '22023'; end if;
  delete from public.conta_precio where cambio_id = p_cambio;
  for v_e in select value from jsonb_array_elements(v_c.efectos) loop
    v_ref := v_e->>'acaba';
    continue when v_ref is null;
    if split_part(v_ref, ':', 1) = 'precio' then
      update public.conta_precio set hasta = (v_e->>'hastaAntes')::date where id = split_part(v_ref, ':', 2)::uuid;
    else
      update public.conta_tarifa set hasta = (v_e->>'hastaAntes')::date where id = split_part(v_ref, ':', 2)::uuid;
    end if;
  end loop;
  update public.conta_cambio_precios set estado = 'deshecho', deshecho_at = now(), deshecho_por_name = v_quien where id = p_cambio;
  return jsonb_build_object('id', p_cambio, 'frase', format('Deshecho: los precios vuelven a ser los de antes del cambio (%s clientes).', v_c.clientes));
end $$;

-- «Cobrado por otra vía» en la ficha (transferencia o efectivo, con fecha). Solo en Sumied.
create or replace function public.conta_gc_cobro_otra_via(p_company uuid, p_gc_cobro text, p_via text, p_fecha date, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company); v_c public.conta_gc_cobro;
begin
  select * into v_c from public.conta_gc_cobro where company_id = p_company and gc_id = p_gc_cobro;
  if v_c.gc_id is null then raise exception 'Ese cargo de GoCardless no es de esta empresa.' using errcode = 'P0002'; end if;
  if v_c.estado not in ('failed', 'charged_back') then raise exception 'Ese cargo no está devuelto en GoCardless.' using errcode = '22023'; end if;
  if p_via not in ('transferencia', 'efectivo') then raise exception 'Di si se cobró por transferencia o en efectivo.' using errcode = '22023'; end if;
  if p_fecha is null then raise exception 'Di qué día se cobró.' using errcode = '22023'; end if;
  insert into public.conta_gc_cobro_otra_via (company_id, gc_id, account_id, via, fecha, nota, quien, quien_name)
  values (p_company, p_gc_cobro, v_cuenta, p_via, p_fecha, nullif(trim(coalesce(p_nota, '')), ''), auth.uid(), public.conta_nombre_actor())
  on conflict (company_id, gc_id) do update set via = excluded.via, fecha = excluded.fecha, nota = excluded.nota, quien = excluded.quien, quien_name = excluded.quien_name, cuando = now();
  return jsonb_build_object('frase', format('Guardado: el cargo de %s del %s se cobró %s el %s. Ya no sale en «Te deben». En GoCardless no cambia nada.',
    public._conta_gestoria_euros(v_c.importe), to_char(v_c.fecha, 'DD/MM/YYYY'), case p_via when 'transferencia' then 'por transferencia' else 'en efectivo' end, to_char(p_fecha, 'DD/MM/YYYY')));
end $$;

create or replace function public.conta_gc_cobro_otra_via_quitar(p_company uuid, p_gc_cobro text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._conta_gestoria_puede(p_company);
  delete from public.conta_gc_cobro_otra_via where company_id = p_company and gc_id = p_gc_cobro;
  if not found then raise exception 'Ese cargo no estaba marcado como cobrado por otra vía.' using errcode = 'P0002'; end if;
  return jsonb_build_object('frase', 'Quitado: ese cargo vuelve a salir en «Te deben».');
end $$;

do $$
declare f text;
begin
  foreach f in array array['conta_gestoria_ajustes_guardar(uuid,text)', 'conta_tarifa_nivel_guardar(uuid,uuid,uuid,text,integer,text[],boolean,boolean)',
    'conta_tarifa_paquete_guardar(uuid,uuid,text,text,numeric,jsonb,boolean)', 'conta_tarifa_precio_guardar(uuid,uuid,uuid,uuid,uuid,text,text,numeric,jsonb,date,boolean)',
    'conta_tarifa_servicio_anadir(uuid,uuid,uuid,uuid,uuid,date,jsonb,boolean)', 'conta_tarifa_nivel_cambiar(uuid,uuid,date,boolean)',
    'conta_tarifa_cambio_ensayar(uuid,jsonb,jsonb)', 'conta_tarifa_cambio_aplicar(uuid)', 'conta_tarifa_cambio_deshacer(uuid)',
    'conta_gc_cobro_otra_via(uuid,text,text,date,text)', 'conta_gc_cobro_otra_via_quitar(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ── 7 · Las vistas de consulta ──────────────────────────────────────────────

-- Los precios, juntos: los importados (conta_tarifa, de un servicio sin niveles) y los nuevos (conta_precio, con sus tramos).
create or replace view public.conta_consulta_tarifa_precio with (security_invoker = true) as
select t.account_id as cuenta_id, t.company_id as empresa_id, 'tarifa:' || t.id as id, 'servicio' as objetivo, t.servicio_id, null::uuid as nivel_id, null::uuid as paquete_id,
       t.party_id as cliente_id,
       case when s.forma = 'por_empleado' then 'por_trabajador' else 'fijo' end as forma,
       case when s.forma = 'por_empleado' then null when t.periodo = 'anio' then 'anio' when t.periodo = 'unidad' then 'vez' else 'mes' end as periodo,
       t.importe, '[]'::jsonb as tramos, t.desde, t.hasta, t.origen, null::uuid as cambio_id, t.created_at, t.created_by_name
  from public.conta_tarifa t join public.conta_servicio s on s.id = t.servicio_id
union all
select p.account_id, p.company_id, 'precio:' || p.id,
       case when p.paquete_id is not null then 'paquete' when p.nivel_id is not null then 'nivel' else 'servicio' end,
       p.servicio_id, p.nivel_id, p.paquete_id, p.party_id, p.forma, p.periodo, p.importe,
       coalesce((select jsonb_agg(jsonb_build_object('desde', r.desde, 'hasta', r.hasta, 'importe', r.importe, 'porUnidad', r.por_unidad) order by r.desde)
                   from public.conta_precio_tramo r where r.precio_id = p.id), '[]'::jsonb),
       p.desde, p.hasta, 'manual', p.cambio_id, p.created_at, p.created_by_name
  from public.conta_precio p;
comment on view public.conta_consulta_tarifa_precio is 'G04 · Todos los precios de la tarifa, generales y de cada cliente, con su forma y sus tramos: los importados en el G01 (tarifa:…) y los nuevos (precio:…). Con ellos calcula precio.ts.';

-- Lo que tiene cada cliente: las líneas (servicios, niveles, trabajadores) y los paquetes.
create or replace view public.conta_consulta_asignacion with (security_invoker = true) as
select l.account_id as cuenta_id, l.company_id as empresa_id, l.party_id as cliente_id, 'linea:' || l.id as id, l.tipo, l.servicio_id, l.nivel_id, null::uuid as paquete_id,
       l.detalle, l.empleado_nombre, l.importe_propio, l.periodo, l.desde, l.hasta, l.alta_el, l.baja_el, l.origen, l.suscripcion_gc_id
  from public.conta_linea l
union all
select c.account_id, c.company_id, c.party_id, 'paquete:' || c.id, 'cuota', null, null, c.paquete_id, null, null, null, 'mes', c.desde, c.hasta, c.alta_el, c.baja_el, 'manual', null
  from public.conta_cliente_paquete c;
comment on view public.conta_consulta_asignacion is 'G04 · Lo que tiene cada cliente con cada empresa: sus líneas (un servicio, un nivel o un trabajador) y sus paquetes, de su mes «desde» a su mes «hasta». Con ellas calcula precio.ts.';

-- La lista: UNA FILA POR CLIENTE Y EMPRESA con la que tiene algo (y una, sin empresa, para quien no tiene nada con ninguna).
create or replace view public.conta_consulta_cliente_empresa with (security_invoker = true) as
with vinculo as (
  select c.account_id, c.party_id, c.emisor_segun_crm as company_id from public.conta_gestoria_cliente c where c.emisor_segun_crm is not null
  union select l.account_id, l.party_id, l.company_id from public.conta_linea l
  union select x.account_id, x.party_id, x.company_id from public.conta_cliente_paquete x
  union select cc.account_id, cc.party_id, cc.company_id from public.conta_cobro_cliente cc
  union select g.account_id, g.party_id, g.company_id from public.conta_gc_cliente g where g.party_id is not null
),
fila as (
  select c.account_id, c.party_id, v.company_id
    from public.conta_gestoria_cliente c join vinculo v on v.party_id = c.party_id and v.account_id = c.account_id
  union all
  select c.account_id, c.party_id, null::uuid from public.conta_gestoria_cliente c
   where not exists (select 1 from vinculo v where v.party_id = c.party_id and v.account_id = c.account_id)
)
select f.account_id as cuenta_id, f.party_id as cliente_id, f.company_id as empresa_id, coalesce(e.trade_name, e.legal_name) as empresa,
       p.name as cliente, p.tax_id as nif, c.situacion, c.crm, c.tipo_ficha, c.id_externo as ficha_en_el_crm, c.leido_at as leido_del_crm,
       c.ficha->'telefonos' as telefonos, c.ficha->'correos' as correos,
       cc.forma_cobro as forma_de_cobro, cc.gc_cliente_id as cliente_en_gocardless,
       (select m.estado from public.conta_gc_mandato m where m.company_id = f.company_id and m.gc_cliente_id = cc.gc_cliente_id order by m.creado desc nulls last limit 1) as mandato,
       (select sum(s.al_mes) from public.conta_gc_suscripcion s where s.company_id = f.company_id and s.gc_cliente_id = cc.gc_cliente_id and s.estado = 'active') as gocardless_al_mes,
       (select count(*) from public.conta_gc_suscripcion s where s.company_id = f.company_id and s.gc_cliente_id = cc.gc_cliente_id and s.estado = 'active') as suscripciones_activas,
       (select min(s.proximo_cobro_fecha) from public.conta_gc_suscripcion s where s.company_id = f.company_id and s.gc_cliente_id = cc.gc_cliente_id and s.estado = 'active') as proximo_cobro_fecha,
       (select b.fecha from public.conta_gc_cobro b join public.conta_gc_mandato m on m.company_id = b.company_id and m.gc_id = b.mandato_gc_id
         where b.company_id = f.company_id and m.gc_cliente_id = cc.gc_cliente_id and b.estado in ('paid_out', 'confirmed') order by b.fecha desc limit 1) as ultimo_cobro_fecha,
       (select b.estado from public.conta_gc_cobro b join public.conta_gc_mandato m on m.company_id = b.company_id and m.gc_id = b.mandato_gc_id
         where b.company_id = f.company_id and m.gc_cliente_id = cc.gc_cliente_id order by b.fecha desc limit 1) as ultimo_cargo_estado,
       (select count(*) from public.conta_gestoria_diferencia d where d.party_id = f.party_id and d.vigente and (d.company_id is null or d.company_id = f.company_id)) as pendientes,
       (select array_agg(distinct l.empleado_nombre) from public.conta_linea l where l.party_id = f.party_id and l.company_id = f.company_id and l.empleado_nombre is not null
           and (l.hasta is null or l.hasta >= date_trunc('month', current_date)::date)) as trabajadores
  from fila f
  join public.conta_gestoria_cliente c on c.party_id = f.party_id
  join public.party p on p.id = f.party_id
  left join public.company e on e.id = f.company_id
  left join public.conta_cobro_cliente cc on cc.party_id = f.party_id and cc.company_id = f.company_id
 where p.archived_at is null;
comment on view public.conta_consulta_cliente_empresa is
  'G04 · La lista de Clientes: una fila por cliente y empresa con la que tiene algo (la que dice su CRM, una línea, un paquete, la forma de cobro o un cliente de GoCardless casado), y una sin empresa (empresa_id null) para quien no tiene nada con ninguna. Sin los archivados. Lo de GoCardless, de la empresa de la fila. Sustituye a conta_consulta_clientes, que cruzaba cada cliente con todas las empresas.';

-- El próximo cobro de GoCardless de cada empresa (Julio, 08/11): el día, cuántos y cuánto; y las suscripciones activas sin fecha.
create or replace view public.conta_consulta_proximo_cobro with (security_invoker = true) as
with prox as (
  select s.account_id, s.company_id, min(s.proximo_cobro_fecha) as fecha from public.conta_gc_suscripcion s
   where s.estado = 'active' and s.proximo_cobro_fecha >= current_date group by 1, 2
)
select e.account_id as cuenta_id, e.id as empresa_id, coalesce(e.trade_name, e.legal_name) as empresa, x.fecha,
       (select count(*) from public.conta_gc_suscripcion s where s.company_id = e.id and s.estado = 'active' and s.proximo_cobro_fecha = x.fecha) as cobros,
       (select sum(s.proximo_cobro_importe) from public.conta_gc_suscripcion s where s.company_id = e.id and s.estado = 'active' and s.proximo_cobro_fecha = x.fecha) as importe,
       (select count(*) from public.conta_gc_suscripcion s where s.company_id = e.id and s.estado = 'active') as suscripciones_activas,
       (select sum(s.al_mes) from public.conta_gc_suscripcion s where s.company_id = e.id and s.estado = 'active') as al_mes,
       (select count(*) from public.conta_gc_suscripcion s where s.company_id = e.id and s.estado = 'active' and s.proximo_cobro_fecha is null) as sin_fecha,
       (select max(s.leido_at) from public.conta_gc_suscripcion s where s.company_id = e.id) as leido_at
  from public.company e
  join public.conta_cobro_gocardless g on g.company_id = e.id
  left join prox x on x.company_id = e.id;
comment on view public.conta_consulta_proximo_cobro is 'G04 · El próximo cobro de GoCardless de cada empresa conectada: el día, cuántos cobros y cuánto (upcoming_payments de la última lectura), y las suscripciones activas, lo que suman al mes y las que no traen fecha. Hasta el G05, manda GoCardless.';

-- Los cargos devueltos en GoCardless, con lo que decide «Te deben»: si el mandato sigue activo, si se cobró después y si se marcó cobrado por otra vía.
create or replace view public.conta_consulta_cargo_devuelto with (security_invoker = true) as
select b.account_id as cuenta_id, b.company_id as empresa_id, b.gc_id, b.suscripcion_gc_id, b.estado, b.fecha, b.importe, b.motivo,
       m.gc_cliente_id, m.estado as mandato,
       (select array_agg(cc.party_id) from public.conta_cobro_cliente cc where cc.company_id = b.company_id and cc.gc_cliente_id = m.gc_cliente_id) as clientes,
       m.estado = 'active' as mandato_activo,
       exists (select 1 from public.conta_gc_cobro p where p.company_id = b.company_id and p.suscripcion_gc_id = b.suscripcion_gc_id
                  and b.suscripcion_gc_id is not null and p.fecha > b.fecha and p.estado in ('paid_out', 'confirmed')) as cobrado_despues,
       o.via as otra_via, o.fecha as otra_via_fecha
  from public.conta_gc_cobro b
  left join public.conta_gc_mandato m on m.company_id = b.company_id and m.gc_id = b.mandato_gc_id
  left join public.conta_gc_cobro_otra_via o on o.company_id = b.company_id and o.gc_id = b.gc_id
 where b.estado in ('failed', 'charged_back');
comment on view public.conta_consulta_cargo_devuelto is 'G04 · Cada cargo devuelto (fallido o retrocedido) en GoCardless, con su mandato, sus clientes de Sumied, si se cobró después en la misma suscripción y si una persona lo marcó «Cobrado por otra vía». «Te deben» suma los de mandato activo, sin cobrar después y sin marcar (lista.ts · teDeben).';

-- «Lo que tienes que hacer», por empresa y tipo, con lo que mueve cada uno.
create or replace view public.conta_consulta_que_hacer with (security_invoker = true) as
with gc_sin_cliente as (
  select s.account_id, s.company_id, count(*) n, sum(s.al_mes) eur from public.conta_gc_suscripcion s
   where s.estado = 'active' and not exists (select 1 from public.conta_cobro_cliente cc where cc.company_id = s.company_id and cc.gc_cliente_id = s.gc_cliente_id)
   group by 1, 2
), gc_varios as (
  select cc.account_id, cc.company_id, count(*) n from (
    select account_id, company_id, gc_cliente_id from public.conta_cobro_cliente where gc_cliente_id is not null group by 1, 2, 3 having count(*) > 1) cc
   group by 1, 2
), devueltos as (
  select b.account_id, b.company_id, count(*) n, sum(b.importe) eur from public.conta_gc_cobro b
   where b.estado in ('failed', 'charged_back') and b.fecha >= date_trunc('month', current_date)::date group by 1, 2
), por_firmar as (
  select m.account_id, m.company_id, count(*) n,
         sum((select sum(s.al_mes) from public.conta_gc_suscripcion s where s.company_id = m.company_id and s.mandato_gc_id = m.gc_id and s.estado = 'active')) eur
    from public.conta_gc_mandato m where m.estado in ('pending_customer_approval', 'pending_submission', 'submitted') group by 1, 2
), difs as (
  select d.account_id, d.company_id, d.tipo, count(*) n from public.conta_gestoria_diferencia d where d.vigente group by 1, 2, 3
)
select account_id as cuenta_id, company_id as empresa_id, 'gocardless_sin_cliente' as tipo, n, eur as euros from gc_sin_cliente
union all select account_id, company_id, 'gocardless_varios_clientes', n, null from gc_varios
union all select account_id, company_id, 'recibos_devueltos', n, eur from devueltos
union all select account_id, company_id, 'mandatos_por_firmar', n, eur from por_firmar
union all select account_id, company_id, 'diferencia:' || tipo, n, null from difs;
comment on view public.conta_consulta_que_hacer is
  'G04 · «Lo que tienes que hacer», por empresa: los cobros de GoCardless sin cliente (y lo que suman al mes), los clientes de GoCardless unidos a más de un cliente de Sumied, los recibos devueltos este mes, los mandatos por firmar y las diferencias vigentes por tipo. Los activos sin cuota los cuenta la lista. La pantalla ordena por el dinero que mueve cada una.';

do $$
declare v text;
begin
  foreach v in array array['conta_consulta_tarifa_precio', 'conta_consulta_asignacion', 'conta_consulta_cliente_empresa', 'conta_consulta_proximo_cobro',
                           'conta_consulta_cargo_devuelto', 'conta_consulta_que_hacer'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', v);
    execute format('grant select on public.%I to authenticated', v);
    execute format('grant all on public.%I to service_role', v);
    if exists (select 1 from pg_roles where rolname = 'conta_lectura') then execute format('grant select on public.%I to conta_lectura', v); end if;
  end loop;
end $$;
