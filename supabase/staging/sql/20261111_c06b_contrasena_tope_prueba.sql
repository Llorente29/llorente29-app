-- supabase/staging/sql/20261111_c06b_contrasena_tope_prueba.sql
--
-- SOLO STAGING. Prueba de «C06b · He olvidado la contraseña con tope»
-- (20261111T0610). Todo en una transacción con ROLLBACK: no cambia staging.
--
--   1. Una persona de una cuenta con marca: las 5 primeras peticiones de la
--      hora se pueden mandar; la 6.ª, no. Siempre devuelve la misma fila (la
--      persona), así que quien llama no ve diferencia.
--   2. Por conexión: 20 peticiones de correos que no existen desde la misma
--      conexión; la 21.ª, de un correo que sí existe, ya no se manda.
--   3. Otra conexión y otro correo, sin tope gastado: se manda.
--   4. Un correo que no existe no devuelve nada (como antes), y se apunta.
--   5. Lo apuntado son huellas: ni el correo ni la IP en claro.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C06b contraseña con tope: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

do $$
declare
  u1 constant uuid := 'c06b0000-0000-4000-8000-0000000000e1';
  u2 constant uuid := 'c06b0000-0000-4000-8000-0000000000e2';
begin
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    ('c06b0000-0000-4000-8000-0000000000e0', 'Prueba Tope C06b', 'c06b-prueba-tope', 'active', 'otra_actividad', 'contabilidad');
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated', x.email,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    from (values (u1, 'tope.uno@c06b-prueba.test'), (u2, 'tope.dos@c06b-prueba.test')) x(id, email);
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  select x, 'c06b0000-0000-4000-8000-0000000000e0', 'admin', true, 'Prueba Tope', now(), now() from unnest(array[u1, u2]) x;
end $$;

set local role service_role;

do $$
declare r record; i int; sies int := 0;
begin
  -- 1 · por correo
  for i in 1..6 loop
    select * into r from public.conta_contrasena_pedir('Tope.Uno@c06b-prueba.test ', 'contabilidad', '203.0.113.' || i);
    if r.user_id is null then raise exception '1: la petición % no devolvió a la persona.', i; end if;
    if i <= 5 and not r.se_puede then raise exception '1: la petición % no se manda y debía.', i; end if;
    if i = 6 and r.se_puede then raise exception '1: la 6.ª petición de la hora se manda y no debía.'; end if;
  end loop;
  raise notice '1 OK: por correo, 5 se mandan y la 6.ª no; las 6 devuelven lo mismo.';

  -- 2 · por conexión
  for i in 1..20 loop
    perform * from public.conta_contrasena_pedir('nadie' || i || '@c06b-prueba.test', 'contabilidad', '198.51.100.7');
  end loop;
  select * into r from public.conta_contrasena_pedir('tope.dos@c06b-prueba.test', 'contabilidad', '198.51.100.7');
  if r.user_id is null or r.se_puede then raise exception '2: la 21.ª petición de la conexión se manda (o no devolvió a la persona): %.', row_to_json(r); end if;
  raise notice '2 OK: por conexión, la 21.ª ya no se manda.';

  -- 3 · otra conexión, el mismo correo (1 petición suya): se manda
  select * into r from public.conta_contrasena_pedir('tope.dos@c06b-prueba.test', 'contabilidad', '192.0.2.9');
  if not r.se_puede then raise exception '3: con otra conexión y el correo sin gastar, no se manda.'; end if;
  raise notice '3 OK: otra conexión, se manda.';

  -- 4 · un correo que no existe
  select count(*) into i from public.conta_contrasena_pedir('no.existe@c06b-prueba.test', 'contabilidad', '192.0.2.10');
  if i <> 0 then raise exception '4: un correo que no existe devolvió filas.'; end if;
  raise notice '4 OK: un correo que no existe no devuelve nada.';
end $$;
reset role;

-- 5 · huellas, no datos
do $$
begin
  if exists (select 1 from public.conta_contrasena_intento where correo_huella like '%@%' or conexion_huella like '%.%') then
    raise exception '5: hay correos o IP en claro.';
  end if;
  if (select count(*) from public.conta_contrasena_intento where correo_huella = encode(extensions.digest('tope.uno@c06b-prueba.test', 'sha256'), 'hex')) <> 6 then
    raise exception '5: las 6 peticiones del correo no están con su huella.';
  end if;
  raise notice '5 OK: solo huellas sha256.';
end $$;

rollback;
