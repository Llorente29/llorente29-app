-- ============================================================================
-- C00 · Tarea 8 · Un ENCARGADO de prueba en la cuenta A. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para la prueba de RLS «los socios y cargos solo los ve un administrador»
-- (encargo C00 §9.4) hace falta alguien de la cuenta que NO sea administrador:
--
--   a.encargado@prueba.folvy.test · cuenta A · rol `manager` · «Encargado Norte»
--
-- La contraseña NO vive aquí: se crea con una al azar que nadie conoce, y el
-- workflow e2e le pone la de un solo uso de cada ejecución, como a los otros
-- dos usuarios de prueba.
--
-- Guardas: aborta si no es staging-conta (alguna cuenta que no es de prueba)
-- o si el usuario ya está.
-- ============================================================================

do $$
declare
  a_cuenta    constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b_cuenta    constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  a_encargado constant uuid := 'c01a0000-0000-4000-8000-0000000000a6';
  correo      constant text := 'a.encargado@prueba.folvy.test';
begin
  if exists (select 1 from accounts where id not in (a_cuenta, b_cuenta)) then
    raise exception 'Semilla C00 encargado ABORTADA: esta base tiene cuentas que no son de prueba. ¿Es staging-conta?';
  end if;
  if exists (select 1 from auth.users where id = a_encargado or email = correo) then
    raise exception 'Semilla C00 encargado: ya está cargado.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', a_encargado, 'authenticated', 'authenticated', correo,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (a_encargado::text, a_encargado, jsonb_build_object('sub', a_encargado::text, 'email', correo, 'email_verified', true), 'email', now(), now(), now());

  insert into user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (a_encargado, a_cuenta, 'manager', true, 'Encargado Norte', now(), now());

  raise notice 'Semilla C00 encargado OK: % en la cuenta A, rol manager.', correo;
end $$;
