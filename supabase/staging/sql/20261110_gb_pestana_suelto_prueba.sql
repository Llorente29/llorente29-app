-- supabase/staging/sql/20261110_gb_pestana_suelto_prueba.sql
--
-- SOLO STAGING. Prueba de la 1010 del GB (nº 17, B: «Facturar un trabajo»
-- desde la pestaña de Bitrix24). Necesita la 2345 (Code 3) y la 0700 (Code 1),
-- que ya están en staging; si falta alguna, para y lo dice. Va después de la
-- 0950: si no está, la pasa antes (y lo que pide). Todo en ROLLBACK, datos inventados (T11).
--
--   1. Los servicios «cada vez» con su precio y los trabajos sueltos, como la
--      persona; quien solo puede ver, «sin_permiso»; otra empresa, no.
--   2. Ponerlo: la línea «suelto» con la función de Code 1 (con el precio de la
--      tarifa o con otro), apuntado con lo que necesita la función para Bitrix24;
--      sale en lo leído después.
--   3. Quien solo puede ver no lo pone; un importe de cero, tampoco (lo dice).
--   4. Solo el servidor; y la vuelta atrás.
--
-- sin usuario: lo llama el servidor (service_role) y dentro actúa como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-1010: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public._conta_portal_bitrix_quien(text,text,text,text)') is null or to_regprocedure('public.conta_trabajo_suelto_poner(uuid,uuid,uuid,text,numeric)') is null then
    raise exception 'PRUEBA GB-1010 · 0: faltan la 2345 (Code 3) o la 0700 (Code 1) en esta base.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)') is null as falta_la_2235 \gset
\if :falta_la_2235
\i supabase/migrations/20261109T2235_gb_pestana_alta_baja.sql
\endif
select to_regprocedure('public._conta_bitrix_pestana_bitrix_de(uuid,text,text)') is null as falta_la_2300 \gset
\if :falta_la_2300
\i supabase/migrations/20261109T2300_gb_pestana_portal.sql
\endif
select pg_get_constraintdef(oid) not like '%suelto%' as falta_la_0950 from pg_constraint where conname = 'conta_bitrix_pestana_cambio_accion_check' \gset
\if :falta_la_0950
\i supabase/migrations/20261110T0950_gb_pestana_devuelto.sql
\endif
select to_regprocedure('public.conta_bitrix_pestana_suelto_poner(text,text,text,text,uuid,uuid,text,numeric)') is not null as ya_esta_la_1010 \gset
\if :ya_esta_la_1010
\i supabase/vuelta-atras/20261110T1010_gb_pestana_suelto.down.sql
\endif

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id as usuario, lower(u.email) as correo,
       (select c.id from public.company c where c.account_id = p.account_id and c.is_active order by c.created_at limit 1) as empresa,
       (select c.id from public.company c where c.account_id <> p.account_id order by c.created_at limit 1) as otra_empresa,
       null::uuid as cliente, null::uuid as servicio
  from public.user_profiles p join auth.users u on u.id = p.user_id
 where p.active and p.role in ('admin', 'manager') and u.email is not null
   and exists (select 1 from public.company c where c.account_id = p.account_id and c.is_active)
 order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); c1 uuid; s uuid; ver uuid := 'b0000000-0000-4000-8000-000000001010';
begin
  if a is null or e is null then raise exception 'PRUEBA GB-1010 · 0: staging no tiene una persona con empresa.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal, mapa) values (a, 'bitrix24', 'pruebas', 'gb-prueba-a.bitrix24.es', '{"campos":[]}')
  on conflict (account_id, crm) do update set portal = excluded.portal;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 1010, S.L.', 'B00001010') returning id into c1;
  insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha)
  values (a, 'bitrix24', 'empresa', '91010', '', c1, 'activo', '{}');
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'gb1010_renta', 'Renta de prueba GB 1010', 'fijo_mes') returning id into s;
  insert into public.conta_precio (account_id, company_id, servicio_id, forma, periodo, importe, desde) values (a, e, s, 'fijo', 'vez', 80, '2026-01-01');
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', ver, 'authenticated', 'authenticated', 'solo.ver.1010@gb-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.user_profiles (user_id, account_id, role, active, display_name) values (ver, a, 'worker', true, 'Solo ver GB 1010');
  update _u set cliente = c1, servicio = s;
end $$;

\i supabase/migrations/20261110T1010_gb_pestana_suelto.sql

create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to service_role;
grant select on _u to service_role;
set local role service_role;
do $$
declare u record; p text := 'gb-prueba-a.bitrix24.es';
begin
  select * into u from _u;
  insert into _r values ('leer', public.conta_bitrix_pestana_sueltos(p, u.correo, 'empresa', '91010', u.empresa));
  insert into _r values ('leer_ver', public.conta_bitrix_pestana_sueltos(p, 'solo.ver.1010@gb-prueba.test', 'empresa', '91010', u.empresa));
  insert into _r values ('leer_otra', public.conta_bitrix_pestana_sueltos(p, u.correo, 'empresa', '91010', u.otra_empresa));
  insert into _r values ('poner', public.conta_bitrix_pestana_suelto_poner(p, u.correo, 'empresa', '91010', u.empresa, u.servicio, 'Renta 2025 de prueba', 72.60));
  insert into _r values ('tarifa', public.conta_bitrix_pestana_suelto_poner(p, u.correo, 'empresa', '91010', u.empresa, u.servicio, null, null));
  insert into _r values ('poner_ver', public.conta_bitrix_pestana_suelto_poner(p, 'solo.ver.1010@gb-prueba.test', 'empresa', '91010', u.empresa, u.servicio, 'x', 10));
  insert into _r values ('cero', public.conta_bitrix_pestana_suelto_poner(p, u.correo, 'empresa', '91010', u.empresa, u.servicio, 'x', 0));
  insert into _r values ('despues', public.conta_bitrix_pestana_sueltos(p, u.correo, 'empresa', '91010', u.empresa));
end $$;
reset role;

do $$
declare u record; l jsonb := (select x.r from _r x where x.paso = 'leer'); po jsonb := (select x.r from _r x where x.paso = 'poner');
        t jsonb := (select x.r from _r x where x.paso = 'tarifa'); d jsonb := (select x.r from _r x where x.paso = 'despues');
begin
  select * into u from _u;
  -- 1 · Lo que se puede facturar, con su precio.
  if l->>'estado' <> 'ok' or not exists (select 1 from jsonb_array_elements(l->'servicios') s where s->>'servicio_id' = u.servicio::text and (s->>'importe')::numeric = 80)
     or jsonb_array_length(l->'hechos') <> 0 then
    raise exception 'PRUEBA GB-1010 · 1: lo leído no es lo esperado (%).', l;
  end if;
  if (select x.r->>'estado' from _r x where x.paso = 'leer_ver') <> 'sin_permiso' or (select x.r->>'estado' from _r x where x.paso = 'leer_otra') <> 'no_se_pudo' then
    raise exception 'PRUEBA GB-1010 · 1: solo ver u otra empresa no son lo esperado.';
  end if;
  -- 2 · Ponerlo, con otro importe y con el de la tarifa; apuntado; y se ve después.
  if po->>'estado' <> 'ok' or po->>'frase' not like 'Sumado al recibo de % de Cliente Prueba GB 1010, S.L.: Renta 2025 de prueba, 72,60 €.%'
     or (po->>'importe')::numeric <> 72.60 or not (po ? 'bitrix') or po->>'cliente' <> u.cliente::text then
    raise exception 'PRUEBA GB-1010 · 2: ponerlo no es lo esperado (%).', po;
  end if;
  if t->>'estado' <> 'ok' or (t->>'importe')::numeric <> 80 or t->>'concepto' <> 'Renta de prueba GB 1010' then
    raise exception 'PRUEBA GB-1010 · 2: con el de la tarifa no es lo esperado (%).', t;
  end if;
  if not exists (select 1 from public.conta_linea where id = (po->>'id')::uuid and tipo = 'suelto' and party_id = u.cliente and importe_propio = 72.60)
     or not exists (select 1 from public.conta_bitrix_pestana_cambio where id = (po->>'cambio')::uuid and accion = 'suelto' and resultado_id = (po->>'id')::uuid) then
    raise exception 'PRUEBA GB-1010 · 2: no está la línea o no ha quedado apuntado.';
  end if;
  if jsonb_array_length(d->'hechos') <> 2 then raise exception 'PRUEBA GB-1010 · 2: después tenían que salir los dos (%).', d->'hechos'; end if;
  -- 3 · Solo ver, y un importe de cero.
  if (select x.r->>'estado' from _r x where x.paso = 'poner_ver') <> 'sin_permiso'
     or (select x.r->>'estado' from _r x where x.paso = 'cero') <> 'no_se_pudo' or (select x.r->>'frase' from _r x where x.paso = 'cero') <> 'El importe tiene que ser mayor que cero.' then
    raise exception 'PRUEBA GB-1010 · 3: solo ver o el importe de cero no son lo esperado.';
  end if;
  -- 4 · Solo el servidor.
  if has_function_privilege('authenticated', 'public.conta_bitrix_pestana_sueltos(text,text,text,text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.conta_bitrix_pestana_suelto_poner(text,text,text,text,uuid,uuid,text,numeric)', 'execute')
     or has_function_privilege('anon', 'public.conta_bitrix_pestana_suelto_poner(text,text,text,text,uuid,uuid,text,numeric)', 'execute') then
    raise exception 'PRUEBA GB-1010 · 4: no es solo del servidor.';
  end if;
  raise notice 'GB-1010 · 1 a 4: lo que se puede facturar, ponerlo con la función de Code 1 (con su importe o el de la tarifa), apuntado, solo ver y el cero no, y solo el servidor. OK';
end $$;

\i supabase/vuelta-atras/20261110T1010_gb_pestana_suelto.down.sql
do $$ begin
  if to_regprocedure('public.conta_bitrix_pestana_suelto_poner(text,text,text,text,uuid,uuid,text,numeric)') is not null then raise exception 'PRUEBA GB-1010 · 4: la vuelta atrás no la quita.'; end if;
  raise notice 'GB-1010 · 4: la vuelta atrás las quita. OK';
end $$;

rollback;
