-- ============================================================================
-- PRUEBA (staging) · B01c (0752, que añade, y 0753, que cambia): los
-- movimientos del banco entran solos.
-- Todo en una transacción con ROLLBACK. Datos INVENTADOS, en el banco
-- «B01 · Mercado» (b3) de la semilla del B01, cuenta A.
--
--   1. _bank_cuenta_de_empresa (cambia): la clave de servicio pasa; un usuario
--      sin la cuenta, no (42501), como antes; el administrador de A, sí.
--   2. El camino de la noche, con la clave de servicio: un Norma 43 subido por
--      una persona y, después, lo mismo por la conexión
--      («agregador:open-banking-io») con otras referencias: los dos que ya
--      estaban se reconocen por la huella suave (repetidos 2, nuevos 1: el que
--      no estaba), y la continuidad sigue al extracto de antes.
--   3. bank_agregador_apuntar sobre bank_aggregator_link (la del B01, que
--      cambia: columnas nuevas y el proveedor open_banking_io): como servicio y
--      como administrador; el fallo sin porqué PARA; la segunda pasada no borra
--      la fecha de la última buena (last_sync_at) ni el permiso.
--   4. bank_agregador_conexion_apuntar: solo la clave de servicio.
--   5. bank_agregador_quitar: la quita; un usuario ajeno no puede.
--   6. El despertador fuera de las 3 de Madrid no hace nada; en staging no hay
--      ninguna conexión (Foodint no existe aquí).
--   7. Las dos vueltas atrás (0753 y luego 0752): sin la tabla nueva ni las
--      columnas, el proveedor como en la 0150 y _bank_cuenta_de_empresa como
--      en la 0110.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

create temp table _r (que text primary key, id uuid, texto text) on commit drop;
grant all on _r to authenticated, service_role;

-- ── 1 · Quién trabaja los bancos ────────────────────────────────────────────
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin perform public._bank_cuenta_de_empresa(emp); exception when insufficient_privilege then v := 'no'; end;
  if v is distinct from 'no' then raise exception 'PRUEBA B01c · 1: un usuario sin la cuenta pasó.'; end if;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  if public._bank_cuenta_de_empresa(emp) is distinct from 'c01a0000-0000-4000-8000-00000000000a'::uuid then
    raise exception 'PRUEBA B01c · 1: la clave de servicio no pasó.';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  perform public._bank_cuenta_de_empresa(emp);
  raise notice '1 · la clave de servicio y el administrador pasan; un usuario ajeno, no';
end $$;

-- ── 2 · Norma 43 de una persona, y lo mismo por la conexión ─────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.bank_importar('b0100000-0000-4000-8000-0000000000b3', 'fichero', 'norma43', 'b01c-prueba.n43', repeat('c', 64),
    date '2030-01-10', date '2030-01-10', 1000.00, 950.00, null, null, jsonb_build_array(
      jsonb_build_object('fecha', '2030-01-10', 'importe', -30.00, 'concepto_banco', 'RECIBO INVENTADO B01C', 'huella', 'b01c-n43-1', 'huella_suave', '2030-01-10|-3000|1'),
      jsonb_build_object('fecha', '2030-01-10', 'importe', -20.00, 'concepto_banco', 'TARJETA INVENTADA B01C', 'huella', 'b01c-n43-2', 'huella_suave', '2030-01-10|-2000|1')));
  if (r->>'nuevos')::int <> 2 then raise exception 'PRUEBA B01c · 2: el Norma 43 metió % (tenía que meter 2).', r->>'nuevos'; end if;
  insert into _r values ('n43', (r->>'extracto')::uuid, null);
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
do $$
declare r jsonb;
begin
  -- La conexión trae lo mismo con sus referencias (la huella entera es otra) y uno más, del día siguiente.
  r := public.bank_importar('b0100000-0000-4000-8000-0000000000b3', 'agregador:open-banking-io', 'agregador:open-banking-io', 'open-banking.io · del 2030-01-10 al 2030-01-11', null,
    date '2030-01-10', date '2030-01-11', 1000.00, 935.00, null, null, jsonb_build_array(
      jsonb_build_object('fecha', '2030-01-10', 'importe', -30.00, 'concepto_banco', 'Recibo inventado', 'ref2', 'obi-1', 'huella', '2030-01-10|-3000|||obi-1|1', 'huella_suave', '2030-01-10|-3000|1'),
      jsonb_build_object('fecha', '2030-01-10', 'importe', -20.00, 'concepto_banco', 'Tarjeta inventada', 'ref2', 'obi-2', 'huella', '2030-01-10|-2000|||obi-2|1', 'huella_suave', '2030-01-10|-2000|1'),
      jsonb_build_object('fecha', '2030-01-11', 'importe', -15.00, 'concepto_banco', 'Nuevo inventado', 'ref2', 'obi-3', 'huella', '2030-01-11|-1500|||obi-3|1', 'huella_suave', '2030-01-11|-1500|1')));
  if (r->>'nuevos')::int <> 1 or (r->>'repetidos')::int <> 2 then
    raise exception 'PRUEBA B01c · 2: por la conexión entraron % nuevos y % repetidos (tenían que ser 1 y 2).', r->>'nuevos', r->>'repetidos';
  end if;
  if (select count(*) from public.bank_movement where treasury_account_id = 'b0100000-0000-4000-8000-0000000000b3' and op_date between '2030-01-10' and '2030-01-11') <> 3 then
    raise exception 'PRUEBA B01c · 2: hay movimientos duplicados en el banco.';
  end if;
  if (select source from public.bank_statement where id = (r->>'extracto')::uuid) <> 'agregador:open-banking-io' then raise exception 'PRUEBA B01c · 2: la fuente no quedó.'; end if;
  raise notice '2 · por la conexión, con la clave de servicio: 1 nuevo y 2 reconocidos (continuidad %)', r->>'continuidad';
end $$;

-- ── 3 · Apuntar cómo ha ido ─────────────────────────────────────────────────
do $$
declare l public.bank_aggregator_link; v text;
begin
  perform public.bank_agregador_apuntar('b0100000-0000-4000-8000-0000000000b3', 'open-banking-io', 'acc-prueba', 'sesion-prueba', 'BBVA', timestamptz '2030-04-10 00:00+00', 'https://open-banking.io/app',
    'al_dia', '1 nuevos y 2 que ya estaban.', 935.00, date '2030-01-12', 1, 2, date '2030-01-10', date '2030-01-11');
  select * into l from public.bank_aggregator_link where treasury_account_id = 'b0100000-0000-4000-8000-0000000000b3' and provider = 'open_banking_io';
  if l.last_sync_at is null or l.status <> 'activo' or l.consent_id <> 'sesion-prueba' or l.account_id <> 'c01a0000-0000-4000-8000-00000000000a' or l.bank_balance <> 935.00 or l.bank_name <> 'BBVA' then raise exception 'PRUEBA B01c · 3: no quedó bien apuntada (%).', row_to_json(l); end if;
  begin
    perform public.bank_agregador_apuntar('b0100000-0000-4000-8000-0000000000b3', 'open-banking-io', 'acc-prueba', 'sesion-prueba', 'BBVA', null, null, 'fallo', '  ', null, null, 0, 0, null, null);
  exception when check_violation then v := 'para'; end;  -- 23514, de la función
  if v is distinct from 'para' then raise exception 'PRUEBA B01c · 3: un fallo sin porqué se apuntó.'; end if;
  perform public.bank_agregador_apuntar('b0100000-0000-4000-8000-0000000000b3', 'open-banking-io', 'acc-prueba', 'sesion-prueba', 'BBVA', null, null, 'fallo', 'El banco no contesta.', null, null, 0, 0, null, null);
  select * into l from public.bank_aggregator_link where treasury_account_id = 'b0100000-0000-4000-8000-0000000000b3' and provider = 'open_banking_io';
  if l.last_status <> 'fallo' or l.last_sync_at is null or l.consent_valid_until is null or l.bank_balance is null then
    raise exception 'PRUEBA B01c · 3: el fallo borró lo bueno de antes (%).', row_to_json(l);
  end if;
  raise notice '3 · apuntar como servicio: lo bueno se queda, el fallo lleva su porqué';
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v text;
begin
  perform public.bank_agregador_apuntar('b0100000-0000-4000-8000-0000000000b3', 'simulado', 'acc-prueba-sim', 'sesion-prueba', 'BBVA', timestamptz '2030-04-10 00:00+00', null, 'sin_movimientos', 'Ya estaba al día.', null, null, 0, 0, null, null);
  if (select last_status from public.bank_aggregator_link where treasury_account_id = 'b0100000-0000-4000-8000-0000000000b3' and provider = 'simulado') is distinct from 'sin_movimientos' then
    raise exception 'PRUEBA B01c · 3: el administrador no pudo apuntar.';
  end if;
  if (select count(*) from public.bank_aggregator_link where treasury_account_id = 'b0100000-0000-4000-8000-0000000000b3') <> 2 then raise exception 'PRUEBA B01c · 3: el administrador no la ve.'; end if;
  -- ── 4 · La pasada de la empresa, solo la clave de servicio ───────────────
  begin perform public.bank_agregador_conexion_apuntar(gen_random_uuid(), null); exception when insufficient_privilege then v := 'no'; end;
  if v is distinct from 'no' then raise exception 'PRUEBA B01c · 4: un usuario apuntó la pasada.'; end if;
  raise notice '3 y 4 · el administrador apunta una cuenta y la ve; la pasada de la empresa, no';
end $$;
reset role;

-- ── 5 · Quitar ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v text;
begin
  begin perform public.bank_agregador_quitar('b0100000-0000-4000-8000-0000000000b3'); exception when insufficient_privilege then v := 'no'; end;
  if v is distinct from 'no' then raise exception 'PRUEBA B01c · 5: un usuario ajeno la quitó.'; end if;
  if exists (select 1 from public.bank_aggregator_link) then raise exception 'PRUEBA B01c · 5: un usuario ajeno ve conexiones de A.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform public.bank_agregador_quitar('b0100000-0000-4000-8000-0000000000b3');
  if exists (select 1 from public.bank_aggregator_link where treasury_account_id = 'b0100000-0000-4000-8000-0000000000b3') then raise exception 'PRUEBA B01c · 5: no se quitó.'; end if;
  raise notice '5 · quitar: el administrador sí, un ajeno no (ni la ve)';
end $$;
reset role;

-- ── 6 · El despertador ──────────────────────────────────────────────────────
do $$
begin
  if extract(hour from (now() at time zone 'Europe/Madrid')) <> 3 then perform public.conta_banco_agregador_despertar(); end if;
  if exists (select 1 from public.bank_aggregator_connection where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') then
    raise exception 'PRUEBA B01c · 6: la empresa A tiene conexión y no se ofrece a nadie más que a Foodint.';
  end if;
  raise notice '6 · el despertador fuera de las 3 no hace nada; A sin conexión';
end $$;

-- ── 7 · La vuelta atrás ─────────────────────────────────────────────────────
\ir ../../vuelta-atras/20261029T0753_b01c_servicio_y_proveedor.down.sql
\ir ../../vuelta-atras/20261029T0752_b01c_banco_agregador.down.sql
do $$
begin
  if to_regclass('public.bank_aggregator_connection') is not null then raise exception 'PRUEBA B01c · 7: la tabla nueva sigue.'; end if;
  if to_regclass('public.bank_aggregator_link') is null then raise exception 'PRUEBA B01c · 7: se llevó la tabla del B01.'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bank_aggregator_link' and column_name = 'last_status') then raise exception 'PRUEBA B01c · 7: las columnas nuevas siguen.'; end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'bank_aggregator_link_provider_check')) like '%open_banking_io%' then raise exception 'PRUEBA B01c · 7: el proveedor sigue ampliado.'; end if;
  if pg_get_functiondef('public._bank_cuenta_de_empresa(uuid)'::regprocedure) like '%service_role%' then raise exception 'PRUEBA B01c · 7: _bank_cuenta_de_empresa sigue dejando pasar al servicio.'; end if;
  raise notice '7 · vuelta atrás: sin la tabla nueva ni las columnas, la del B01 en su sitio, y _bank_cuenta_de_empresa como en la 0110';
end $$;

rollback;
