-- supabase/staging/sql/20261109_gp_portal_gestoria_prueba.sql
--
-- SOLO STAGING. Prueba de la 2030 (GP, la parte de la gestoría y los avisos por
-- correo). Todo en una transacción con ROLLBACK, con datos inventados (T11): no
-- cambia staging.
--
--   1. Lo que pide el cliente: la persona del portal pide un alta; la gestoría
--      la hace (la línea del recibo sale con origen «solicitud» y la petición,
--      hecha); pide la baja de ese trabajador y la gestoría la hace (la línea
--      tiene «hasta»); otra, la gestoría la rechaza con su motivo. La persona del
--      portal no puede hacer ni rechazar nada.
--   2. Los avisos que faltan: el recibo próximo, el devuelto, los mensajes
--      nuevos y lo que pide la gestoría, solo a quien tiene «todo»; nada a quien
--      tiene «Facturas y documentos». Apuntado uno, ya no sale; los mensajes y
--      peticiones avisados, tampoco.
--   3. public._conta_portal_proximo: «Tu próximo recibo» dice de qué cuenta se
--      carga (cuenta_final de Code 1).
--   4. La regla de los permisos de todas las funciones del portal (nº 5).
--   5. La vuelta atrás: nada de lo nuevo, y _conta_portal_proximo como antes.
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; las lecturas se prueban como cada persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GP-2030: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- Lo de antes tiene que estar (la 1530 y la 1720); si la 2030 ya está, primero su vuelta atrás.
select to_regprocedure('public.conta_portal_inicio(uuid)') is null as falta_la_1530 \gset
\if :falta_la_1530
\i supabase/migrations/20261109T1530_gp_portal_base.sql
\endif
select position('cuenta_final' in pg_get_functiondef('public.conta_portal_cuenta(uuid)'::regprocedure)) = 0 as falta_la_1720 \gset
\if :falta_la_1720
\i supabase/migrations/20261109T1720_gp_portal_cuenta.sql
\endif
select to_regprocedure('public.conta_portal_solicitud_hacer(uuid,uuid)') is not null as ya_esta_la_2030 \gset
\if :ya_esta_la_2030
\i supabase/vuelta-atras/20261109T2030_gp_portal_gestoria.down.sql
\endif
\i supabase/migrations/20261109T2030_gp_portal_gestoria.sql

-- ── 0 · Siembra ────────────────────────────────────────────────────────────────
create temp table _g on commit drop as
select p.account_id as cuenta, p.user_id as gestor,
       (select c.id from public.company c where c.account_id = p.account_id order by c.created_at limit 1) as empresa,
       '0000a1a1-0000-4000-8000-000000002030'::uuid as pa, '0000a2a2-0000-4000-8000-000000002030'::uuid as pa2,
       null::uuid as ca, null::uuid as servicio, null::uuid as rdev
  from public.user_profiles p where p.active and p.role = 'admin' order by p.created_at limit 1;

do $$
declare g _g; xa uuid; s uuid; xd uuid; m text := to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM');
        mp text := to_char((now() at time zone 'Europe/Madrid') - interval '1 month', 'YYYY-MM');
begin
  select * into g from _g;
  if g.cuenta is null or g.empresa is null then raise exception 'PRUEBA GP-2030 · 0: staging no tiene un administrador con empresa.'; end if;
  insert into auth.users (id, email) values (g.pa, 'portal.g.a@ejemplo.invalid'), (g.pa2, 'portal.g.a2@ejemplo.invalid');
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Portal Gestoría Prueba, S.L.', 'B00002030') returning id into xa;
  insert into public.conta_gestoria_cliente (account_id, party_id, situacion) values (g.cuenta, xa, 'activo');
  insert into public.conta_cobro_cliente (account_id, company_id, party_id, forma_cobro, gc_cliente_id) values (g.cuenta, g.empresa, xa, 'gocardless', 'CU2030A');
  insert into public.conta_gc_mandato (account_id, company_id, gc_id, gc_cliente_id, estado, creado, cuenta_final, cuenta_pais)
  values (g.cuenta, g.empresa, 'MD2030A', 'CU2030A', 'active', now(), '00', 'ES');
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (g.cuenta, g.empresa, 'laboral_2030', 'Laboral prueba 2030', 'por_empleado') returning id into s;
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, estado, mandato_gc_id)
  values (g.cuenta, g.empresa, xa, m, 'recibo:' || g.empresa || ':' || xa || ':' || m, 15730, 'preparado', 'MD2030A');
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, estado)
  values (g.cuenta, g.empresa, xa, mp, 'recibo:' || g.empresa || ':' || xa || ':' || mp, 18150, 'devuelto') returning id into xd;
  insert into public.conta_portal_acceso (account_id, party_id, correo, nombre, user_id, permiso)
  values (g.cuenta, xa, 'portal.g.a@ejemplo.invalid', 'Persona A', g.pa, 'todo'),
         (g.cuenta, xa, 'portal.g.a2@ejemplo.invalid', 'Persona A2', g.pa2, 'facturas_documentos');
  insert into public.conta_portal_mensaje (account_id, party_id, de, autor_nombre, texto, created_at)
  values (g.cuenta, xa, 'gestoria', 'Gestora Prueba', 'Mensaje de prueba', now() - interval '10 minutes');
  insert into public.conta_portal_peticion (account_id, party_id, tipo, titulo) values (g.cuenta, xa, 'subir', 'Subir las facturas de prueba');
  -- El aviso del recibo sale desde el «día de aviso» de su empresa: aquí, el 1, para que no dependa del día de la prueba.
  insert into public.conta_gestoria_ajustes (company_id, account_id, dia_aviso) values (g.empresa, g.cuenta, 1)
  on conflict (company_id) do update set dia_aviso = 1;
  update _g set ca = xa, servicio = s, rdev = xd;
end $$;
grant select on _g to authenticated;
select gestor as gestor, pa as pa from _g \gset

-- ── 1 · Lo que pide el cliente ─────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'pa', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare g _g; j jsonb;
begin
  select * into g from _g;
  perform public.conta_portal_solicitud_pedir(g.ca, 'alta', 'Trabajador Prueba Portal', '00000000T', (now() at time zone 'Europe/Madrid')::date, 'Indefinido', 40);
  perform public.conta_portal_solicitud_pedir(g.ca, 'alta', 'Otro Trabajador Prueba', '00000000T', (now() at time zone 'Europe/Madrid')::date, 'Temporal', 20);
  begin
    perform public.conta_portal_solicitud_hacer((select s.id from jsonb_to_recordset(public.conta_portal_trabajadores(g.ca) -> 'peticiones') as s(id uuid) limit 1), g.servicio);
    raise exception 'PRUEBA GP-2030 · 1: la persona del portal hace una petición.';
  exception when sqlstate '42501' then null; end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', :'gestor', 'role', 'authenticated')::text, true);
do $$
declare g _g; v_alta uuid; v_otra uuid; v_baja uuid; j jsonb;
begin
  select * into g from _g;
  select id into v_alta from public.conta_solicitud where party_id = g.ca and empleado_nombre = 'Trabajador Prueba Portal';
  select id into v_otra from public.conta_solicitud where party_id = g.ca and empleado_nombre = 'Otro Trabajador Prueba';
  j := public.conta_portal_solicitud_hacer(v_alta, g.servicio);
  if not exists (select 1 from public.conta_linea l where l.id = (j ->> 'linea_id')::uuid and l.origen = 'solicitud' and l.solicitud_id = v_alta)
     or (select estado from public.conta_solicitud where id = v_alta) <> 'hecha' then
    raise exception 'PRUEBA GP-2030 · 1: hacer el alta no deja la línea con su origen o la petición hecha: %', j;
  end if;
  begin perform public.conta_portal_solicitud_hacer(v_alta, g.servicio); raise exception 'PRUEBA GP-2030 · 1: hace dos veces la misma petición.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_portal_solicitud_rechazar(v_otra, '  '); raise exception 'PRUEBA GP-2030 · 1: rechaza sin motivo.';
  exception when sqlstate '22023' then null; end;
  perform public.conta_portal_solicitud_rechazar(v_otra, 'Falta el contrato firmado');
  if (select estado || '|' || motivo_rechazo from public.conta_solicitud where id = v_otra) <> 'rechazada|Falta el contrato firmado' then
    raise exception 'PRUEBA GP-2030 · 1: el rechazo no queda con su motivo.';
  end if;
  raise notice 'GP-2030 · 1: la gestoría hace el alta (la línea, con origen «solicitud») y rechaza otra con su motivo. OK';
end $$;
-- La baja: la pide el cliente y la hace la gestoría.
select set_config('request.jwt.claims', json_build_object('sub', :'pa', 'role', 'authenticated')::text, true);
do $$ begin perform public.conta_portal_solicitud_pedir((select ca from _g), 'baja', 'TRABAJADOR PRUEBA PORTAL', null, ((now() at time zone 'Europe/Madrid')::date + 40)); end $$;
select set_config('request.jwt.claims', json_build_object('sub', :'gestor', 'role', 'authenticated')::text, true);
do $$
declare g _g; v uuid;
begin
  select * into g from _g;
  select id into v from public.conta_solicitud where party_id = g.ca and tipo = 'baja' and estado = 'pedida';
  perform public.conta_portal_solicitud_hacer(v, null);
  if not exists (select 1 from public.conta_linea where party_id = g.ca and upper(empleado_nombre) = 'TRABAJADOR PRUEBA PORTAL' and hasta is not null) then
    raise exception 'PRUEBA GP-2030 · 1: hacer la baja no pone «hasta» en la línea.';
  end if;
  raise notice 'GP-2030 · 1: la baja pedida, hecha: la línea tiene su «hasta». OK';
end $$;

-- ── 3 · «Tu próximo recibo» con la cuenta de cargo ──────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'pa', 'role', 'authenticated')::text, true);
do $$
declare j jsonb := public.conta_portal_inicio((select ca from _g)) -> 'proximo';
begin
  if j ->> 'cuenta_final' is distinct from '00' or j ->> 'cuenta_pais' is distinct from 'ES' then
    raise exception 'PRUEBA GP-2030 · 3: public._conta_portal_proximo no trae la cuenta de cargo: %', j;
  end if;
  raise notice 'GP-2030 · 3: public._conta_portal_proximo dice de qué cuenta se carga. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 2 · Los avisos que faltan (el servidor) ─────────────────────────────────────
do $$
declare g _g; j jsonb; tipos text[];
begin
  select * into g from _g;
  select jsonb_agg(x) into j from jsonb_array_elements(public.conta_portal_avisos_pendientes(500)) x where (x ->> 'party_id')::uuid = g.ca;
  select array_agg(distinct x ->> 'tipo' order by x ->> 'tipo') into tipos from jsonb_array_elements(j) x;
  if tipos is distinct from array['devuelto', 'mensaje', 'peticion', 'recibo_proximo'] then
    raise exception 'PRUEBA GP-2030 · 2: los avisos del cliente no son los esperados: %', tipos;
  end if;
  if exists (select 1 from jsonb_array_elements(j) x where x ->> 'para' = 'portal.g.a2@ejemplo.invalid') then
    raise exception 'PRUEBA GP-2030 · 2: quien solo ve facturas y documentos recibe avisos de recibos, mensajes o peticiones.';
  end if;
  insert into public.conta_portal_aviso (account_id, party_id, tipo, clave, para, estado)
  select g.cuenta, g.ca, x ->> 'tipo', x ->> 'clave', x ->> 'para', 'enviado' from jsonb_array_elements(j) x where x ->> 'tipo' = 'devuelto';
  perform public.conta_portal_avisos_hechos(
    array(select (i #>> '{}')::uuid from jsonb_array_elements(j) x, jsonb_array_elements(x -> 'datos' -> 'ids') i where x ->> 'tipo' = 'mensaje'),
    array(select (x -> 'datos' ->> 'id')::uuid from jsonb_array_elements(j) x where x ->> 'tipo' = 'peticion'));
  select array_agg(distinct x ->> 'tipo' order by x ->> 'tipo') into tipos
    from jsonb_array_elements(public.conta_portal_avisos_pendientes(500)) x where (x ->> 'party_id')::uuid = g.ca;
  if tipos is distinct from array['recibo_proximo'] then raise exception 'PRUEBA GP-2030 · 2: lo ya avisado vuelve a salir: %', tipos; end if;
  raise notice 'GP-2030 · 2: los avisos, solo a quien tiene «todo», y lo ya avisado no se repite. OK';
end $$;

-- ── 4 · La regla de los permisos (nº 5), con las funciones nuevas ──────────────
do $$
declare
  puede_con_sesion constant text[] := array[
    'conta_portal_ve', 'conta_portal_ruta_puede', 'conta_portal_entrada', 'conta_portal_inicio', 'conta_portal_facturas', 'conta_portal_pagos',
    'conta_portal_documentos', 'conta_portal_trabajadores', 'conta_portal_mensajes', 'conta_portal_cuenta', 'conta_portal_archivo',
    'conta_portal_mensaje_enviar', 'conta_portal_mensajes_leidos', 'conta_portal_solicitud_pedir', 'conta_portal_incidencia_crear',
    'conta_portal_peticion_contestar', 'conta_portal_invitar', 'conta_portal_acceso_quitar', 'conta_portal_firma_comprobar',
    'conta_portal_ficha', 'conta_portal_pendiente', 'conta_portal_peticion_crear', 'conta_portal_peticion_anular',
    'conta_portal_incidencia_resolver', 'conta_portal_ajustes_guardar', 'conta_portal_solicitud_hacer', 'conta_portal_solicitud_rechazar',
    -- GP · T5 (la 2240), si ya está: solo cuentas demo y solo quien las lleva.
    'conta_portal_demo_preparar'];
  solo_servidor constant text[] := array[
    '_conta_portal_yo', '_conta_portal_empresa', '_conta_portal_marca', '_conta_portal_estado_recibo', '_conta_portal_devuelto_pagado',
    '_conta_portal_devueltos', '_conta_portal_proximo', '_conta_portal_cuenta_propia', 'conta_portal_acceso_usuario', 'conta_portal_firma_pedir',
    'conta_portal_firma_pdf', 'conta_portal_incidencia_parada', 'conta_portal_archivo', 'conta_portal_avisos_pendientes', 'conta_portal_avisos_hechos'];
  -- Las que solo llama el dueño de la base (el cron).
  solo_cron constant text[] := array['conta_portal_despertar'];
  f record; malos text[] := '{}'; n int := 0;
begin
  for f in select p.oid, p.proname, p.oid::regprocedure::text as firma from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and (p.proname like 'conta\_portal\_%' or p.proname like '\_conta\_portal\_%') loop
    n := n + 1;
    if has_function_privilege('anon', f.oid, 'execute') then malos := malos || ('anon puede llamar a ' || f.firma); end if;
    if has_function_privilege('authenticated', f.oid, 'execute') <> (f.proname = any (puede_con_sesion)) then
      malos := malos || (case when f.proname = any (puede_con_sesion) then 'authenticated NO puede llamar a ' else 'authenticated puede llamar a ' end || f.firma);
    end if;
    if f.proname = any (solo_servidor) and not has_function_privilege('service_role', f.oid, 'execute') then malos := malos || ('service_role no puede llamar a ' || f.firma); end if;
    if not (f.proname = any (puede_con_sesion) or f.proname = any (solo_servidor) or f.proname = any (solo_cron)) then malos := malos || ('función del portal sin decidir quién la llama: ' || f.firma); end if;
  end loop;
  if n < 42 then raise exception 'PRUEBA GP-2030 · 4: solo hay % funciones del portal; deberían ser 42 o más.', n; end if;
  if cardinality(malos) > 0 then raise exception 'PRUEBA GP-2030 · 4: permisos que no son los decididos: %', array_to_string(malos, '; '); end if;
  raise notice 'GP-2030 · 4: las % funciones del portal, cada una con los permisos decididos. OK', n;
end $$;

-- ── 5 · La vuelta atrás ────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261109T2030_gp_portal_gestoria.down.sql
do $$ begin
  if to_regprocedure('public.conta_portal_solicitud_hacer(uuid,uuid)') is not null or to_regprocedure('public.conta_portal_avisos_pendientes(int)') is not null
     or to_regprocedure('public.conta_portal_despertar()') is not null
     or position('cuenta_final' in pg_get_functiondef('public._conta_portal_proximo(uuid,uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA GP-2030 · 5: la vuelta atrás deja algo, o public._conta_portal_proximo no vuelve a como estaba.';
  end if;
  raise notice 'GP-2030 · 5: la vuelta atrás no deja nada y public._conta_portal_proximo vuelve a como estaba. OK';
end $$;

rollback;
