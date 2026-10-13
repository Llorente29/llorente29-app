-- ============================================================================
-- Usuarios de prueba PROPIOS de cada frente (A, B y C). SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Por qué (C06, respuesta 2 de Julio, 13/10): las tres sesiones lanzan sus e2e
-- a la vez, y cada ejecución pone una contraseña al azar a los MISMOS cuatro
-- usuarios de prueba. Dos ramas a la vez se cambian la contraseña la una a la
-- otra a mitad: 400 y 429 al entrar, y cientos de fallos que no son de nadie.
-- La salida no es aflojar el freno de la contraseña de un solo uso: es que cada
-- frente tenga los suyos y su e2e solo toque esos.
--
-- Lo que crea, para cada frente f ∈ {a, b, c}:
--   · un doble de cada uno de los cuatro usuarios de siempre, con el MISMO
--     perfil (cuenta, rol, nombre visible, bienvenida hecha), copiado columna a
--     columna del perfil de verdad:
--       a.admin.frente-f@     → cuenta A  (Taberna de Prueba Norte)
--       b.admin.frente-f@     → cuenta B  (Cocina de Prueba Sur)
--       a.encargado.frente-f@ → cuenta A, rol manager
--       c.admin.frente-f@     → SU cuenta C, sin empresa (abajo)
--   · su propia cuenta «C sin empresa». Las pruebas del alta borran TODAS las
--     empresas de la cuenta C al empezar: compartida, el alta de un frente le
--     borraría al otro la empresa que está dando de alta.
--
-- Las cuentas A y B se comparten (llevan toda la siembra de C00 a C05): lo que
-- las pruebas crean en ellas lo borra cada prueba al acabar, y lo que dejó un
-- run cortado lo quita supabase/seeds/conta/e2e_limpieza.sql al empezar.
--
-- Ids fijos, que las pruebas usan (tests/e2e/conta/sesion.ts):
--   e2e0000f-0000-4000-8000-0000000000XX, con f el frente y XX el sufijo del
--   usuario de siempre (a1, b1, a6, c1); cuenta C del frente …00000000000c y su
--   local …0000000000c2.
--
-- Sin contraseña usable: la pone el workflow de las e2e en cada ejecución, solo
-- a los del frente que corre. Se puede volver a aplicar: lo que ya está se deja.
--
-- Guardas: al otro lado no hay ni Foodint ni Folvy Interno (producción tiene
-- las dos siempre), y las cuentas A, B y C de siempre existen.
-- ============================================================================

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b_cuenta constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  c_cuenta constant uuid := 'c01c0000-0000-4000-8000-00000000000c';
  -- Los cuatro de siempre: sufijo del id, id de verdad y parte local del correo.
  base constant text[][] := array[
    ['a1', 'c01a0000-0000-4000-8000-0000000000a1', 'a.admin'],
    ['b1', 'c01b0000-0000-4000-8000-0000000000b1', 'b.admin'],
    ['a6', 'c01a0000-0000-4000-8000-0000000000a6', 'a.encargado'],
    ['c1', 'c01c0000-0000-4000-8000-0000000000c1', 'c.admin']];
  f text;
  i int;
  v_user uuid;
  v_base uuid;
  v_correo text;
  v_cuenta_c uuid;
  v_local_c uuid;
  cols text;
  creados int := 0;
  cuentas int := 0;
begin
  if exists (select 1 from accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla e2e por frente ABORTADA: al otro lado hay cuentas de producción.';
  end if;
  if (select count(*) from accounts where id in (a_cuenta, b_cuenta, c_cuenta)) <> 3 then
    raise exception 'Semilla e2e por frente: faltan las cuentas A, B o C de siempre (semillas C01 y C00).';
  end if;

  -- Las columnas del perfil que se copian: todas menos el usuario, la clave
  -- propia si la hay y las que calcula la base.
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'user_profiles'
     and column_name not in ('user_id', 'id', 'created_at', 'updated_at')
     and is_generated = 'NEVER' and coalesce(identity_generation, '') <> 'ALWAYS';

  foreach f in array array['a', 'b', 'c'] loop
    -- Su cuenta C, sin empresa: como la de siempre, con otro slug.
    v_cuenta_c := ('e2e0000' || f || '-0000-4000-8000-00000000000c')::uuid;
    v_local_c  := ('e2e0000' || f || '-0000-4000-8000-0000000000c2')::uuid;
    if not exists (select 1 from accounts where id = v_cuenta_c) then
      insert into accounts (id, name, slug, status, business_type)
      select v_cuenta_c, name, slug || '-frente-' || f, status, business_type from accounts where id = c_cuenta;
      insert into locations (id, account_id, name, city)
      select v_local_c, v_cuenta_c, name, city from locations where id = 'c01c0000-0000-4000-8000-0000000000c2';
      cuentas := cuentas + 1;
    end if;

    for i in 1 .. array_length(base, 1) loop
      v_user   := ('e2e0000' || f || '-0000-4000-8000-0000000000' || base[i][1])::uuid;
      v_base   := base[i][2]::uuid;
      v_correo := base[i][3] || '.frente-' || f || '@prueba.folvy.test';
      continue when exists (select 1 from auth.users where id = v_user);
      if exists (select 1 from auth.users where email = v_correo) then
        raise exception 'Semilla e2e por frente: % ya existe con otro id.', v_correo;
      end if;

      insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_correo,
        extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
        now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (v_user::text, v_user, jsonb_build_object('sub', v_user::text, 'email', v_correo, 'email_verified', true), 'email', now(), now(), now());

      execute format('insert into user_profiles (user_id, %s) select $1, %s from user_profiles where user_id = $2', cols, cols)
        using v_user, v_base;
      if not found then
        raise exception 'Semilla e2e por frente: el usuario de siempre % no tiene perfil.', base[i][3];
      end if;
      -- El de la cuenta C, a la cuenta C de su frente.
      if base[i][1] = 'c1' then
        update user_profiles set account_id = v_cuenta_c where user_id = v_user;
      end if;
      creados := creados + 1;
    end loop;
  end loop;

  raise notice 'Semilla e2e por frente OK: % usuarios y % cuentas C nuevos (3 frentes × 4 usuarios y 1 cuenta C cuando está entera).', creados, cuentas;
end $$;

-- Comprobación, con la misma vara que usa el workflow: 4 por frente, cada uno
-- con un perfil activo, y el de C en la cuenta C de su frente.
do $$
declare
  f text;
  n int;
begin
  foreach f in array array['a', 'b', 'c'] loop
    select count(*) into n
      from auth.users u join user_profiles p on p.user_id = u.id and p.active
     where u.id::text like 'e2e0000' || f || '-%' and u.email like '%.frente-' || f || '@prueba.folvy.test';
    if n <> 4 then raise exception 'Frente %: esperaba 4 usuarios con perfil activo y hay %.', f, n; end if;
    if not exists (select 1 from user_profiles where user_id = ('e2e0000' || f || '-0000-4000-8000-0000000000c1')::uuid
                    and account_id = ('e2e0000' || f || '-0000-4000-8000-00000000000c')::uuid) then
      raise exception 'Frente %: el administrador de C no está en la cuenta C de su frente.', f;
    end if;
    if exists (select 1 from company where account_id = ('e2e0000' || f || '-0000-4000-8000-00000000000c')::uuid
                and created_at < now() - interval '1 hour') then
      raise notice 'Frente %: su cuenta C tiene empresas viejas; las quita e2e_limpieza.sql.', f;
    end if;
  end loop;
  raise notice 'Comprobación OK: 3 frentes × 4 usuarios, cada C en su cuenta.';
end $$;
