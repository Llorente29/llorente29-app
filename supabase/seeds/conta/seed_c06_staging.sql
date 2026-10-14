-- ============================================================================
-- C06 · Frente C · Las cuentas de prueba de «Contabilidad sola». SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Dos cuentas SOLO de contabilidad, dadas de alta con la función de verdad
-- (conta_crear_cuenta_sola, 20261111T0100): sin Cocina, con el interruptor
-- `conta`, la marca de pruebas «contabilidad» y su apunte en el registro de
-- plataforma. Todo inventado, con nombres propios del frente C:
--
--   sola.admin@c06-prueba.test · «Empresa de Prueba Sola, S.L.» · el recorrido
--     (Inicio, menú, plan, libro, libros y balances, fichas). Su empresa la
--     prepara la propia prueba e2e la primera vez y la deja.
--   sola.alta@c06-prueba.test  · «Taller de Prueba Solo, S.L.» · sin empresa:
--     el alta conversada con la marca. La prueba borra al acabar lo que crea.
--
-- Y quien las da de alta: un administrador de plataforma de prueba
-- (c06.plataforma@c06-prueba.test), sin contraseña que nadie conozca. La cuenta
-- B no se toca (respuesta 1 del C06, 6).
--
-- Las contraseñas NO viven aquí: se crean al azar y el workflow e2e les pone
-- la de un solo uso de cada ejecución, como a los demás usuarios de prueba.
--
-- Guardas: aborta si al otro lado hay cuentas de producción, o si ya está.
-- ============================================================================

do $$
declare
  v_plat  constant uuid := 'c0600000-0000-4000-8000-0000000000f0';
  v_sola  constant uuid := 'c0600000-0000-4000-8000-0000000000a1';
  v_alta  constant uuid := 'c0600000-0000-4000-8000-0000000000b1';
  v_cuenta_sola uuid;
  v_cuenta_alta uuid;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla C06 ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
  if exists (select 1 from auth.users where id in (v_plat, v_sola, v_alta)) or exists (select 1 from public.accounts where slug in ('c06-prueba-sola', 'c06-prueba-alta')) then
    raise exception 'Semilla C06: ya está cargada.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.correo,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from (values (v_plat, 'c06.plataforma@c06-prueba.test'), (v_sola, 'sola.admin@c06-prueba.test'), (v_alta, 'sola.alta@c06-prueba.test')) as u(id, correo);

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.correo, 'email_verified', true), 'email', now(), now(), now()
  from (values (v_plat, 'c06.plataforma@c06-prueba.test'), (v_sola, 'sola.admin@c06-prueba.test'), (v_alta, 'sola.alta@c06-prueba.test')) as u(id, correo);

  insert into public.platform_admins (user_id, full_name, role, active, notes)
  values (v_plat, 'Plataforma de prueba C06', 'admin', true, 'Frente C (C06): da de alta las cuentas de prueba de contabilidad sola. Solo staging.');

  v_cuenta_sola := public.conta_crear_cuenta_sola('Empresa de Prueba Sola, S.L.', 'c06-prueba-sola', v_sola, 'Marta Inventada',
    'contabilidad', 'Cuenta de prueba del frente C (C06): el recorrido con la marca.', v_plat);
  v_cuenta_alta := public.conta_crear_cuenta_sola('Taller de Prueba Solo, S.L.', 'c06-prueba-alta', v_alta, 'Julián Inventado',
    'contabilidad', 'Cuenta de prueba del frente C (C06): el alta conversada con la marca.', v_plat);

  -- Las pruebas entran con la sesión ya hecha: la bienvenida (contraseña y
  -- condiciones) se da por pasada, como en las demás semillas.
  update public.user_profiles set welcome_completed_at = now(), terms_accepted_at = now()
   where user_id in (v_sola, v_alta) and account_id in (v_cuenta_sola, v_cuenta_alta);

  raise notice 'Semilla C06 OK: % (recorrido) y % (alta), solo contabilidad, marca «contabilidad».', v_cuenta_sola, v_cuenta_alta;
end $$;
