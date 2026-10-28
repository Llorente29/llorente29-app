-- supabase/migrations/20261028T0705_l1a_correcciones_firma_e_informe.sql
--
-- L1a · PR 2 · Las correcciones dentro de la ley y el informe para la
-- Inspección (28/10/2026; encargo L1a, tableros 5 y 6 de la maqueta). Primera
-- de dos: SOLO AÑADE (columnas que admiten nulos, tablas y funciones nuevas),
-- y se puede pasar dos veces. Lo que cambia algo que ya existe (los
-- disparadores y las cuatro funciones de corrección) va en la 0706.
--
-- Lo que añade:
--   1. El rastro gana la conformidad de la persona (pendiente, conforme o
--      desacuerdo, con su hora y su nota) y la petición de la que viene una
--      corrección. responder_correccion: la persona acepta o discute en un
--      toque, una vez, y solo lo suyo. (Quién nace «pendiente» lo decide el
--      disparador de la 0706.)
--   2. _puede_corregir: el administrador, o el encargado con las personas de
--      sus locales (nunca a sí mismo). Lo usan las funciones de la 0706.
--   3. La firma del mes (registro_jornada_firma, firmar_registro_mes): la
--      persona firma desde su portal el resumen de un mes ya acabado; se guarda
--      con la huella de sus marcas. (Su invalidación al corregir, en la 0706.)
--   4. informe_registro_jornada(persona, desde, hasta): los datos del informe
--      para la Inspección, en una sola lectura (la empresa, la persona, cada
--      marca con su origen, cada corrección con quién, cuándo, por qué y la
--      conformidad, las firmas, las ausencias y los festivos). Las horas las
--      calcula el front, con sus pruebas (src/modules/personal/laboral). Lo lee
--      quien ve a la persona; el DNI, solo el administrador.
--   5. El enlace para la Inspección (registro_jornada_enlace): lo crea el
--      administrador para una persona y un periodo, caduca solo (30 días por
--      defecto, como mucho 90) y se puede retirar. informe_por_enlace(token) lo
--      abre sin sesión, y cuenta cuántas veces se ha abierto.
--   6. jornadas_para_revisar(cuenta): las jornadas de más de 12 h y las
--      entradas sin salida (otra entrada antes de cerrar, o más de un día sin
--      salida), de las personas que ve quien pregunta. No toca ninguna.
--
-- Vuelta atrás: supabase/vuelta-atras/20261028T0705_l1a_correcciones_firma_e_informe.down.sql

-- ── 1 · La conformidad, en el rastro ───────────────────────────────────────
alter table public.clock_entry_audit
  add column if not exists conformidad text,
  add column if not exists conformidad_at timestamptz,
  add column if not exists conformidad_nota text,
  add column if not exists peticion_id uuid;

comment on column public.clock_entry_audit.conformidad is
  'L1a (28/10/2026). Lo que dice la persona de una corrección que no pidió: pendiente, conforme o desacuerdo. Null: la pidió ella, la hizo ella o es de antes del 28/10. Sin CHECK a propósito (la 0705 solo añade): la escriben dos funciones de servidor con esos tres valores fijos (_clock_audit_conformidad y responder_correccion).';
comment on column public.clock_entry_audit.peticion_id is
  'L1a (28/10/2026). La petición de corrección de la que viene esta fila, si la aprobó el encargado o el administrador.';

create or replace function public.responder_correccion(p_audit_id uuid, p_conforme boolean, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.clock_entry_audit;
begin
  select * into a from public.clock_entry_audit where id = p_audit_id for update;
  if a.id is null then
    raise exception 'CORRECCION_NO_EXISTE' using errcode = '22023', hint = 'Esa corrección ya no existe.';
  end if;
  if not public.current_user_is_employee(a.employee_id, a.account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'Solo la persona del fichaje puede decir si está de acuerdo.';
  end if;
  if a.conformidad is distinct from 'pendiente' then
    raise exception 'YA_RESPONDIDA' using errcode = '22023', hint = 'Ya dijiste si estabas de acuerdo con esta corrección.';
  end if;
  update public.clock_entry_audit
     set conformidad = case when p_conforme then 'conforme' else 'desacuerdo' end,
         conformidad_at = now(),
         conformidad_nota = nullif(trim(coalesce(p_nota, '')), '')
   where id = p_audit_id
   returning * into a;
  return jsonb_build_object('id', a.id, 'conformidad', a.conformidad, 'conformidad_at', a.conformidad_at);
end $$;
revoke all on function public.responder_correccion(uuid, boolean, text) from public, anon;
grant execute on function public.responder_correccion(uuid, boolean, text) to authenticated;

-- ── 2 · Quién puede corregir a quién ─────────────────────────────────────
-- Quién puede corregir a esta persona: el administrador, o el encargado que la ve.
create or replace function public._puede_corregir(p_employee_id uuid, p_account_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_is_admin_of(p_account_id)
      or (public.current_user_is_admin_or_manager_of(p_account_id)
          and public.current_user_ve_persona(p_employee_id, p_account_id)
          and not public.current_user_is_employee(p_employee_id, p_account_id));
$$;
revoke all on function public._puede_corregir(uuid, uuid) from public, anon, authenticated;

-- ── 3 · La firma del mes ───────────────────────────────────────────────────
create table if not exists public.registro_jornada_firma (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  employee_id uuid not null references public.employees(id),
  mes date not null check (mes = date_trunc('month', mes)::date),
  firmado_at timestamptz not null default now(),
  firmado_por uuid not null,
  huella text not null,
  resumen jsonb not null default '{}'::jsonb,
  invalidada_at timestamptz,
  invalidada_motivo text
);
comment on table public.registro_jornada_firma is
  'L1a (28/10/2026). La persona firma desde su portal el resumen de un mes ya acabado. huella: md5 de sus marcas de ese mes al firmar. Si después se corrige un fichaje de ese mes, invalidada_at: hay que volver a firmar.';
create unique index if not exists registro_jornada_firma_vigente
  on public.registro_jornada_firma (employee_id, mes) where invalidada_at is null;
create index if not exists registro_jornada_firma_persona on public.registro_jornada_firma (employee_id, mes);

alter table public.registro_jornada_firma enable row level security;
drop policy if exists registro_jornada_firma_leer on public.registro_jornada_firma;
create policy registro_jornada_firma_leer on public.registro_jornada_firma for select to authenticated
  using (public.current_user_ve_persona(employee_id, account_id));
revoke all on public.registro_jornada_firma from anon, authenticated;
grant select on public.registro_jornada_firma to authenticated;

-- El mes de una hora, en Madrid.
create or replace function public._mes_madrid(p_t timestamptz)
returns date language sql immutable set search_path = public as $$
  select date_trunc('month', p_t at time zone 'Europe/Madrid')::date;
$$;

create or replace function public._huella_registro_mes(p_employee_id uuid, p_mes date)
returns text language sql stable security definer set search_path = public as $$
  select md5(coalesce(string_agg(
           ce.id::text || '|' || ce.type || '|' || coalesce(ce.real_datetime, ce.datetime)::text || '|' || coalesce(ce.voided, false)::text,
           ',' order by coalesce(ce.real_datetime, ce.datetime), ce.id), ''))
    from public.clock_entries ce
   where ce.employee_id = p_employee_id
     and public._mes_madrid(coalesce(ce.real_datetime, ce.datetime)) = p_mes;
$$;
revoke all on function public._huella_registro_mes(uuid, date) from public, anon, authenticated;

create or replace function public.firmar_registro_mes(p_employee_id uuid, p_mes date, p_resumen jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acct uuid; v_mes date := date_trunc('month', p_mes)::date; f public.registro_jornada_firma;
begin
  v_acct := public._account_of_employee(p_employee_id);
  if v_acct is null or not public.current_user_is_employee(p_employee_id, v_acct) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'El registro de cada mes lo firma la propia persona, desde su portal.';
  end if;
  if v_mes >= public._mes_madrid(now()) then
    raise exception 'MES_SIN_ACABAR' using errcode = '22023', hint = 'Un mes se firma cuando ha acabado.';
  end if;
  if exists (select 1 from public.registro_jornada_firma where employee_id = p_employee_id and mes = v_mes and invalidada_at is null) then
    raise exception 'YA_FIRMADO' using errcode = '22023', hint = 'Ese mes ya está firmado.';
  end if;
  insert into public.registro_jornada_firma(account_id, employee_id, mes, firmado_por, huella, resumen)
  values (v_acct, p_employee_id, v_mes, auth.uid(), public._huella_registro_mes(p_employee_id, v_mes), coalesce(p_resumen, '{}'::jsonb))
  returning * into f;
  return jsonb_build_object('id', f.id, 'mes', f.mes, 'firmado_at', f.firmado_at, 'huella', f.huella);
end $$;
revoke all on function public.firmar_registro_mes(uuid, date, jsonb) from public, anon;
grant execute on function public.firmar_registro_mes(uuid, date, jsonb) to authenticated;

-- ── 4 · Los datos del informe ──────────────────────────────────────────────
create or replace function public._informe_registro_jornada(p_employee_id uuid, p_desde date, p_hasta date, p_con_dni boolean, p_motivos_baja boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees; v_acct public.accounts; v_local text;
  v_ini timestamptz := (p_desde::timestamp at time zone 'Europe/Madrid');
  v_fin timestamptz := ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid') + interval '16 hours';
begin
  select * into e from public.employees where id = p_employee_id;
  if e.id is null then raise exception 'PERSONA_NO_EXISTE' using errcode = '22023'; end if;
  select * into v_acct from public.accounts where id = e.account_id;
  select name into v_local from public.locations where id = e.location_id;
  return jsonb_build_object(
    'generado_at', now(),
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta),
    'empresa', jsonb_build_object('nombre', coalesce(nullif(v_acct.legal_name, ''), v_acct.name), 'cif', v_acct.cif),
    'persona', jsonb_build_object(
      'id', e.id, 'nombre', e.name, 'dni', case when p_con_dni then e.dni end,
      'puesto', e.position, 'local', v_local, 'tipo_contrato', e.contract_type,
      'horas_semana', coalesce(e.contracted_hours_week, e.weekly_hours), 'alta', e.start_date),
    'marcas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ce.id, 'tipo', ce.type, 'hora', coalesce(ce.real_datetime, ce.datetime),
               'declarada', ce.declared_at, 'llegada', ce.created_at, 'origen', ce.source,
               'local', l.name, 'distancia_m', ce.distance_m, 'dentro_del_radio', ce.within_radius,
               'anulada', coalesce(ce.voided, false))
             order by coalesce(ce.real_datetime, ce.datetime), ce.id)
        from public.clock_entries ce
        left join public.locations l on l.id = ce.location_id_at_clock
       where ce.employee_id = e.id
         and coalesce(ce.real_datetime, ce.datetime) >= v_ini
         and coalesce(ce.real_datetime, ce.datetime) < v_fin), '[]'::jsonb),
    'cambios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'marca', a.clock_entry_id, 'accion', a.action, 'cuando', a.created_at,
               'quien', coalesce(nullif(up.display_name, ''), nullif(a.actor_label, ''), case when a.actor_user_id is null then 'el sistema' end),
               'papel', up.role,
               'es_la_persona', (up.employee_id is not null and up.employee_id = e.id),
               'motivo', a.reason, 'antes', a.before, 'despues', a.after,
               'conformidad', a.conformidad, 'conformidad_at', a.conformidad_at, 'conformidad_nota', a.conformidad_nota,
               'peticion', case when r.id is null then null else jsonb_build_object(
                  'pedida_at', r.created_at, 'motivo', r.reason, 'tipo', r.kind) end)
             order by a.created_at, a.id)
        from public.clock_entry_audit a
        left join lateral (
          select u.display_name, u.role, u.employee_id from public.user_profiles u
           where u.user_id = a.actor_user_id and u.account_id = e.account_id
           order by u.active desc limit 1) up on true
        left join public.clock_correction_request r on r.id = a.peticion_id
       where a.employee_id = e.id
         and a.action in ('create_manual', 'edit', 'void', 'restore')
         and a.clock_entry_id in (
           select ce.id from public.clock_entries ce
            where ce.employee_id = e.id
              and coalesce(ce.real_datetime, ce.datetime) >= v_ini
              and coalesce(ce.real_datetime, ce.datetime) < v_fin)), '[]'::jsonb),
    'firmas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'mes', f.mes, 'firmado_at', f.firmado_at, 'invalidada_at', f.invalidada_at,
               'invalidada_motivo', f.invalidada_motivo,
               'vigente', f.invalidada_at is null
                          and f.huella = public._huella_registro_mes(e.id, f.mes))
             order by f.mes, f.firmado_at)
        from public.registro_jornada_firma f
       where f.employee_id = e.id
         and f.mes between date_trunc('month', p_desde)::date and p_hasta), '[]'::jsonb),
    'ausencias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'desde', v.start_date, 'hasta', v.end_date,
               'tipo', case when v.type = 'baja_medica' and not p_motivos_baja then 'ausente' else v.type end)
             order by v.start_date)
        from public.vacations v
       where v.employee_id = e.id and v.status = 'aprobada'
         and v.start_date <= p_hasta and v.end_date >= p_desde), '[]'::jsonb),
    'festivos', coalesce((
      select jsonb_agg(jsonb_build_object('dia', h.holiday_date, 'nombre', h.name) order by h.holiday_date)
        from public.holiday_calendar h
       where (h.account_id is null or h.account_id = e.account_id)
         and h.holiday_date between p_desde and p_hasta), '[]'::jsonb)
  );
end $$;
revoke all on function public._informe_registro_jornada(uuid, date, date, boolean, boolean) from public, anon, authenticated;

create or replace function public.informe_registro_jornada(p_employee_id uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acct uuid;
begin
  v_acct := public._account_of_employee(p_employee_id);
  if v_acct is null or not public.current_user_ve_persona(p_employee_id, v_acct) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'Solo ves el registro de las personas que llevas.';
  end if;
  if p_hasta < p_desde or p_hasta - p_desde > 366 then
    raise exception 'PERIODO_INVALIDO' using errcode = '22023', hint = 'El periodo va de un día a un año.';
  end if;
  return public._informe_registro_jornada(p_employee_id, p_desde, p_hasta,
           public.current_user_is_admin_of(v_acct),
           public.current_user_is_admin_of(v_acct) or public.current_user_is_employee(p_employee_id, v_acct));
end $$;
revoke all on function public.informe_registro_jornada(uuid, date, date) from public, anon;
grant execute on function public.informe_registro_jornada(uuid, date, date) to authenticated;

-- ── 5 · El enlace para la Inspección ───────────────────────────────────────
create table if not exists public.registro_jornada_enlace (
  token text primary key,
  account_id uuid not null references public.accounts(id),
  employee_id uuid not null references public.employees(id),
  desde date not null,
  hasta date not null,
  caduca_at timestamptz not null,
  creado_por uuid not null,
  creado_at timestamptz not null default now(),
  revocado_at timestamptz,
  abierto_veces integer not null default 0,
  ultimo_abierto_at timestamptz
);
comment on table public.registro_jornada_enlace is
  'L1a (28/10/2026). Enlace de solo lectura del registro de jornada de una persona y un periodo, para la Inspección. Caduca solo; se puede retirar antes.';
alter table public.registro_jornada_enlace enable row level security;
drop policy if exists registro_jornada_enlace_leer on public.registro_jornada_enlace;
create policy registro_jornada_enlace_leer on public.registro_jornada_enlace for select to authenticated
  using (public.current_user_is_admin_of(account_id));
revoke all on public.registro_jornada_enlace from anon, authenticated;
grant select on public.registro_jornada_enlace to authenticated;

create or replace function public.crear_enlace_inspeccion(p_employee_id uuid, p_desde date, p_hasta date, p_dias integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acct uuid; v_token text; v_caduca timestamptz;
begin
  v_acct := public._account_of_employee(p_employee_id);
  if v_acct is null or not public.current_user_is_admin_of(v_acct) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'El enlace para la Inspección lo crea el administrador.';
  end if;
  if p_hasta < p_desde or p_hasta - p_desde > 366 then
    raise exception 'PERIODO_INVALIDO' using errcode = '22023', hint = 'El periodo va de un día a un año.';
  end if;
  if coalesce(p_dias, 0) not between 1 and 90 then
    raise exception 'CADUCIDAD_INVALIDA' using errcode = '22023', hint = 'El enlace caduca entre 1 y 90 días después.';
  end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_caduca := now() + make_interval(days => p_dias);
  insert into public.registro_jornada_enlace(token, account_id, employee_id, desde, hasta, caduca_at, creado_por)
  values (v_token, v_acct, p_employee_id, p_desde, p_hasta, v_caduca, auth.uid());
  return jsonb_build_object('token', v_token, 'caduca_at', v_caduca);
end $$;
revoke all on function public.crear_enlace_inspeccion(uuid, date, date, integer) from public, anon;
grant execute on function public.crear_enlace_inspeccion(uuid, date, date, integer) to authenticated;

create or replace function public.revocar_enlace_inspeccion(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.registro_jornada_enlace;
begin
  select * into x from public.registro_jornada_enlace where token = p_token for update;
  if x.token is null or not public.current_user_is_admin_of(x.account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;
  update public.registro_jornada_enlace set revocado_at = coalesce(revocado_at, now()) where token = p_token returning * into x;
  return jsonb_build_object('token', x.token, 'revocado_at', x.revocado_at);
end $$;
revoke all on function public.revocar_enlace_inspeccion(text) from public, anon;
grant execute on function public.revocar_enlace_inspeccion(text) to authenticated;

-- Sin sesión. Un token que no existe, caducado o retirado: el mismo error, sin
-- decir cuál (no da pistas a quien prueba tokens).
create or replace function public.informe_por_enlace(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.registro_jornada_enlace;
begin
  select * into x from public.registro_jornada_enlace where token = p_token for update;
  if x.token is null or x.revocado_at is not null or x.caduca_at <= now() then
    raise exception 'ENLACE_NO_VALIDO' using errcode = '42501', hint = 'Este enlace ya no es válido: ha caducado o lo han retirado. Pide uno nuevo a la empresa.';
  end if;
  update public.registro_jornada_enlace
     set abierto_veces = abierto_veces + 1, ultimo_abierto_at = now()
   where token = p_token;
  -- Con el DNI (la identificación que pide el art. 34.9); una baja médica, como
  -- «ausente» (decisión 1 de Julio: para los demás, nunca el motivo).
  return public._informe_registro_jornada(x.employee_id, x.desde, x.hasta, true, false)
         || jsonb_build_object('enlace', jsonb_build_object('caduca_at', x.caduca_at, 'creado_at', x.creado_at));
end $$;
revoke all on function public.informe_por_enlace(text) from public;
grant execute on function public.informe_por_enlace(text) to anon, authenticated;

-- ── 6 · Las jornadas para revisar ──────────────────────────────────────────
create or replace function public.jornadas_para_revisar(p_account_id uuid)
returns table(clock_entry_id uuid, employee_id uuid, nombre text, tipo text, entrada timestamptz, salida timestamptz, horas numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.current_user_is_admin_or_manager_of(p_account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;
  return query
  with m as (
    select ce.id, ce.employee_id, ce.type, coalesce(ce.real_datetime, ce.datetime) as t
      from public.clock_entries ce
     where ce.account_id = p_account_id and not coalesce(ce.voided, false)
       and ce.type in ('entrada', 'salida')
  ), s as (
    select m.*, lead(m.type) over w as sig_tipo, lead(m.t) over w as sig_t
      from m window w as (partition by m.employee_id order by m.t, m.id)
  )
  select s.id, s.employee_id, e.name,
         case when s.sig_tipo = 'salida' then 'larga' else 'sin_salida' end,
         s.t,
         case when s.sig_tipo = 'salida' then s.sig_t end,
         case when s.sig_tipo = 'salida' then round(extract(epoch from (s.sig_t - s.t)) / 3600.0, 1) end
    from s
    join public.employees e on e.id = s.employee_id
   where s.type = 'entrada'
     and (   (s.sig_tipo = 'salida' and s.sig_t - s.t > interval '12 hours')
          or  s.sig_tipo = 'entrada'
          or (s.sig_tipo is null and s.t < now() - interval '24 hours'))
     and public.current_user_ve_persona(s.employee_id, p_account_id)
   order by s.t desc;
end $$;
revoke all on function public.jornadas_para_revisar(uuid) from public, anon;
grant execute on function public.jornadas_para_revisar(uuid) to authenticated;
