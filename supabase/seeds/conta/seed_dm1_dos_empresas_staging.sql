-- ============================================================================
-- DM1 · PR 1b · Una persona en DOS empresas, para la e2e del gate. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/conta/dm1/dos-empresas.spec.ts (Julio, 30/10): «un usuario con
-- dos cuentas ve los módulos de la que tiene abierta, y al cambiar de empresa
-- cambian».
--
--   dos.empresas@prueba.folvy.test · «Persona de Dos Empresas» (inventada):
--     · administradora de A (Taberna de Prueba Norte), con la contabilidad
--       encendida (feature_flags conta, de las semillas de siempre);
--     · administradora de B (Cocina de Prueba Sur), sin contabilidad.
--   El perfil de A es el más antiguo: sin ninguna guardada, _cuenta_activa (la
--   1950) abre A.
--
-- La contraseña no vive aquí: el carril le pone la de un solo uso de cada
-- ejecución, como a los demás (scripts/e2e/carril/comun.sql la lleva en la
-- lista de la plantilla).
--
-- Solo añade, y se puede aplicar dos veces (W07): «not exists» y «on conflict».
-- Guardas: aborta si al otro lado hay cuentas de producción, o si faltan A o B.
-- ============================================================================

do $$
declare
  u        constant uuid := 'c01a0000-0000-4000-8000-0000000000a8';
  cuenta_a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  cuenta_b constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  correo   constant text := 'dos.empresas@prueba.folvy.test';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla DM1 ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
  if (select count(*) from public.accounts where id in (cuenta_a, cuenta_b)) <> 2 then
    raise exception 'Semilla DM1: faltan las cuentas de prueba A o B.';
  end if;

  if not exists (select 1 from auth.users where id = u) then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo,
      extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
      '2026-10-30 00:00:00+00', '{"provider":"email","providers":["email"]}', '{}',
      '2026-10-30 00:00:00+00', '2026-10-30 00:00:00+00', '', '', '', '');
  end if;
  if not exists (select 1 from auth.identities where user_id = u) then
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (u::text, u, jsonb_build_object('sub', u::text, 'email', correo, 'email_verified', true), 'email',
      '2026-10-30 00:00:00+00', '2026-10-30 00:00:00+00', '2026-10-30 00:00:00+00');
  end if;

  -- Fechas fijas: aplicarla dos veces deja lo mismo (W07), y A es la más antigua.
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at, created_at, updated_at)
  values
    (u, cuenta_a, 'admin', true, 'Persona de Dos Empresas', '2026-10-30 00:00:00+00', '2026-10-30 00:00:00+00', '2026-10-30 00:00:00+00', '2026-10-30 00:00:00+00'),
    (u, cuenta_b, 'admin', true, 'Persona de Dos Empresas', '2026-10-30 00:00:00+00', '2026-10-30 00:00:00+00', '2026-10-30 00:01:00+00', '2026-10-30 00:01:00+00')
  on conflict (user_id, account_id) do nothing;
end $$;
