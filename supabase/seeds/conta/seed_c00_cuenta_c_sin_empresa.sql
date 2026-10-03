-- ============================================================================
-- C00 · Respuesta 3 · Una CUENTA C de prueba, SIN EMPRESA. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- El alta tiene dos marcos (maquetas N1bAlta y N1cAlta): a pantalla completa
-- cuando la cuenta aún no tiene ninguna empresa, y en ventana cuando ya tiene
-- alguna. A y B tienen la suya, así que la pantalla completa no se podía
-- probar con ninguna de las dos:
--
--   c.admin@prueba.folvy.test · cuenta C «Obrador de Prueba Este» · admin
--
-- Sin interruptor `conta` y sin Cocina, como B. Sin datos fiscales en la
-- cuenta: el alta no tiene nada que proponer y lo pregunta todo.
--
-- La contraseña NO vive aquí: se crea con una al azar que nadie conoce, y el
-- workflow e2e le pone la de un solo uso de cada ejecución, como a los demás.
-- Las pruebas que la usan borran al acabar la empresa que crean: la cuenta
-- vuelve a quedar sin ninguna.
--
-- Guardas: aborta si no es staging-conta (alguna cuenta que no es de prueba)
-- o si ya está.
-- ============================================================================

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b_cuenta constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  c_cuenta constant uuid := 'c01c0000-0000-4000-8000-00000000000c';
  c_user   constant uuid := 'c01c0000-0000-4000-8000-0000000000c1';
  c_local  constant uuid := 'c01c0000-0000-4000-8000-0000000000c2';
  correo   constant text := 'c.admin@prueba.folvy.test';
begin
  if exists (select 1 from accounts where id not in (a_cuenta, b_cuenta, c_cuenta)) then
    raise exception 'Semilla C00 cuenta C ABORTADA: esta base tiene cuentas que no son de prueba. ¿Es staging-conta?';
  end if;
  if exists (select 1 from accounts where id = c_cuenta) or exists (select 1 from auth.users where id = c_user or email = correo) then
    raise exception 'Semilla C00 cuenta C: ya está cargada.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', c_user, 'authenticated', 'authenticated', correo,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (c_user::text, c_user, jsonb_build_object('sub', c_user::text, 'email', correo, 'email_verified', true), 'email', now(), now(), now());

  insert into accounts (id, name, slug, status, business_type)
  values (c_cuenta, 'Obrador de Prueba Este', 'prueba-este', 'active', 'restaurante');

  insert into user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (c_user, c_cuenta, 'admin', true, 'Admin Este', now(), now());

  insert into locations (id, account_id, name, city)
  values (c_local, c_cuenta, 'Este Ruzafa', 'Valencia');

  raise notice 'Semilla C00 cuenta C OK: % sin empresa, sin interruptor ni Cocina.', correo;
end $$;
