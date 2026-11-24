-- supabase/staging/sql/20261124_r18b_actualizar_bitrix_prueba.sql
--
-- SOLO STAGING. Prueba del R18b (20261124T1730_r18b_actualizar_bitrix), que el ensayo de staging pone delante en
-- la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
--
-- Una cuenta inventada con su CRM conectado (portal crm.asesoriaqbo.es), su administradora u y una persona de la
-- plataforma j (como Julio). Por sus CAMINOS:
--   1. Lo que crea y los permisos (lo que lee el servidor, solo service_role).
--   2. De serie, apagado y sin clave; el servidor lo lee apagado.
--   3. La administradora de la cuenta NO lo enciende; una clave de OTRO portal no se guarda.
--   4. Con Vault (staging): la administradora pega la clave buena; no se devuelve en el estado.
--   5. j lo enciende (con clave); sin clave, no; el servidor lo lee encendido.
--   6. La administradora lo apaga (apagar siempre se puede).
--   7. La vuelta atrás quita funciones y columnas.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R18b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

do $$
declare
  u constant uuid := 'ae180000-0000-4000-8000-000000000001';
  j constant uuid := 'ae180000-0000-4000-8000-000000000002';
  x constant uuid := 'ae180000-0000-4000-8000-000000000010';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', i, 'authenticated', 'authenticated', e,
         extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    from (values (u, 'admin@r18b-prueba.test'), (j, 'plataforma@r18b-prueba.test')) v(i, e);
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values (x, 'Prueba R18b', 'r18b-prueba', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, x, 'admin', true, 'Prueba R18b', now(), now());
  insert into public.platform_admins (user_id, full_name, role, active) values (j, 'Persona de la plataforma (prueba)', 'admin', true);
  insert into public.conta_crm (account_id, crm, entorno, portal, conectada_at, conectada_por_name) values (x, 'bitrix24', 'real', 'crm.asesoriaqbo.es', now(), 'Prueba R18b');
end $$;

-- 1 · Lo que crea y los permisos
do $$ begin
  if to_regprocedure('public.conta_crm_actualizar_poner(uuid,text,boolean,text)') is null
     or to_regprocedure('public.conta_crm_clave_escribir_guardar(uuid,text,text,text)') is null
     or to_regprocedure('public.conta_crm_actualizar_estado(uuid,text)') is null
     or to_regprocedure('public.conta_crm_escribir_de_portal(text)') is null then raise exception 'PRUEBA R18b · 1: falta una función'; end if;
  if has_function_privilege('authenticated', 'public.conta_crm_escribir_de_portal(text)', 'execute') then raise exception 'PRUEBA R18b · 1: la clave no la lee una sesión'; end if;
  if has_function_privilege('anon', 'public.conta_crm_actualizar_poner(uuid,text,boolean,text)', 'execute') then raise exception 'PRUEBA R18b · 1: anon no'; end if;
  raise notice 'PRUEBA R18b · 1 OK: las funciones; lo que lee el servidor, solo el servidor';
end $$;

-- 2 · De serie, apagado y sin clave
do $$ declare e jsonb; r record; begin
  if exists (select 1 from public.conta_crm where account_id = 'ae180000-0000-4000-8000-000000000010' and actualizar is true) then raise exception 'PRUEBA R18b · 2: nace encendido'; end if;
  select * into r from public.conta_crm_escribir_de_portal('CRM.asesoriaqbo.es') limit 1;
  if r.actualizar is distinct from false or r.url is not null then raise exception 'PRUEBA R18b · 2: el servidor no lo lee apagado y sin clave: %', row_to_json(r); end if;
  raise notice 'PRUEBA R18b · 2 OK: de serie, apagado y sin clave (el servidor lo lee así)';
end $$;

-- ¿Hay Vault en esta base? Se mira antes de cambiar de papel (una sesión no ve el esquema vault).
select set_config('r18b.vault', (to_regprocedure('vault.create_secret(text,text,text)') is not null)::text, true);

-- 3 · La administradora no lo enciende; una clave de otro portal no se guarda
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ae180000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ declare e jsonb; begin
  e := public.conta_crm_actualizar_estado('ae180000-0000-4000-8000-000000000010', 'bitrix24');
  if (e->>'actualizar')::boolean or (e->>'clave')::boolean or (e->>'puede_encender')::boolean then raise exception 'PRUEBA R18b · 3: el estado de serie no es apagado, sin clave y sin poder encender: %', e; end if;
  begin
    perform public.conta_crm_actualizar_poner('ae180000-0000-4000-8000-000000000010', 'bitrix24', true, 'Admin');
    raise exception 'PRUEBA R18b · 3: la administradora lo ha encendido';
  exception when insufficient_privilege then null; end;
  begin
    perform public.conta_crm_clave_escribir_guardar('ae180000-0000-4000-8000-000000000010', 'bitrix24', 'https://otro-portal.bitrix24.es/rest/1/abc123/', 'Admin');
    raise exception 'PRUEBA R18b · 3: ha guardado una clave de otro portal';
  exception when invalid_parameter_value then null; end;
  raise notice 'PRUEBA R18b · 3 OK: la administradora no lo enciende (42501); una clave de otro portal no se guarda (22023)';
end $$;

-- 4 · Con Vault: la clave buena se guarda y no se devuelve
do $$ declare e jsonb; begin
  if current_setting('r18b.vault') <> 'true' then raise notice 'PRUEBA R18b · 4: sin Vault en esta base: se salta'; return; end if;
  perform public.conta_crm_clave_escribir_guardar('ae180000-0000-4000-8000-000000000010', 'bitrix24', 'https://crm.asesoriaqbo.es/rest/1/clavedeprueba000/', 'Admin');
  e := public.conta_crm_actualizar_estado('ae180000-0000-4000-8000-000000000010', 'bitrix24');
  if not (e->>'clave')::boolean then raise exception 'PRUEBA R18b · 4: no consta la clave'; end if;
  if e::text like '%clavedeprueba%' then raise exception 'PRUEBA R18b · 4: el estado enseña la clave'; end if;
  raise notice 'PRUEBA R18b · 4 OK: la clave se guarda y el estado no la enseña';
end $$;

-- 5 · La persona de la plataforma lo enciende (con clave)
select set_config('request.jwt.claims', '{"sub":"ae180000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$ declare r jsonb; begin
  if not exists (select 1 from public.conta_crm where account_id = 'ae180000-0000-4000-8000-000000000010' and escribir_ref is not null) then
    begin
      perform public.conta_crm_actualizar_poner('ae180000-0000-4000-8000-000000000010', 'bitrix24', true, 'Julio');
      raise exception 'PRUEBA R18b · 5: se ha encendido sin clave';
    exception when invalid_parameter_value then null; end;
    raise notice 'PRUEBA R18b · 5 OK (sin Vault): sin clave no se enciende (22023)';
    return;
  end if;
  r := public.conta_crm_actualizar_poner('ae180000-0000-4000-8000-000000000010', 'bitrix24', true, 'Julio');
  if not (r->>'actualizar')::boolean then raise exception 'PRUEBA R18b · 5: no se ha encendido: %', r; end if;
  raise notice 'PRUEBA R18b · 5 OK: la persona de la plataforma lo enciende';
end $$;
reset role;
do $$ declare r record; begin
  select * into r from public.conta_crm_escribir_de_portal('crm.asesoriaqbo.es') limit 1;
  if current_setting('r18b.vault') = 'true' and (r.actualizar is distinct from true or r.url is null) then
    raise exception 'PRUEBA R18b · 5: el servidor no lo lee encendido y con su clave';
  end if;
  raise notice 'PRUEBA R18b · 5 OK: el servidor lee el interruptor del portal';
end $$;

-- 6 · La administradora lo apaga
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ae180000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ declare r jsonb; begin
  r := public.conta_crm_actualizar_poner('ae180000-0000-4000-8000-000000000010', 'bitrix24', false, 'Admin');
  if (r->>'actualizar')::boolean then raise exception 'PRUEBA R18b · 6: no se ha apagado'; end if;
  if not exists (select 1 from public.conta_crm where account_id = 'ae180000-0000-4000-8000-000000000010' and actualizar is false and actualizar_por_name = 'Admin') then
    raise exception 'PRUEBA R18b · 6: no queda quién lo apagó';
  end if;
  raise notice 'PRUEBA R18b · 6 OK: la administradora lo apaga, y queda quién';
end $$;
reset role;

-- 7 · La vuelta atrás
\i supabase/vuelta-atras/20261124T1730_r18b_actualizar_bitrix.down.sql
do $$ begin
  if to_regprocedure('public.conta_crm_actualizar_poner(uuid,text,boolean,text)') is not null then raise exception 'PRUEBA R18b · 7: la función sigue'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_crm' and column_name = 'actualizar') then raise exception 'PRUEBA R18b · 7: la columna sigue'; end if;
  raise notice 'PRUEBA R18b · 7 OK: la vuelta atrás quita funciones y columnas';
end $$;

rollback;
