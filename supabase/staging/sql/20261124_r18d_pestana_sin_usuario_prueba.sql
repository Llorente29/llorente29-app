-- supabase/staging/sql/20261124_r18d_pestana_sin_usuario_prueba.sql
--
-- SOLO STAGING. Prueba del R18d (20261124T2311_r18d_pestana_sin_usuario), que el ensayo de staging pone delante en
-- la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
--
-- Una cuenta inventada con su CRM conectado a un portal inventado (r18d-prueba.bitrix24.es), su administradora y un
-- cliente enlazado a la empresa 1495 de ese portal. Por sus CAMINOS:
--   1. Lo que crea y los permisos: las dos funciones, solo el servidor (service_role).
--   2. Lo que no entra: ficha rara, persona rara, portal que no es de nadie, y el portal aún sin unir.
--   3. Unir el portal (al instalar la aplicación): una vez; la segunda no cambia la fecha ni quién.
--   4. Una persona de Bitrix24 sin usuario de Sumied abre la 1495: ve el cliente, solo leyendo, con su nombre;
--      queda apuntada (sin correo), y la segunda vez suma.
--   5. Una ficha sin enlazar lo dice, también solo leyendo.
--   6. El mismo portal en dos cuentas: ni se une ni se lee.
--   7. Una cuenta sin administradora activa: no se lee (no hay con qué permisos).
--   8. La vuelta atrás quita funciones, tabla y columnas.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R18d: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

do $$
declare
  u constant uuid := 'ae18d000-0000-4000-8000-000000000001';
  x constant uuid := 'ae18d000-0000-4000-8000-000000000010';
  c constant uuid := 'ae18d000-0000-4000-8000-000000000020';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'admin@r18d-prueba.test',
         extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values (x, 'Prueba R18d', 'r18d-prueba', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, x, 'admin', true, 'Prueba R18d', now(), now());
  insert into public.conta_crm (account_id, crm, entorno, portal, conectada_at, conectada_por_name) values (x, 'bitrix24', 'real', 'r18d-prueba.bitrix24.es', now(), 'Prueba R18d');
  insert into public.party (id, account_id, name) values (c, x, 'Cliente de prueba R18d');
  insert into public.conta_gestoria_cliente (party_id, account_id, crm, tipo_ficha, id_externo) values (c, x, 'bitrix24', 'empresa', '1495');
end $$;

-- 1 · Lo que crea y los permisos
do $$ begin
  if to_regprocedure('public.conta_bitrix_portal_unir(text,text)') is null
     or to_regprocedure('public.conta_bitrix_pestana_leer_portal(text,text,text,text,text)') is null then raise exception 'PRUEBA R18d · 1: falta una función'; end if;
  if to_regclass('public.conta_bitrix_pestana_persona') is null then raise exception 'PRUEBA R18d · 1: falta la tabla de quién mira'; end if;
  if has_function_privilege('authenticated', 'public.conta_bitrix_pestana_leer_portal(text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.conta_bitrix_pestana_leer_portal(text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.conta_bitrix_portal_unir(text,text)', 'execute') then
    raise exception 'PRUEBA R18d · 1: leer como el portal o unirlo, solo el servidor';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_bitrix_pestana_persona' and column_name ~ 'correo|email|token') then
    raise exception 'PRUEBA R18d · 1: la tabla de quién mira no guarda correos ni tokens';
  end if;
  raise notice 'PRUEBA R18d · 1 OK: las funciones y la tabla; solo el servidor; sin correos';
end $$;

-- 2 · Lo que no entra
do $$ declare e text; begin
  e := public.conta_bitrix_pestana_leer_portal('r18d-prueba.bitrix24.es', '7', 'Persona Bitrix', 'empresa', '1495; drop') ->> 'estado';
  if e <> 'ficha_rara' then raise exception 'PRUEBA R18d · 2: ficha rara → %', e; end if;
  e := public.conta_bitrix_pestana_leer_portal('r18d-prueba.bitrix24.es', 'abc', 'Persona Bitrix', 'empresa', '1495') ->> 'estado';
  if e <> 'no_es_sumied' then raise exception 'PRUEBA R18d · 2: persona rara → %', e; end if;
  e := public.conta_bitrix_pestana_leer_portal('otro-portal-r18d.bitrix24.es', '7', 'Persona Bitrix', 'empresa', '1495') ->> 'estado';
  if e <> 'portal_desconocido' then raise exception 'PRUEBA R18d · 2: portal de nadie → %', e; end if;
  e := public.conta_bitrix_pestana_leer_portal('r18d-prueba.bitrix24.es', '7', 'Persona Bitrix', 'empresa', '1495') ->> 'estado';
  if e <> 'portal_sin_unir' then raise exception 'PRUEBA R18d · 2: sin unir → %', e; end if;
  if exists (select 1 from public.conta_bitrix_pestana_persona where portal = 'r18d-prueba.bitrix24.es') then raise exception 'PRUEBA R18d · 2: se apuntó a alguien que no entró'; end if;
  raise notice 'PRUEBA R18d · 2 OK: ficha rara, persona rara, portal de nadie y portal sin unir no entran (ni se apuntan)';
end $$;

-- 3 · Unir el portal, una vez
do $$ declare e text; t1 timestamptz; t2 timestamptz; p text; begin
  e := public.conta_bitrix_portal_unir('R18D-prueba.bitrix24.es', 'Administradora de Bitrix24') ->> 'estado';
  if e <> 'ok' then raise exception 'PRUEBA R18d · 3: unir → %', e; end if;
  select pestana_portal_at, pestana_portal_por into t1, p from public.conta_crm where account_id = 'ae18d000-0000-4000-8000-000000000010';
  if t1 is null or p <> 'Administradora de Bitrix24' then raise exception 'PRUEBA R18d · 3: no quedó unido (% · %)', t1, p; end if;
  perform pg_sleep(0.01);
  e := public.conta_bitrix_portal_unir('r18d-prueba.bitrix24.es', 'Otra persona') ->> 'estado';
  select pestana_portal_at, pestana_portal_por into t2, p from public.conta_crm where account_id = 'ae18d000-0000-4000-8000-000000000010';
  if e <> 'ok' or t2 <> t1 or p <> 'Administradora de Bitrix24' then raise exception 'PRUEBA R18d · 3: la segunda vez cambió (% · % · %)', e, t2, p; end if;
  e := public.conta_bitrix_portal_unir('otro-portal-r18d.bitrix24.es', 'X') ->> 'estado';
  if e <> 'portal_desconocido' then raise exception 'PRUEBA R18d · 3: unir un portal de nadie → %', e; end if;
  raise notice 'PRUEBA R18d · 3 OK: se une una vez (fecha y quién no cambian al reinstalar); un portal de nadie, no';
end $$;

-- 4 · Una persona sin usuario de Sumied abre la 1495
do $$ declare r jsonb; n int; v int; begin
  r := public.conta_bitrix_pestana_leer_portal('r18d-prueba.bitrix24.es', '7', 'Persona Bitrix Prueba', 'empresa', '1495');
  if r ->> 'estado' <> 'ok' or (r ->> 'solo_lectura')::boolean is not true then raise exception 'PRUEBA R18d · 4: % ', r ->> 'estado'; end if;
  if r ->> 'cliente_nombre' <> 'Cliente de prueba R18d' or r ->> 'quien' <> 'Persona Bitrix Prueba' or r ->> 'cuenta_nombre' <> 'Prueba R18d' then
    raise exception 'PRUEBA R18d · 4: no es la ficha de su cuenta: % · % · %', r ->> 'cliente_nombre', r ->> 'quien', r ->> 'cuenta_nombre';
  end if;
  if r -> 'ficha' is null or r -> 'clientes' is null then raise exception 'PRUEBA R18d · 4: faltan la ficha o la lista'; end if;
  perform public.conta_bitrix_pestana_leer_portal('r18d-prueba.bitrix24.es', '7', 'Persona Bitrix Prueba', 'empresa', '1495');
  select count(*), max(veces) into n, v from public.conta_bitrix_pestana_persona where portal = 'r18d-prueba.bitrix24.es' and usuario_id = '7';
  if n <> 1 or v <> 2 then raise exception 'PRUEBA R18d · 4: quién mira: % filas, % veces', n, v; end if;
  raise notice 'PRUEBA R18d · 4 OK: ve el cliente de la 1495 solo leyendo, con su nombre de Bitrix24; apuntada una vez, 2 visitas';
end $$;

-- 5 · Una ficha sin enlazar
do $$ declare r jsonb; begin
  r := public.conta_bitrix_pestana_leer_portal('r18d-prueba.bitrix24.es', '8', 'Otra Persona', 'empresa', '99999');
  if r ->> 'estado' <> 'sin_enlazar' or (r ->> 'solo_lectura')::boolean is not true then raise exception 'PRUEBA R18d · 5: %', r; end if;
  raise notice 'PRUEBA R18d · 5 OK: la ficha sin enlazar lo dice, solo leyendo';
end $$;

-- 6 · El mismo portal en dos cuentas
do $$ declare e1 text; e2 text; begin
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values ('ae18d000-0000-4000-8000-000000000011', 'Prueba R18d otra', 'r18d-prueba-otra', 'active', 'otra_actividad', 'contabilidad');
  insert into public.conta_crm (account_id, crm, entorno, portal, conectada_at) values ('ae18d000-0000-4000-8000-000000000011', 'bitrix24', 'real', 'r18d-prueba.bitrix24.es', now());
  e1 := public.conta_bitrix_portal_unir('r18d-prueba.bitrix24.es', 'X') ->> 'estado';
  e2 := public.conta_bitrix_pestana_leer_portal('r18d-prueba.bitrix24.es', '7', 'Persona Bitrix Prueba', 'empresa', '1495') ->> 'estado';
  if e1 <> 'varias_cuentas' or e2 <> 'varias_cuentas' then raise exception 'PRUEBA R18d · 6: unir → %, leer → %', e1, e2; end if;
  delete from public.conta_crm where account_id = 'ae18d000-0000-4000-8000-000000000011';
  raise notice 'PRUEBA R18d · 6 OK: un portal en dos cuentas ni se une ni se lee';
end $$;

-- 7 · Una cuenta sin administradora activa
do $$ declare e text; begin
  update public.user_profiles set active = false where account_id = 'ae18d000-0000-4000-8000-000000000010';
  e := public.conta_bitrix_pestana_leer_portal('r18d-prueba.bitrix24.es', '7', 'Persona Bitrix Prueba', 'empresa', '1495') ->> 'estado';
  if e <> 'cuenta_sin_administradora' then raise exception 'PRUEBA R18d · 7: %', e; end if;
  update public.user_profiles set active = true where account_id = 'ae18d000-0000-4000-8000-000000000010';
  raise notice 'PRUEBA R18d · 7 OK: sin administradora activa no se lee';
end $$;

-- 8 · La vuelta atrás
do $$ begin
  drop function if exists public.conta_bitrix_pestana_leer_portal(text, text, text, text, text);
  drop function if exists public.conta_bitrix_portal_unir(text, text);
  drop table if exists public.conta_bitrix_pestana_persona;
  alter table public.conta_crm drop column if exists pestana_portal_por, drop column if exists pestana_portal_at;
  if to_regprocedure('public.conta_bitrix_portal_unir(text,text)') is not null or to_regclass('public.conta_bitrix_pestana_persona') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_crm' and column_name like 'pestana_portal%') then
    raise exception 'PRUEBA R18d · 8: la vuelta atrás dejó algo';
  end if;
  raise notice 'PRUEBA R18d · 8 OK: la vuelta atrás lo quita todo';
end $$;

rollback;
