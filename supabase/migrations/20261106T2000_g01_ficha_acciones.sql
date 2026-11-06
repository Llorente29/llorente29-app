-- supabase/migrations/20261106T2000_g01_ficha_acciones.sql
--
-- G01 · Tarea 4b (06/11/2026) · La ficha del cliente deja HACER. SOLO AÑADE:
-- una tabla nueva y seis funciones nuevas, para una persona administradora o
-- encargada de la cuenta. Cada una devuelve su frase con contenido (regla 8) y
-- queda en el registro: lo de las líneas, en conta_gestoria_cambio (el
-- disparador de la 1530); lo demás, en conta_gestoria_decision (quién, cuándo,
-- qué y por qué). La lectura de cada noche respeta las decisiones.
--
--   1. conta_gestoria_alta_empleado: «+ Añadir trabajador» (una línea de un
--      servicio por empleado, desde el mes que se diga).
--   2. conta_gestoria_baja_linea: «Dar de baja» desde un mes; ese mes se cobra
--      entero (la línea vale hasta ese mes, incluido).
--   3. conta_gestoria_linea_desde_gc: «Añadirla como línea» (lo que cobra
--      GoCardless y no es ninguna línea en Sumied).
--   4. conta_gestoria_no_contar: «Es una baja: no la cuentes» (Sumied no suma
--      esa suscripción de GoCardless al comparar).
--   5. conta_gestoria_enlazar: «Enlazar con una ficha» (un cliente de
--      GoCardless sin ficha en Bitrix24, con un cliente de Sumied).
--   6. conta_gestoria_revisada: «Ya lo he revisado» (la diferencia deja de
--      salir mientras siga igual).
-- Vuelta atrás: supabase/vuelta-atras/20261106T2000_g01_ficha_acciones.down.sql

create table if not exists public.conta_gestoria_decision (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  tipo               text not null check (tipo in ('enlace', 'no_contar', 'revisada', 'linea_desde_gc')),
  party_id           uuid references public.party(id) on delete set null,
  gc_cliente_id      text,
  suscripcion_gc_id  text,
  diferencia_tipo    text,
  porque             text,
  motivo             text,
  frase              text not null,
  quien              uuid,
  quien_name         text,
  cuando             timestamptz not null default now()
);
comment on table public.conta_gestoria_decision is
  'G01 · Lo que una persona decide en la ficha de un cliente sobre lo que no cuadra: enlazar un cliente de GoCardless, no contar una suscripción, convertirla en línea o dar una diferencia por revisada. Quién, cuándo y por qué. La lectura de cada noche lo respeta.';
create index if not exists conta_gestoria_decision_empresa_idx on public.conta_gestoria_decision (company_id, tipo);
alter table public.conta_gestoria_decision enable row level security;
revoke all on table public.conta_gestoria_decision from public, anon, authenticated;
grant select on table public.conta_gestoria_decision to authenticated;
drop policy if exists conta_gestoria_decision_leer on public.conta_gestoria_decision;
create policy conta_gestoria_decision_leer on public.conta_gestoria_decision for select to authenticated using (public.belongs_to_account(account_id));

-- La cuenta de una empresa, comprobando que quien llama puede (o el error).
create or replace function public._conta_gestoria_puede(p_company uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta cambia lo que se cobra a un cliente.' using errcode = '42501';
  end if;
  return v_cuenta;
end $$;
revoke all on function public._conta_gestoria_puede(uuid) from public, anon, authenticated;

-- «diciembre» y «24,20 €».
create or replace function public._conta_gestoria_mes(p_mes date)
returns text language sql immutable set search_path = public as $$
  select (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from p_mes)::int]
$$;
create or replace function public._conta_gestoria_euros(p_importe numeric)
returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(to_char(round(coalesce(p_importe, 0), 2), 'FM999,999,990.00'), ',', '#'), '.', ','), '#', '.') || ' €'
$$;
revoke all on function public._conta_gestoria_mes(date) from public, anon;
revoke all on function public._conta_gestoria_euros(numeric) from public, anon;

-- 1 · + Añadir trabajador.
create or replace function public.conta_gestoria_alta_empleado(p_company uuid, p_party uuid, p_servicio uuid, p_empleado text, p_desde date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company); v_mes date := date_trunc('month', p_desde)::date;
        v_serv public.conta_servicio; v_cliente text; v_id uuid; v_importe numeric; v_nombre text := upper(trim(coalesce(p_empleado, '')));
begin
  select * into v_serv from public.conta_servicio where id = p_servicio and company_id = p_company;
  if v_serv.id is null then raise exception 'Ese servicio no es de esta empresa.' using errcode = 'P0002'; end if;
  if v_serv.forma <> 'por_empleado' then raise exception '«%» no se cobra por trabajador.', v_serv.nombre using errcode = '22023'; end if;
  select name into v_cliente from public.party where id = p_party and account_id = v_cuenta;
  if v_cliente is null then raise exception 'Ese cliente no es de esta cuenta.' using errcode = 'P0002'; end if;
  if v_nombre = '' then raise exception 'Escribe el nombre del trabajador.' using errcode = '22023'; end if;
  if v_mes is null then raise exception 'Di desde qué mes.' using errcode = '22023'; end if;
  if exists (select 1 from public.conta_linea where company_id = p_company and party_id = p_party and servicio_id = p_servicio
               and upper(empleado_nombre) = v_nombre and (hasta is null or hasta >= v_mes)) then
    raise exception '% ya está de alta en % de %.', v_nombre, v_serv.nombre, v_cliente using errcode = '23505';
  end if;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, empleado_nombre, origen, periodo, desde, created_by_name)
  values (v_cuenta, p_company, p_party, p_servicio, v_nombre, 'manual', 'mes', v_mes, public.conta_nombre_actor())
  returning id into v_id;
  v_importe := public.conta_linea_al_mes(v_id, v_mes);
  return jsonb_build_object('id', v_id, 'frase', format('Alta de %s en %s de %s desde %s: %s.', v_nombre, lower(v_serv.nombre), v_cliente,
    public._conta_gestoria_mes(v_mes), case when v_importe is null then 'aún sin tarifa' else public._conta_gestoria_euros(v_importe) || ' al mes' end));
end $$;

-- 2 · Dar de baja desde un mes (ese mes se cobra entero).
create or replace function public.conta_gestoria_baja_linea(p_linea uuid, p_mes date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l public.conta_linea; v_mes date := date_trunc('month', p_mes)::date; v_serv text; v_cliente text; v_quien text;
begin
  select * into v_l from public.conta_linea where id = p_linea;
  if v_l.id is null then raise exception 'Esa línea no existe.' using errcode = 'P0002'; end if;
  perform public._conta_gestoria_puede(v_l.company_id);
  if v_mes is null then raise exception 'Di desde qué mes es la baja.' using errcode = '22023'; end if;
  if v_mes < v_l.desde then raise exception 'La baja no puede ser antes del alta (%).', public._conta_gestoria_mes(v_l.desde) using errcode = '22023'; end if;
  update public.conta_linea set hasta = v_mes, updated_at = now(), updated_by_name = public.conta_nombre_actor() where id = p_linea;
  select s.nombre into v_serv from public.conta_servicio s where s.id = v_l.servicio_id;
  select name into v_cliente from public.party where id = v_l.party_id;
  v_quien := coalesce(v_l.empleado_nombre, nullif(v_l.detalle, ''), v_serv);
  return jsonb_build_object('id', p_linea, 'frase', format('Baja de %s en %s de %s: %s se cobra entero y ya no se cobra desde %s.',
    v_quien, lower(v_serv), v_cliente, public._conta_gestoria_mes(v_mes), public._conta_gestoria_mes((v_mes + interval '1 month')::date)));
end $$;

-- 3 · Añadirla como línea: lo que cobra GoCardless pasa a ser una línea en Sumied.
create or replace function public.conta_gestoria_linea_desde_gc(p_company uuid, p_suscripcion text, p_servicio uuid, p_empleado text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company); v_s public.conta_gc_suscripcion; v_party uuid; v_cliente text;
        v_serv public.conta_servicio; v_mes date; v_id uuid; v_frase text; v_empleado text := nullif(upper(trim(coalesce(p_empleado, ''))), '');
begin
  select * into v_s from public.conta_gc_suscripcion where company_id = p_company and gc_id = p_suscripcion;
  if v_s.gc_id is null then raise exception 'Esa suscripción no está en lo leído de GoCardless.' using errcode = 'P0002'; end if;
  select g.party_id into v_party from public.conta_gc_cliente g where g.company_id = p_company and g.gc_id = v_s.gc_cliente_id;
  if v_party is null then raise exception 'El cliente de GoCardless aún no está enlazado con ninguna ficha: enlázalo primero.' using errcode = '22023'; end if;
  if exists (select 1 from public.conta_linea where company_id = p_company and suscripcion_gc_id = p_suscripcion) then
    raise exception 'Ya hay una línea con lo que cobra «%».', v_s.nombre using errcode = '23505';
  end if;
  select * into v_serv from public.conta_servicio where id = p_servicio and company_id = p_company;
  if v_serv.id is null then raise exception 'Ese servicio no es de esta empresa.' using errcode = 'P0002'; end if;
  if v_serv.forma = 'por_empleado' and v_empleado is null then raise exception 'Escribe de qué trabajador es.' using errcode = '22023'; end if;
  select name into v_cliente from public.party where id = v_party;
  v_mes := greatest(date_trunc('month', coalesce(v_s.inicio, current_date))::date, date_trunc('month', current_date)::date);
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, empleado_nombre, origen, periodo, desde, suscripcion_gc_id, created_by_name)
  values (v_cuenta, p_company, v_party, p_servicio, case when v_serv.forma = 'por_empleado' then v_empleado end, 'gocardless',
          case when v_serv.forma = 'fijo_anio' then 'anio' else 'mes' end, v_mes, p_suscripcion, public.conta_nombre_actor())
  returning id into v_id;
  insert into public.conta_gc_importacion (company_id, suscripcion_gc_id, account_id, gc_cliente_id, party_id, nombre, importe, resultado, linea_id)
  values (p_company, p_suscripcion, v_cuenta, v_s.gc_cliente_id, v_party, v_s.nombre, v_s.importe, 'linea', v_id)
  on conflict (company_id, suscripcion_gc_id) do update set resultado = 'linea', linea_id = excluded.linea_id, porque_codigo = null, porque = null;
  v_frase := format('Añadida como línea: %s%s de %s desde %s (GoCardless cobra %s al mes).', v_serv.nombre, coalesce(' · ' || v_empleado, ''), v_cliente,
    public._conta_gestoria_mes(v_mes), public._conta_gestoria_euros(v_s.al_mes));
  insert into public.conta_gestoria_decision (account_id, company_id, tipo, party_id, gc_cliente_id, suscripcion_gc_id, frase, quien, quien_name)
  values (v_cuenta, p_company, 'linea_desde_gc', v_party, v_s.gc_cliente_id, p_suscripcion, v_frase, auth.uid(), public.conta_nombre_actor());
  update public.conta_gestoria_diferencia set vigente = false
   where company_id = p_company and party_id = v_party and vigente and tipo in ('totales_distintos', 'suscripcion_sin_convertir');
  return jsonb_build_object('id', v_id, 'frase', v_frase);
end $$;

-- 4 · Es una baja: no la cuentes.
create or replace function public.conta_gestoria_no_contar(p_company uuid, p_suscripcion text, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company); v_s public.conta_gc_suscripcion; v_party uuid; v_cliente text; v_frase text;
begin
  select * into v_s from public.conta_gc_suscripcion where company_id = p_company and gc_id = p_suscripcion;
  if v_s.gc_id is null then raise exception 'Esa suscripción no está en lo leído de GoCardless.' using errcode = 'P0002'; end if;
  select g.party_id, coalesce(p.name, g.nombre) into v_party, v_cliente
    from public.conta_gc_cliente g left join public.party p on p.id = g.party_id where g.company_id = p_company and g.gc_id = v_s.gc_cliente_id;
  v_frase := format('No se cuenta «%s» (%s al mes) de %s: es una baja. GoCardless la seguirá cobrando hasta que la canceles allí.',
    v_s.nombre, public._conta_gestoria_euros(v_s.al_mes), coalesce(v_cliente, v_s.gc_cliente_id));
  insert into public.conta_gestoria_decision (account_id, company_id, tipo, party_id, gc_cliente_id, suscripcion_gc_id, motivo, frase, quien, quien_name)
  values (v_cuenta, p_company, 'no_contar', v_party, v_s.gc_cliente_id, p_suscripcion, nullif(trim(p_motivo), ''), v_frase, auth.uid(), public.conta_nombre_actor());
  update public.conta_gestoria_diferencia set vigente = false
   where company_id = p_company and vigente and tipo in ('totales_distintos', 'suscripcion_sin_convertir')
     and (party_id = v_party or gc_cliente_id = v_s.gc_cliente_id);
  return jsonb_build_object('frase', v_frase);
end $$;

-- 5 · Enlazar con una ficha.
create or replace function public.conta_gestoria_enlazar(p_company uuid, p_gc_cliente text, p_party uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company); v_gc text; v_cliente text; v_frase text;
begin
  select coalesce(nombre, gc_id) into v_gc from public.conta_gc_cliente where company_id = p_company and gc_id = p_gc_cliente;
  if v_gc is null then raise exception 'Ese cliente no está en lo leído de GoCardless.' using errcode = 'P0002'; end if;
  select name into v_cliente from public.party where id = p_party and account_id = v_cuenta;
  if v_cliente is null then raise exception 'Ese cliente no es de esta cuenta.' using errcode = 'P0002'; end if;
  update public.conta_gc_cliente set party_id = p_party, casado_por = 'persona' where company_id = p_company and gc_id = p_gc_cliente;
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, forma_cobro, gc_cliente_id, gc_casado_por, updated_by_name)
  values (p_company, p_party, v_cuenta, 'gocardless', p_gc_cliente, 'persona', public.conta_nombre_actor())
  on conflict (company_id, party_id) do update set gc_cliente_id = excluded.gc_cliente_id, gc_casado_por = 'persona',
    forma_cobro = coalesce(public.conta_cobro_cliente.forma_cobro, 'gocardless'), updated_at = now(), updated_by_name = excluded.updated_by_name;
  v_frase := format('Enlazado: %s de GoCardless es %s. Desde ahora sus cobros salen en su ficha.', v_gc, v_cliente);
  insert into public.conta_gestoria_decision (account_id, company_id, tipo, party_id, gc_cliente_id, frase, quien, quien_name)
  values (v_cuenta, p_company, 'enlace', p_party, p_gc_cliente, v_frase, auth.uid(), public.conta_nombre_actor());
  update public.conta_gestoria_diferencia set vigente = false
   where company_id = p_company and vigente and tipo = 'gocardless_sin_ficha' and gc_cliente_id = p_gc_cliente;
  return jsonb_build_object('frase', v_frase);
end $$;

-- 6 · Ya lo he revisado: deja de salir mientras diga lo mismo.
create or replace function public.conta_gestoria_revisada(p_diferencia uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_d public.conta_gestoria_diferencia; v_cuenta uuid; v_cliente text; v_frase text;
begin
  select * into v_d from public.conta_gestoria_diferencia where id = p_diferencia;
  if v_d.id is null or v_d.company_id is null then raise exception 'Esa diferencia no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public._conta_gestoria_puede(v_d.company_id);
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Di por qué está bien así: queda apuntado.' using errcode = '22023'; end if;
  select name into v_cliente from public.party where id = v_d.party_id;
  v_frase := format('Revisado%s: «%s». Por qué: %s.', coalesce(' en ' || v_cliente, ''), v_d.porque, trim(p_motivo));
  insert into public.conta_gestoria_decision (account_id, company_id, tipo, party_id, gc_cliente_id, diferencia_tipo, porque, motivo, frase, quien, quien_name)
  values (v_cuenta, v_d.company_id, 'revisada', v_d.party_id, v_d.gc_cliente_id, v_d.tipo, v_d.porque, trim(p_motivo), v_frase, auth.uid(), public.conta_nombre_actor());
  update public.conta_gestoria_diferencia set vigente = false where id = p_diferencia;
  return jsonb_build_object('frase', v_frase);
end $$;

revoke all on function public.conta_gestoria_alta_empleado(uuid, uuid, uuid, text, date) from public, anon;
revoke all on function public.conta_gestoria_baja_linea(uuid, date) from public, anon;
revoke all on function public.conta_gestoria_linea_desde_gc(uuid, text, uuid, text) from public, anon;
revoke all on function public.conta_gestoria_no_contar(uuid, text, text) from public, anon;
revoke all on function public.conta_gestoria_enlazar(uuid, text, uuid) from public, anon;
revoke all on function public.conta_gestoria_revisada(uuid, text) from public, anon;
grant execute on function public.conta_gestoria_alta_empleado(uuid, uuid, uuid, text, date) to authenticated;
grant execute on function public.conta_gestoria_baja_linea(uuid, date) to authenticated;
grant execute on function public.conta_gestoria_linea_desde_gc(uuid, text, uuid, text) to authenticated;
grant execute on function public.conta_gestoria_no_contar(uuid, text, text) to authenticated;
grant execute on function public.conta_gestoria_enlazar(uuid, text, uuid) to authenticated;
grant execute on function public.conta_gestoria_revisada(uuid, text) to authenticated;
