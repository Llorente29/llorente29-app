-- supabase/staging/sql/20261118_e02_lectura_caida_prueba.sql
--
-- SOLO STAGING. Prueba del E02 (20261118T0600_e02_lectura_caida), que el ensayo
-- de staging pone delante en la misma sesión. Todo en una transacción con
-- ROLLBACK: staging no cambia. Lo que crea: las columnas
-- public.document_inbox.read_failure, read_failure_cause y read_failure_at, la
-- tabla public.conta_lectura_estado, public._conta_lectura_caida,
-- public.conta_lectura_estado, public._conta_lectura_vigia y su cron. No
-- cambia nada que exista.
--
-- Monta dos cuentas inventadas (X e Y), cada una con su administrador y su
-- empresa, y llegadas sin leer con cada clase de fallo, con horas fijas
-- respecto a «ahora» (now() es el de la transacción). Antes, aparta las caídas
-- y las lecturas buenas que ya haya en staging para que no cuenten (dentro de
-- la transacción: el ROLLBACK lo devuelve todo).
--
--   1. Lo que crea y sus permisos.
--   2. Una llegada de «este documento» no hace caer la lectura.
--   3. El tope de gasto la hace caer a la primera; X ve que espera 1; Y ve la
--      caída (común) pero 0 esperando, y no ve las llegadas de X.
--   4. El vigía avisa una vez y no repite.
--   5. Una lectura buena la devuelve: «ha vuelto», una vez.
--   6. Otra caída: dos en 15 minutos no la hacen caer; tres sí.
--   7. La vuelta atrás quita todo.
--
-- Como el cliente: u o v en request.jwt.claims, con el rol authenticated.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA E02: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · Apartar lo que ya hay (solo dentro de esta transacción) y montar X e Y ------------------
update public.document_inbox set read_failure = null, read_failure_cause = null, read_failure_at = null where read_failure is not null;
update public.goods_receipt_ai_session set status = 'failed' where status <> 'failed' and created_at > now() - interval '25 hours';
delete from public.system_alert_queue where kind in ('conta_lectura_caida', 'conta_lectura_vuelta') and status = 'pending';
do $$
declare
  u constant uuid := 'ae020000-0000-4000-8000-000000000001';
  v constant uuid := 'ae020000-0000-4000-8000-000000000002';
  x constant uuid := 'ae020000-0000-4000-8000-000000000010';
  y constant uuid := 'ae020000-0000-4000-8000-000000000020';
  cx constant uuid := 'ae020000-0000-4000-8000-000000000011';
  cy constant uuid := 'ae020000-0000-4000-8000-000000000021';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', w.id, 'authenticated', 'authenticated', w.correo,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    from (values (u, 'x@e02-prueba.test'), (v, 'y@e02-prueba.test')) w(id, correo);
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    (x, 'Prueba E02 X', 'e02-prueba-x', 'active', 'otra_actividad', 'contabilidad'), (y, 'Prueba E02 Y', 'e02-prueba-y', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, x, 'admin', true, 'Prueba E02 X', now(), now()), (v, y, 'admin', true, 'Prueba E02 Y', now(), now());
  insert into public.company (id, account_id, legal_name, tax_id, setup_step) values
    (cx, x, 'Prueba E02 X, S.L.', 'B00000000', 'nombre'), (cy, y, 'Prueba E02 Y, S.L.', 'A00000000', 'nombre');
end $$;

-- Una llegada sin leer, con su clase, en X, a una hora respecto a «ahora».
create function pg_temp.e02_llegada(p_n int, p_clase text, p_causa text, p_hace interval) returns void language sql as $f$
  insert into public.document_inbox (account_id, company_id, channel, status, file_path, file_name, mime_type, size_bytes, reason,
                                     read_failure, read_failure_cause, read_failure_at, created_at, updated_at)
  values ('ae020000-0000-4000-8000-000000000010', 'ae020000-0000-4000-8000-000000000011', 'subida', 'error',
          'ae020000-0000-4000-8000-000000000010/e02/' || p_n || '.pdf', p_n || '.pdf', 'application/pdf', 1000, 'No se ha podido leer.',
          p_clase, p_causa, now() - p_hace, now() - p_hace, now() - p_hace)
$f$;
-- Una lectura que sale bien (de cualquier cuenta), a una hora respecto a «ahora».
create function pg_temp.e02_buena(p_hace interval) returns void language sql as $f$
  insert into public.goods_receipt_ai_session (account_id, kind, status, created_at, updated_at)
  values ('ae020000-0000-4000-8000-000000000020', 'pdf', 'pending_review', now() - p_hace, now() - p_hace)
$f$;
create function pg_temp.e02_caida() returns boolean language sql as $f$ select (public._conta_lectura_caida() ->> 'caida')::boolean $f$;

-- 1 · Lo que crea y sus permisos ----------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'document_inbox' and column_name = 'read_failure_cause') then
    raise exception 'PRUEBA E02 · 1: faltan las columnas de document_inbox.';
  end if;
  if has_function_privilege('authenticated', 'public._conta_lectura_caida()', 'execute')
     or has_function_privilege('authenticated', 'public._conta_lectura_vigia()', 'execute')
     or has_function_privilege('anon', 'public.conta_lectura_estado(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.conta_lectura_estado(uuid)', 'execute') then
    raise exception 'PRUEBA E02 · 1: los permisos de las funciones no son los esperados.';
  end if;
  begin
    perform pg_temp.e02_llegada(99, 'caida', null, interval '0');
    raise exception 'PRUEBA E02 · 1: el CHECK deja una clase sin causa.';
  exception when check_violation then null;
  end;
  begin
    perform pg_temp.e02_llegada(98, 'otra', 'tiempo', interval '0');
    raise exception 'PRUEBA E02 · 1: el CHECK deja una clase que no es caida ni documento.';
  exception when check_violation then null;
  end;
  raise notice '1 OK: las columnas, sus dos CHECK y los permisos.';
end $$;

-- 2 · «Este documento» no hace caer la lectura -----------------------------------------------------
do $$ begin
  perform pg_temp.e02_buena(interval '2 hours');
  perform pg_temp.e02_llegada(1, 'documento', 'cortada', interval '30 minutes');
  perform pg_temp.e02_llegada(2, 'documento', 'no_json', interval '20 minutes');
  perform pg_temp.e02_llegada(3, 'documento', 'sin_minimo', interval '10 minutes');
  if pg_temp.e02_caida() then raise exception 'PRUEBA E02 · 2: tres de «este documento» la han dado por caída: %', public._conta_lectura_caida(); end if;
  raise notice '2 OK: tres «este documento» seguidos no son una caída: %', public._conta_lectura_caida();
end $$;

-- 3 · El tope de gasto, a la primera; común a todos, pero cada uno ve las suyas ---------------------
do $$ begin
  perform pg_temp.e02_llegada(4, 'caida', 'tope_gasto', interval '5 minutes');
  if not pg_temp.e02_caida() then raise exception 'PRUEBA E02 · 3: una de tope de gasto no la da por caída: %', public._conta_lectura_caida(); end if;
  raise notice '3a OK: una de tope de gasto, caída a la primera: %', public._conta_lectura_caida();
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'ae020000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.conta_lectura_estado('ae020000-0000-4000-8000-000000000011');
  if r <> '{"caida": true, "esperando": 1}'::jsonb then raise exception 'PRUEBA E02 · 3: X no ve la caída con 1 esperando: %', r; end if;
  raise notice '3b OK: X ve %', r;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'ae020000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare r jsonb; n int; v_msg text; begin
  r := public.conta_lectura_estado('ae020000-0000-4000-8000-000000000021');
  if r <> '{"caida": true, "esperando": 0}'::jsonb then raise exception 'PRUEBA E02 · 3: Y no ve la caída común con 0 esperando: %', r; end if;
  select count(*) into n from public.document_inbox where account_id = 'ae020000-0000-4000-8000-000000000010';
  if n <> 0 then raise exception 'PRUEBA E02 · 3: Y ve % llegadas de X.', n; end if;
  begin
    perform public.conta_lectura_estado('ae020000-0000-4000-8000-000000000011');
    raise exception 'PRUEBA E02 · 3: Y ha leído el estado de la empresa de X.';
  exception when no_data_found then get stacked diagnostics v_msg = message_text;
  end;
  raise notice '3c OK: Y ve % (la caída es común), 0 llegadas de X, y la empresa de X no: «%»', r, v_msg;
end $$;
reset role;

-- 4 · El vigía avisa una vez y no repite -------------------------------------------------------------
do $$ declare a jsonb; b jsonb; n int; m text; begin
  a := public._conta_lectura_vigia();
  b := public._conta_lectura_vigia();
  select count(*), max(message) into n, m from public.system_alert_queue where kind = 'conta_lectura_caida' and status = 'pending';
  if a ->> 'hecho' <> 'aviso de caída' or b ->> 'hecho' <> 'nada' or n <> 1 then
    raise exception 'PRUEBA E02 · 4: el vigía no avisa una vez (% · % · % en cola).', a ->> 'hecho', b ->> 'hecho', n;
  end if;
  raise notice '4 OK: el vigía avisa una vez y la segunda no repite. El aviso: %', m;
end $$;

-- 5 · Una lectura buena la devuelve: «ha vuelto», una vez ----------------------------------------------
do $$ declare a jsonb; b jsonb; n int; m text; begin
  perform pg_temp.e02_buena(interval '1 minute');
  if pg_temp.e02_caida() then raise exception 'PRUEBA E02 · 5: después de una lectura buena sigue caída.'; end if;
  a := public._conta_lectura_vigia();
  b := public._conta_lectura_vigia();
  select count(*), max(message) into n, m from public.system_alert_queue where kind = 'conta_lectura_vuelta' and status = 'pending';
  if a ->> 'hecho' <> 'aviso de vuelta' or b ->> 'hecho' <> 'nada' or n <> 1 then
    raise exception 'PRUEBA E02 · 5: la vuelta no se avisa una vez (% · % · %).', a ->> 'hecho', b ->> 'hecho', n;
  end if;
  raise notice '5 OK: vuelve con la primera lectura buena y se avisa una vez: %', m;
end $$;

-- 6 · Otra caída: dos en 15 minutos no; tres sí ---------------------------------------------------------
do $$ begin
  perform pg_temp.e02_llegada(5, 'caida', 'proveedor', interval '40 seconds');
  perform pg_temp.e02_llegada(6, 'caida', 'limite', interval '30 seconds');
  if pg_temp.e02_caida() then raise exception 'PRUEBA E02 · 6: dos caídas en 15 minutos ya la dan por caída: %', public._conta_lectura_caida(); end if;
  if (public._conta_lectura_vigia() ->> 'hecho') <> 'nada' then raise exception 'PRUEBA E02 · 6: el vigía avisa con dos.'; end if;
  perform pg_temp.e02_llegada(7, 'caida', 'proveedor', interval '20 seconds');
  if not pg_temp.e02_caida() then raise exception 'PRUEBA E02 · 6: tres caídas en 15 minutos no la dan por caída: %', public._conta_lectura_caida(); end if;
  if (public._conta_lectura_vigia() ->> 'hecho') <> 'aviso de caída' then raise exception 'PRUEBA E02 · 6: el vigía no avisa con tres.'; end if;
  raise notice '6 OK: con dos, nada; con tres en 15 minutos, caída y aviso: %', public._conta_lectura_caida();
end $$;

-- 7 · La vuelta atrás --------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261118T0600_e02_lectura_caida.down.sql
do $$ begin
  if to_regprocedure('public._conta_lectura_caida()') is not null or to_regprocedure('public.conta_lectura_estado(uuid)') is not null
     or to_regprocedure('public._conta_lectura_vigia()') is not null or to_regclass('public.conta_lectura_estado') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'document_inbox' and column_name like 'read_failure%') then
    raise exception 'PRUEBA E02 · 7: la vuelta atrás dejó algo.';
  end if;
  raise notice '7 OK: la vuelta atrás quita las funciones, la tabla, los índices y las columnas.';
  raise notice 'PRUEBA E02: 7 de 7 bien.';
end $$;

rollback;
