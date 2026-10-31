-- ============================================================================
-- DM1 · El alta no encierra. Una persona con una empresa SIN sociedad y otra
-- con ella, para la e2e. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/conta/dm1/alta-no-encierra.spec.ts (Julio, 31/10): «la
-- persona de dos empresas, con una sin sociedad, sale del alta a la otra».
--
--   alta.dos@prueba.folvy.test · «Persona del Alta» (inventada):
--     · administradora de «Obrador de Prueba Vacío» (inventada, sin ninguna
--       sociedad): su perfil es el más antiguo, así que es la que abre la base
--       (_cuenta_activa) y la aplicación la manda al alta;
--     · administradora de A (Taberna de Prueba Norte, con sus sociedades).
--   Cuenta propia y no la C: las e2e del alta le crean sociedades a la C.
--
-- La contraseña no vive aquí: el carril le pone la de un solo uso de cada
-- ejecución (scripts/e2e/carril/comun.sql la lleva en la plantilla).
-- Solo añade, y se puede aplicar dos veces (W07): «not exists» y «on conflict».
-- ============================================================================

do $$
declare
  u        constant uuid := 'd1e00000-0000-4000-8000-0000000000e1';
  vacia    constant uuid := 'd1e00000-0000-4000-8000-00000000000e';
  cuenta_a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  correo   constant text := 'alta.dos@prueba.folvy.test';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla DM1 ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
  if not exists (select 1 from public.accounts where id = cuenta_a) then
    raise exception 'Semilla DM1: falta la cuenta de prueba A.';
  end if;

  insert into public.accounts (id, name, slug, created_at, updated_at)
  values (vacia, 'Obrador de Prueba Vacío', 'obrador-de-prueba-vacio', '2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00')
  on conflict (id) do nothing;

  if not exists (select 1 from auth.users where id = u) then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo,
      extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
      '2026-10-31 00:00:00+00', '{"provider":"email","providers":["email"]}', '{}',
      '2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00', '', '', '', '');
  end if;
  if not exists (select 1 from auth.identities where user_id = u) then
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (u::text, u, jsonb_build_object('sub', u::text, 'email', correo, 'email_verified', true), 'email',
      '2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00');
  end if;

  -- Fechas fijas (W07); la vacía es la más antigua.
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at, created_at, updated_at)
  values
    (u, vacia,    'admin', true, 'Persona del Alta', '2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00'),
    (u, cuenta_a, 'admin', true, 'Persona del Alta', '2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00', '2026-10-31 00:01:00+00', '2026-10-31 00:01:00+00')
  on conflict (user_id, account_id) do nothing;
end $$;
