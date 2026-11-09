-- supabase/staging/sql/20261109_gp_portal_base_prueba.sql
--
-- SOLO STAGING. Prueba de la 1530 (GP, la base del portal del cliente). Todo
-- en una transacción con ROLLBACK, con datos inventados (T11): no cambia
-- staging.
--
--   0. Siembra (el servidor): una gestoría (la cuenta de una persona de
--      staging), dos clientes inventados A y B con su cobro, su domiciliación,
--      un recibo próximo, uno devuelto y un trabajador; tres personas del
--      portal: «A todo», «A facturas» y «B todo».
--   1. La gestoría: le pide algo a A, le escribe, le pide una firma y ve su
--      pestaña; quien no es de la cuenta no ve nada.
--   2. «A todo»: entra, lee sus siete pantallas (con su recibo, su devuelto y
--      su trabajador), escribe, pide un alta, dice «No estoy de acuerdo»,
--      invita a otra persona y firma con el código (mal y bien).
--   3. LA PRUEBA DE OTRO CLIENTE: «A todo» pide cada pantalla, cada fichero y
--      cada acción de B, y las tablas de B con la RLS: todo falla o sale vacío.
--   4. «A facturas»: ve facturas y documentos; pagos, mensajes, trabajadores y
--      cuenta, no.
--   5. Sin sesión (anon): ninguna función se puede llamar.
--   6. La vuelta atrás: no queda nada.
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; las lecturas se prueban como cada persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GP-1530: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- Si la 1530 ya está (el aplicar de staging la pasa antes que esta prueba), primero su vuelta atrás: así parte siempre de lo de antes.
select to_regprocedure('public.conta_portal_inicio(uuid)') is not null as ya_esta_la_1530 \gset
\if :ya_esta_la_1530
\i supabase/vuelta-atras/20261109T1530_gp_portal_base.down.sql
\endif
\i supabase/migrations/20261109T1530_gp_portal_base.sql

-- ── 0 · Siembra ────────────────────────────────────────────────────────────────
create temp table _g on commit drop as
select p.account_id as cuenta, p.user_id as gestor,
       (select c.id from public.company c where c.account_id = p.account_id order by c.created_at limit 1) as empresa,
       '0000a1a1-0000-4000-8000-000000001530'::uuid as pa, '0000a2a2-0000-4000-8000-000000001530'::uuid as pa2,
       '0000b1b1-0000-4000-8000-000000001530'::uuid as pb, '0000c1c1-0000-4000-8000-000000001530'::uuid as nadie,
       null::uuid as ca, null::uuid as cb, null::uuid as ra, null::uuid as rdev, null::uuid as rb
  from public.user_profiles p where p.active and p.role = 'admin' order by p.created_at limit 1;

do $$
declare g _g; xa uuid; xb uuid; s uuid; xra uuid; xrdev uuid; xrb uuid; m text := to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM');
        mp text := to_char((now() at time zone 'Europe/Madrid') - interval '1 month', 'YYYY-MM');
begin
  select * into g from _g;
  if g.cuenta is null or g.empresa is null then raise exception 'PRUEBA GP-1530 · 0: staging no tiene un administrador con empresa.'; end if;
  insert into auth.users (id, email) values (g.pa, 'portal.a@ejemplo.invalid'), (g.pa2, 'portal.a2@ejemplo.invalid'),
                                            (g.pb, 'portal.b@ejemplo.invalid'), (g.nadie, 'nadie@ejemplo.invalid');
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Portal A Prueba, S.L.', 'B00001530') returning id into xa;
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Portal B Prueba, S.L.', 'B00002530') returning id into xb;
  insert into public.conta_gestoria_cliente (account_id, party_id, situacion) values (g.cuenta, xa, 'activo'), (g.cuenta, xb, 'activo');
  insert into public.conta_cobro_cliente (account_id, company_id, party_id, forma_cobro, gc_cliente_id)
  values (g.cuenta, g.empresa, xa, 'gocardless', 'CU1530A'), (g.cuenta, g.empresa, xb, 'gocardless', 'CU1530B');
  insert into public.conta_gc_mandato (account_id, company_id, gc_id, gc_cliente_id, estado, creado)
  values (g.cuenta, g.empresa, 'MD1530A', 'CU1530A', 'active', now() - interval '2 years'), (g.cuenta, g.empresa, 'MD1530B', 'CU1530B', 'active', now());
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (g.cuenta, g.empresa, 'laboral_1530', 'Laboral prueba 1530', 'por_empleado') returning id into s;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, empleado_nombre, origen, desde)
  values (g.cuenta, g.empresa, xa, s, 'TRABAJADOR PRUEBA UNO', 'manual', date_trunc('month', now())::date - interval '1 year'),
         (g.cuenta, g.empresa, xb, s, 'TRABAJADOR PRUEBA DE B', 'manual', date_trunc('month', now())::date);
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, lineas, total_cent, anterior_cent, cambios, estado)
  values (g.cuenta, g.empresa, xa, m, 'recibo:' || g.empresa || ':' || xa || ':' || m, '[{"t":"Laboral · 1 trabajador","cent":2420}]', 15730, 13310,
          '[{"t":"+1 trabajador"}]', 'preparado') returning id into xra;
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, estado)
  values (g.cuenta, g.empresa, xa, mp, 'recibo:' || g.empresa || ':' || xa || ':' || mp, 18150, 'devuelto') returning id into xrdev;
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, estado)
  values (g.cuenta, g.empresa, xb, m, 'recibo:' || g.empresa || ':' || xb || ':' || m, 9999, 'preparado') returning id into xrb;
  insert into public.conta_portal_acceso (account_id, party_id, correo, nombre, user_id, permiso)
  values (g.cuenta, xa, 'portal.a@ejemplo.invalid', 'Persona A', g.pa, 'todo'),
         (g.cuenta, xa, 'portal.a2@ejemplo.invalid', 'Persona A2', g.pa2, 'facturas_documentos'),
         (g.cuenta, xb, 'portal.b@ejemplo.invalid', 'Persona B', g.pb, 'todo');
  insert into public.conta_portal_mensaje (account_id, party_id, de, autor_nombre, texto) values (g.cuenta, xb, 'cliente', 'Persona B', 'Mensaje secreto de B');
  insert into public.conta_portal_subida (account_id, party_id, ruta, nombre) values (g.cuenta, xb, g.cuenta || '/' || xb || '/subidas/x.pdf', 'Papel de B.pdf');
  update _g set ca = xa, cb = xb, ra = xra, rdev = xrdev, rb = xrb;
end $$;

grant select on _g to authenticated, anon;
select gestor as gestor, pa as pa, pa2 as pa2, pb as pb, nadie as nadie, ca as ca, cb as cb from _g \gset

-- ── 1 · La gestoría ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'gestor', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare g _g; j jsonb;
begin
  select * into g from _g;
  perform public.conta_portal_peticion_crear(g.ca, 'subir', 'Subir las facturas de compra del mes', null, (now() at time zone 'Europe/Madrid')::date + 20);
  perform public.conta_portal_peticion_crear(g.ca, 'firmar', 'Firmar la hoja de encargo', null, (now() at time zone 'Europe/Madrid')::date + 40,
                                             g.cuenta || '/' || g.ca || '/peticiones/hoja.pdf');
  j := public.conta_portal_mensaje_enviar(g.ca, 'Hola, ¿tiene jornada completa?');
  if j ->> 'de' <> 'gestoria' then raise exception 'PRUEBA GP-1530 · 1: el mensaje de la gestoría sale como %.', j ->> 'de'; end if;
  begin
    perform public.conta_portal_peticion_crear(g.ca, 'firmar', 'Sin PDF', null, null, 'otra/carpeta/hoja.pdf');
    raise exception 'PRUEBA GP-1530 · 1: deja pedir una firma sin el PDF en la carpeta del cliente.';
  exception when sqlstate '22023' then null; end;
  j := public.conta_portal_ficha(g.ca);
  if jsonb_array_length(j -> 'accesos') <> 2 or jsonb_array_length(j -> 'peticiones') <> 2 or jsonb_array_length(j -> 'mensajes') <> 1 then
    raise exception 'PRUEBA GP-1530 · 1: la ficha no trae lo de A: %', j;
  end if;
  if exists (select 1 from jsonb_array_elements(j -> 'accesos') a where a ? 'user_id') then raise exception 'PRUEBA GP-1530 · 1: la ficha enseña el usuario.'; end if;
  perform public.conta_portal_ajustes_guardar(g.cuenta, array['banco', 'tarjeta']);
  raise notice 'GP-1530 · 1: la gestoría pide, escribe, ve su pestaña y guarda sus ajustes. OK';
end $$;

-- ── 2 · «A todo» ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'pa', 'role', 'authenticated')::text, true);
do $$
declare g _g; j jsonb; k jsonb;
begin
  select * into g from _g;
  j := public.conta_portal_entrada();
  if jsonb_array_length(j -> 'clientes') <> 1 or (j -> 'clientes' -> 0 ->> 'cliente_id')::uuid <> g.ca then raise exception 'PRUEBA GP-1530 · 2: la entrada no da solo su cliente: %', j; end if;
  j := public.conta_portal_inicio(null);
  if (j -> 'cliente' ->> 'id')::uuid <> g.ca then raise exception 'PRUEBA GP-1530 · 2: el inicio sin cliente no coge el suyo.'; end if;
  if (j -> 'proximo' ->> 'recibo_id')::uuid <> g.ra or (j -> 'proximo' ->> 'total_cent')::int <> 15730 then raise exception 'PRUEBA GP-1530 · 2: el próximo recibo no es el suyo: %', j -> 'proximo'; end if;
  if jsonb_array_length(j -> 'devueltos') <> 1 or (j -> 'devueltos' -> 0 ->> 'recibo_id')::uuid <> g.rdev then raise exception 'PRUEBA GP-1530 · 2: el devuelto no sale: %', j -> 'devueltos'; end if;
  if jsonb_array_length(j -> 'peticiones') <> 2 or (j ->> 'mensajes_sin_leer')::int <> 1 then raise exception 'PRUEBA GP-1530 · 2: faltan peticiones o mensajes: %', j; end if;
  if j -> 'pagar_devuelto' <> '["banco", "tarjeta"]'::jsonb then raise exception 'PRUEBA GP-1530 · 2: no lee los ajustes: %', j -> 'pagar_devuelto'; end if;
  perform public.conta_portal_facturas(g.ca);
  perform public.conta_portal_documentos(g.ca);
  j := public.conta_portal_pagos(g.ca);
  if jsonb_array_length(j -> 'recibos') <> 2 then raise exception 'PRUEBA GP-1530 · 2: pagos no trae sus dos recibos: %', j; end if;
  j := public.conta_portal_trabajadores(g.ca);
  if jsonb_array_length(j -> 'trabajadores') <> 1 or j -> 'trabajadores' -> 0 ->> 'nombre' <> 'TRABAJADOR PRUEBA UNO' then raise exception 'PRUEBA GP-1530 · 2: trabajadores: %', j; end if;
  j := public.conta_portal_cuenta(g.ca);
  if j -> 'domiciliacion' ->> 'estado' <> 'active' or jsonb_array_length(j -> 'personas') <> 2 then raise exception 'PRUEBA GP-1530 · 2: tu cuenta: %', j; end if;
  perform public.conta_portal_mensajes_leidos(g.ca);
  perform public.conta_portal_mensaje_enviar(g.ca, 'Completa, 40 horas.', jsonb_build_array(jsonb_build_object('ruta', g.cuenta || '/' || g.ca || '/mensajes/contrato.pdf', 'nombre', 'Contrato.pdf')));
  j := public.conta_portal_mensajes(g.ca);
  if jsonb_array_length(j -> 'mensajes') <> 2 or j -> 'mensajes' -> 1 ->> 'de' <> 'cliente' then raise exception 'PRUEBA GP-1530 · 2: la conversación: %', j; end if;
  j := public.conta_portal_solicitud_pedir(g.ca, 'alta', 'Trabajador Prueba Dos', '00000000-T', (now() at time zone 'Europe/Madrid')::date + 3, 'Indefinido', 40);
  if not exists (select 1 from jsonb_array_elements(public.conta_portal_trabajadores(g.ca) -> 'peticiones') x
                  where x ->> 'id' = j ->> 'id' and x ->> 'estado' = 'pedida') then
    raise exception 'PRUEBA GP-1530 · 2: el alta pedida no sale en Trabajadores.';
  end if;
  begin
    perform public.conta_portal_solicitud_pedir(g.ca, 'alta', 'Sin Documento', 'XX', current_date, null, null);
    raise exception 'PRUEBA GP-1530 · 2: deja pedir un alta sin DNI o NIE válido.';
  exception when sqlstate '22023' then null; end;
  j := public.conta_portal_incidencia_crear(g.ca, 'no_de_acuerdo', 'No cuadra el trabajador nuevo', g.ra);
  if not (j ->> 'parar')::boolean or (j ->> 'recibo_id')::uuid <> g.ra or j ->> 'motivo' is null then
    raise exception 'PRUEBA GP-1530 · 2: «No estoy de acuerdo» no devuelve al servidor lo que necesita para pararlo: %', j;
  end if;
  k := public.conta_portal_inicio(g.ca);
  if k -> 'proximo' -> 'incidencia' ->> 'id' is null then raise exception 'PRUEBA GP-1530 · 2: el recibo no enseña su «No estoy de acuerdo».'; end if;
  begin
    perform public.conta_portal_incidencia_crear(g.ca, 'no_de_acuerdo', 'Otra vez', g.ra);
    raise exception 'PRUEBA GP-1530 · 2: deja dos «No estoy de acuerdo» abiertos con el mismo recibo.';
  exception when sqlstate '23505' then null; end;
  perform public.conta_portal_incidencia_crear(g.ca, 'cambio_datos', 'La dirección ha cambiado');
  j := public.conta_portal_invitar(g.ca, 'Administracion@Ejemplo.invalid', 'Administración', 'facturas_documentos');
  if (j ->> 'nuevo')::boolean is not true then raise exception 'PRUEBA GP-1530 · 2: no invita: %', j; end if;
  begin
    perform public.conta_portal_incidencia_parada(gen_random_uuid(), true);
    raise exception 'PRUEBA GP-1530 · 2: la persona del portal llama a una función del servidor.';
  exception when insufficient_privilege then null; end;
  raise notice 'GP-1530 · 2: «A todo» lee sus siete pantallas y escribe, pide, avisa e invita. OK';
end $$;

-- La firma: el servidor pide el código; la persona lo escribe mal y bien.
reset role;
do $$ begin
  if not exists (select 1 from public.conta_solicitud s join _g on s.party_id = _g.ca
                  where s.empleado_documento = '00000000T' and s.horas_semana = 40 and s.tipo_contrato = 'Indefinido' and s.portal_acceso_id is not null) then
    raise exception 'PRUEBA GP-1530 · 2: el alta no se guarda con su DNI o NIE, sus horas, su contrato y quién la pidió.';
  end if;
  if (select count(*) from public.conta_portal_incidencia i join _g on i.party_id = _g.ca) <> 2 then raise exception 'PRUEBA GP-1530 · 2: no están las dos incidencias de A.'; end if;
  -- El servidor apunta lo que contestó conta_recibo_parar (Code 1).
  perform public.conta_portal_incidencia_parada((select i.id from public.conta_portal_incidencia i join _g on i.recibo_id = _g.ra), true, 'Parado.');
  if not (select i.recibo_parado from public.conta_portal_incidencia i join _g on i.recibo_id = _g.ra) then raise exception 'PRUEBA GP-1530 · 2: no apunta el recibo parado.'; end if;
end $$;
select (public.conta_portal_firma_pedir(:'pa', (select id from public.conta_portal_peticion where party_id = :'ca' and tipo = 'firmar'), 'correo', 'p***@ejemplo.invalid')) as firma \gset
select :'firma'::jsonb ->> 'firma_id' as firma_id, :'firma'::jsonb ->> 'codigo' as codigo \gset
select set_config('request.jwt.claims', json_build_object('sub', :'pa', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('gp.firma', :'firma_id', true), set_config('gp.codigo', :'codigo', true);
do $$
declare j jsonb; f uuid := current_setting('gp.firma')::uuid; c text := current_setting('gp.codigo');
begin
  if c !~ '^[0-9]{6}$' then raise exception 'PRUEBA GP-1530 · 2: el código no son 6 cifras.'; end if;
  j := public.conta_portal_firma_comprobar(f, case when c = '000000' then '111111' else '000000' end, '10.0.0.1', 'prueba');
  if (j ->> 'firmada')::boolean then raise exception 'PRUEBA GP-1530 · 2: firma con un código equivocado.'; end if;
  j := public.conta_portal_firma_comprobar(f, c, '10.0.0.1', 'prueba');
  if not (j ->> 'firmada')::boolean then raise exception 'PRUEBA GP-1530 · 2: no firma con el código bueno: %', j; end if;
  if exists (select 1 from jsonb_array_elements(public.conta_portal_inicio(null) -> 'peticiones') x where x ->> 'tipo' = 'firmar') then
    raise exception 'PRUEBA GP-1530 · 2: firmado, pero la petición sigue pendiente.';
  end if;
  begin
    perform codigo_hash from public.conta_portal_firma limit 1;
    raise exception 'PRUEBA GP-1530 · 2: la persona del portal puede leer la huella del código.';
  exception when insufficient_privilege then null; end;
  raise notice 'GP-1530 · 2: la firma con código (mal y bien), con quién, cuándo y desde dónde. OK';
end $$;

reset role;
do $$ begin
  if not exists (select 1 from public.conta_portal_firma fi join public.conta_portal_peticion q on q.id = fi.peticion_id
                  where fi.id = current_setting('gp.firma')::uuid and q.estado = 'hecha' and fi.ip = '10.0.0.1' and fi.firmada_at is not null and fi.intentos = 1) then
    raise exception 'PRUEBA GP-1530 · 2: firmado, pero no guarda cuándo, desde dónde o el intento fallido.';
  end if;
end $$;
set local role authenticated;

-- ── 3 · LA PRUEBA DE OTRO CLIENTE: «A todo» intenta ver y tocar lo de B ──────────
do $$
declare g _g; f text; n int := 0;
begin
  select * into g from _g;
  foreach f in array array[
    'select public.conta_portal_inicio(%L)', 'select public.conta_portal_facturas(%L)', 'select public.conta_portal_pagos(%L)',
    'select public.conta_portal_documentos(%L)', 'select public.conta_portal_trabajadores(%L)', 'select public.conta_portal_mensajes(%L)',
    'select public.conta_portal_cuenta(%L)', 'select public.conta_portal_mensaje_enviar(%L, ''hola'')', 'select public.conta_portal_mensajes_leidos(%L)',
    'select public.conta_portal_solicitud_pedir(%L, ''alta'', ''Intruso'', ''00000000T'', current_date)',
    'select public.conta_portal_incidencia_crear(%L, ''cambio_datos'', ''intruso'')', 'select public.conta_portal_invitar(%L, ''intruso@ejemplo.invalid'', ''x'')',
    'select public.conta_portal_ficha(%L)', 'select public.conta_portal_archivo(%L, ''subida'', gen_random_uuid())']
  loop
    begin
      execute format(f, g.cb);
      raise exception 'PRUEBA GP-1530 · 3: «A» llega a lo de B con: %', f;
    exception when sqlstate '42501' then n := n + 1; end;
  end loop;
  -- Con su propio cliente, pero apuntando a cosas de B.
  begin
    perform public.conta_portal_incidencia_crear(g.ca, 'no_de_acuerdo', 'intruso', g.rb);
    raise exception 'PRUEBA GP-1530 · 3: «A» dice «No estoy de acuerdo» con un recibo de B.';
  exception when sqlstate '42501' then n := n + 1; end;
  begin
    perform public.conta_portal_archivo(g.ca, 'subida', (select id from public.conta_portal_subida where party_id = g.cb limit 1));
    raise exception 'PRUEBA GP-1530 · 3: «A» abre un papel de B.';
  exception when sqlstate 'P0002' then n := n + 1; end;
  begin
    perform public.conta_portal_mensaje_enviar(g.ca, 'adjunto ajeno', jsonb_build_array(jsonb_build_object('ruta', g.cuenta || '/' || g.cb || '/mensajes/x.pdf')));
    raise exception 'PRUEBA GP-1530 · 3: «A» adjunta un fichero de la carpeta de B.';
  exception when sqlstate '42501' then n := n + 1; end;
  -- Las tablas, con la RLS.
  if exists (select 1 from public.conta_portal_mensaje where party_id = g.cb) or exists (select 1 from public.conta_portal_subida where party_id = g.cb)
     or exists (select 1 from public.conta_portal_acceso where party_id = g.cb) then
    raise exception 'PRUEBA GP-1530 · 3: con la RLS, «A» ve filas de B.';
  end if;
  if exists (select 1 from public.conta_recibo) or exists (select 1 from public.conta_solicitud) or exists (select 1 from public.party where id = g.cb) then
    raise exception 'PRUEBA GP-1530 · 3: «A» lee tablas de la gestoría (recibos, peticiones o clientes).';
  end if;
  if public.conta_portal_ruta_puede(g.cuenta || '/' || g.cb || '/subidas/x.pdf', false) or public.conta_portal_ruta_puede(g.cuenta || '/' || g.cb || '/mensajes/x.pdf', true) then
    raise exception 'PRUEBA GP-1530 · 3: el almacén deja a «A» leer o subir en la carpeta de B.';
  end if;
  if not public.conta_portal_ruta_puede(g.cuenta || '/' || g.ca || '/subidas/x.pdf', true) then raise exception 'PRUEBA GP-1530 · 3: el almacén no deja a «A» subir a su carpeta.'; end if;
  if (select count(*) from public.conta_portal_pendiente(g.cuenta) x, jsonb_each(x) e where jsonb_array_length(e.value) > 0) > 0 then
    raise exception 'PRUEBA GP-1530 · 3: «A» ve lo pendiente de la gestoría.';
  end if;
  raise notice 'GP-1530 · 3: «A» pide lo de B de % formas y todas fallan; con la RLS no ve ni una fila de B ni de la gestoría. OK', n;
end $$;

-- ── 4 · «A facturas»: solo facturas y documentos ─────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'pa2', 'role', 'authenticated')::text, true);
do $$
declare g _g; f text; j jsonb;
begin
  select * into g from _g;
  perform public.conta_portal_facturas(g.ca);
  perform public.conta_portal_documentos(g.ca);
  j := public.conta_portal_inicio(g.ca);
  if j -> 'proximo' <> 'null'::jsonb or jsonb_array_length(j -> 'devueltos') <> 0 then raise exception 'PRUEBA GP-1530 · 4: «A facturas» ve recibos en el inicio.'; end if;
  foreach f in array array['select public.conta_portal_pagos(%L)', 'select public.conta_portal_mensajes(%L)', 'select public.conta_portal_trabajadores(%L)',
                           'select public.conta_portal_cuenta(%L)', 'select public.conta_portal_invitar(%L, ''x@ejemplo.invalid'', ''x'')']
  loop
    begin
      execute format(f, g.ca);
      raise exception 'PRUEBA GP-1530 · 4: «A facturas» llega con: %', f;
    exception when sqlstate '42501' then null; end;
  end loop;
  if exists (select 1 from public.conta_portal_mensaje) then raise exception 'PRUEBA GP-1530 · 4: «A facturas» lee los mensajes con la RLS.'; end if;
  raise notice 'GP-1530 · 4: «A facturas» ve facturas y documentos, y nada más. OK';
end $$;

-- Quien no tiene ningún acceso.
select set_config('request.jwt.claims', json_build_object('sub', :'nadie', 'role', 'authenticated')::text, true);
do $$ begin
  if jsonb_array_length(public.conta_portal_entrada() -> 'clientes') <> 0 then raise exception 'PRUEBA GP-1530 · 4: alguien sin acceso tiene clientes.'; end if;
  begin perform public.conta_portal_inicio(null); raise exception 'PRUEBA GP-1530 · 4: alguien sin acceso abre un inicio.';
  exception when sqlstate '42501' then null; end;
  if exists (select 1 from public.conta_portal_acceso) then raise exception 'PRUEBA GP-1530 · 4: alguien sin acceso ve accesos.'; end if;
  raise notice 'GP-1530 · 4: sin acceso, nada. OK';
end $$;

-- ── 5 · Sin sesión ─────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$ begin
  begin perform public.conta_portal_inicio(null); raise exception 'PRUEBA GP-1530 · 5: anon llama a una función del portal.';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.conta_portal_acceso; raise exception 'PRUEBA GP-1530 · 5: anon lee una tabla del portal.';
  exception when insufficient_privilege then null; end;
  raise notice 'GP-1530 · 5: sin sesión, nada. OK';
end $$;
reset role;

-- ── 6 · La vuelta atrás ────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261109T1530_gp_portal_base.down.sql
do $$
begin
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and (p.proname like 'conta_portal%' or p.proname like '_conta_portal%'))
     or exists (select 1 from pg_catalog.pg_class where relnamespace = 'public'::regnamespace and relname like 'conta_portal%')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_solicitud'
                 and column_name in ('empleado_documento', 'fecha_efecto', 'tipo_contrato', 'horas_semana', 'portal_acceso_id')) then
    raise exception 'PRUEBA GP-1530 · 6: la vuelta atrás deja algo.';
  end if;
  raise notice 'GP-1530 · 6: la vuelta atrás no deja nada. OK';
end $$;

rollback;
