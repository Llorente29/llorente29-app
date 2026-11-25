-- supabase/staging/sql/20261125_r19a_copia_gocardless_prueba.sql
--
-- SOLO STAGING. Prueba del R19 · paso 0 (20261125T1115_r19a_copia_gocardless), que el ensayo de staging pone delante
-- en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
--
-- Dos cuentas inventadas, cada una con una empresa y lo leído de su GoCardless (inventado, T11): clientes, un mandato,
-- tres suscripciones (dos activas, una el día 4 del mes que viene y otra el del siguiente; una cancelada) y un cobro.
-- Por sus CAMINOS:
--   1. Lo que crea y los permisos: tomar la copia, solo el servidor; las tablas, solo leer.
--   2. Tomar la copia: guarda todo lo leído de la empresa (y nada de la otra), con sus totales y su huella.
--   3. Sin poder cambiarse: update, delete y truncate paran, en la cabecera y en las filas.
--   4. La forma de contar: solo las activas con su próximo cobro en el mes; sin mes, el del próximo cobro.
--   5. Otra lectura con un importe cambiado: otra copia; la primera sigue igual (misma huella y mismo importe).
--   6. Como usuario: la administradora ve las copias de su empresa y lo copiado; las de la otra cuenta, no.
--   7. La vuelta atrás (el fichero de verdad) lo quita todo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R19a: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

do $$
declare
  u constant uuid := 'ae190000-0000-4000-8000-000000000001';
  x constant uuid := 'ae190000-0000-4000-8000-000000000010';
  y constant uuid := 'ae190000-0000-4000-8000-000000000011';
  ex constant uuid := 'ae190000-0000-4000-8000-000000000020';
  ey constant uuid := 'ae190000-0000-4000-8000-000000000021';
  d1 date := (date_trunc('month', current_date) + interval '1 month' + interval '3 day')::date;
  d2 date := (date_trunc('month', current_date) + interval '2 month' + interval '3 day')::date;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'admin@r19a-prueba.test',
         extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    (x, 'Prueba R19a', 'r19a-prueba', 'active', 'otra_actividad', 'contabilidad'),
    (y, 'Prueba R19a otra', 'r19a-prueba-otra', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, x, 'admin', true, 'Prueba R19a', now(), now());
  insert into public.company (id, account_id, legal_name) values (ex, x, 'Empresa de prueba R19a, S.L.'), (ey, y, 'Otra empresa de prueba R19a, S.L.');
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, correo, nif) values
    (ex, 'CUR19A1', x, 'Cliente Uno de prueba', 'uno@example.com', 'B00000011'), (ex, 'CUR19A2', x, 'Cliente Dos de prueba', null, null),
    (ey, 'CUR19B1', y, 'Cliente de la otra cuenta', null, null);
  insert into public.conta_gc_mandato (company_id, gc_id, account_id, gc_cliente_id, estado) values (ex, 'MDR19A1', x, 'CUR19A1', 'active');
  insert into public.conta_gc_suscripcion (company_id, gc_id, account_id, gc_cliente_id, nombre, importe, estado, proximo_cobro_fecha, proximo_cobro_importe) values
    (ex, 'SBR19A1', x, 'CUR19A1', 'GESTORIA MENSUAL', 60.50, 'active', d1, 60.50),
    (ex, 'SBR19A2', x, 'CUR19A2', 'GESTION LABORAL', 72.60, 'active', d2, 72.60),
    (ex, 'SBR19A3', x, 'CUR19A1', 'VIEJA', 10.00, 'cancelled', null, null),
    (ey, 'SBR19B1', y, 'CUR19B1', 'DE LA OTRA', 99.00, 'active', d1, 99.00);
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, mandato_gc_id, suscripcion_gc_id, estado, fecha, importe) values
    (ex, 'PMR19A1', x, 'MDR19A1', 'SBR19A1', 'paid_out', current_date - 20, 60.50);
end $$;

-- 1 · Lo que crea y los permisos
do $$ begin
  if to_regclass('public.conta_gc_copia') is null or to_regclass('public.conta_gc_copia_fila') is null
     or to_regprocedure('public.conta_gc_copia_tomar(uuid,uuid,text,text)') is null
     or to_regprocedure('public.conta_gc_contar_copia(uuid,date)') is null or to_regprocedure('public.conta_gc_copias(uuid)') is null then
    raise exception 'PRUEBA R19a · 1: falta algo';
  end if;
  if has_function_privilege('authenticated', 'public.conta_gc_copia_tomar(uuid,uuid,text,text)', 'execute')
     or has_function_privilege('anon', 'public.conta_gc_copia_tomar(uuid,uuid,text,text)', 'execute') then raise exception 'PRUEBA R19a · 1: tomar la copia, solo el servidor'; end if;
  if has_table_privilege('authenticated', 'public.conta_gc_copia', 'insert') or has_table_privilege('authenticated', 'public.conta_gc_copia_fila', 'update')
     or has_table_privilege('authenticated', 'public.conta_gc_copia', 'delete') then raise exception 'PRUEBA R19a · 1: una sesión solo lee las copias'; end if;
  raise notice 'PRUEBA R19a · 1 OK: tablas y funciones; tomar, solo el servidor; las copias, solo leerlas';
end $$;

-- 2 · Tomar la copia
do $$ declare r jsonb; n int; o int; begin
  r := public.conta_gc_copia_tomar('ae190000-0000-4000-8000-000000000020', null, 'persona', 'Persona de prueba');
  if (r->>'clientes')::int <> 2 or (r->>'mandatos')::int <> 1 or (r->>'suscripciones')::int <> 3 or (r->>'cobros')::int <> 1 then
    raise exception 'PRUEBA R19a · 2: los totales no son lo leído: %', r;
  end if;
  select count(*) into n from public.conta_gc_copia_fila where copia_id = (r->>'copia')::uuid;
  select count(*) into o from public.conta_gc_copia_fila where copia_id = (r->>'copia')::uuid and gc_id like '%R19B%';
  if n <> 7 or o <> 0 then raise exception 'PRUEBA R19a · 2: % filas copiadas (esperaba 7), % de la otra cuenta', n, o; end if;
  if (select huella from public.conta_gc_copia where id = (r->>'copia')::uuid) is distinct from r->>'huella' or length(r->>'huella') <> 32 then
    raise exception 'PRUEBA R19a · 2: la huella no es la de la cabecera';
  end if;
  if (select datos->>'proximo_cobro_importe' from public.conta_gc_copia_fila where copia_id = (r->>'copia')::uuid and gc_id = 'SBR19A1') <> '60.50' then
    raise exception 'PRUEBA R19a · 2: el importe no se copió tal cual';
  end if;
  perform set_config('r19a.copia1', r->>'copia', true);
  raise notice 'PRUEBA R19a · 2 OK: la copia guarda los 2 clientes, 1 mandato, 3 suscripciones y 1 cobro de la empresa (nada de la otra), con su huella';
end $$;

-- 3 · Sin poder cambiarse
do $$ declare c uuid := current_setting('r19a.copia1')::uuid; malos int := 0; begin
  begin update public.conta_gc_copia set clientes = 0 where id = c; malos := malos + 1; exception when insufficient_privilege then null; end;
  begin delete from public.conta_gc_copia where id = c; malos := malos + 1; exception when insufficient_privilege then null; end;
  begin update public.conta_gc_copia_fila set datos = '{}' where copia_id = c; malos := malos + 1; exception when insufficient_privilege then null; end;
  begin delete from public.conta_gc_copia_fila where copia_id = c; malos := malos + 1; exception when insufficient_privilege then null; end;
  begin truncate public.conta_gc_copia_fila; malos := malos + 1; exception when insufficient_privilege then null; end;
  if malos > 0 then raise exception 'PRUEBA R19a · 3: % cambios han pasado', malos; end if;
  raise notice 'PRUEBA R19a · 3 OK: ni update, ni delete, ni truncate: la copia no se cambia';
end $$;

-- 4 · La forma de contar
do $$ declare c uuid := current_setting('r19a.copia1')::uuid; k jsonb; k2 jsonb;
  m1 text := to_char(date_trunc('month', current_date) + interval '1 month', 'YYYY-MM');
  m2 date := (date_trunc('month', current_date) + interval '2 month')::date;
begin
  k := public.conta_gc_contar_copia(c);
  if k->>'mes' <> m1 or (k->>'suscripciones')::int <> 1 or (k->>'clientes')::int <> 1 or (k->>'euros')::numeric <> 60.50 then
    raise exception 'PRUEBA R19a · 4: sin mes cuenta %', k;
  end if;
  k2 := public.conta_gc_contar_copia(c, m2);
  if (k2->>'suscripciones')::int <> 1 or (k2->>'euros')::numeric <> 72.60 then raise exception 'PRUEBA R19a · 4: con mes cuenta %', k2; end if;
  raise notice 'PRUEBA R19a · 4 OK: cuenta solo las activas con su próximo cobro en el mes (60,50 € el próximo; 72,60 € el siguiente; la cancelada, no)';
end $$;

-- 5 · Otra lectura con un importe cambiado
do $$ declare c1 uuid := current_setting('r19a.copia1')::uuid; h1 text; r jsonb; begin
  select huella into h1 from public.conta_gc_copia where id = c1;
  update public.conta_gc_suscripcion set proximo_cobro_importe = 66.55, importe = 66.55 where company_id = 'ae190000-0000-4000-8000-000000000020' and gc_id = 'SBR19A1';
  r := public.conta_gc_copia_tomar('ae190000-0000-4000-8000-000000000020', null, 'cada_noche', null);
  if r->>'huella' = h1 then raise exception 'PRUEBA R19a · 5: la copia nueva tiene la misma huella'; end if;
  if (select huella from public.conta_gc_copia where id = c1) <> h1
     or (select datos->>'proximo_cobro_importe' from public.conta_gc_copia_fila where copia_id = c1 and gc_id = 'SBR19A1') <> '60.50' then
    raise exception 'PRUEBA R19a · 5: la primera copia ha cambiado';
  end if;
  if (public.conta_gc_contar_copia((r->>'copia')::uuid)->>'euros')::numeric <> 66.55 then raise exception 'PRUEBA R19a · 5: la nueva no cuenta lo nuevo'; end if;
  raise notice 'PRUEBA R19a · 5 OK: otra lectura, otra copia (66,55 €); la primera sigue con 60,50 € y su huella';
end $$;

-- 6 · Como usuario: la administradora de la cuenta
do $$ begin perform public.conta_gc_copia_tomar('ae190000-0000-4000-8000-000000000021', null, 'cada_noche', null); end $$;
select set_config('r19a.copia_otra', (select id::text from public.conta_gc_copia where company_id = 'ae190000-0000-4000-8000-000000000021'), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ae190000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ declare n int; f int; o int; k jsonb; begin
  select count(*) into n from public.conta_gc_copias('ae190000-0000-4000-8000-000000000020');
  select count(*) into f from public.conta_gc_copia_fila where copia_id = current_setting('r19a.copia1')::uuid;
  select count(*) into o from public.conta_gc_copias('ae190000-0000-4000-8000-000000000021');
  k := public.conta_gc_contar_copia(current_setting('r19a.copia_otra')::uuid);
  if n <> 2 or f <> 7 or o <> 0 or k is not null then raise exception 'PRUEBA R19a · 6: ve % copias, % filas; de la otra cuenta % copias y cuenta %', n, f, o, k; end if;
  if exists (select 1 from public.conta_gc_copia_fila where account_id = 'ae190000-0000-4000-8000-000000000011') then raise exception 'PRUEBA R19a · 6: ve filas de la otra cuenta'; end if;
  begin
    perform public.conta_gc_copia_tomar('ae190000-0000-4000-8000-000000000020', null, 'persona', null);
    raise exception 'PRUEBA R19a · 6: una sesión ha tomado una copia';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA R19a · 6 OK: la administradora ve sus 2 copias y lo copiado; de la otra cuenta, nada; tomar una copia, no puede';
end $$;
reset role;

-- 7 · La vuelta atrás, el fichero de verdad
\i supabase/vuelta-atras/20261125T1115_r19a_copia_gocardless.down.sql
do $$ begin
  if to_regclass('public.conta_gc_copia') is not null or to_regclass('public.conta_gc_copia_fila') is not null
     or to_regprocedure('public.conta_gc_copia_tomar(uuid,uuid,text,text)') is not null then
    raise exception 'PRUEBA R19a · 7: la vuelta atrás dejó algo';
  end if;
  if not exists (select 1 from public.conta_gc_suscripcion where gc_id = 'SBR19A1') then raise exception 'PRUEBA R19a · 7: la vuelta atrás tocó lo leído de GoCardless'; end if;
  raise notice 'PRUEBA R19a · 7 OK: la vuelta atrás quita las copias y deja lo leído';
end $$;

rollback;
