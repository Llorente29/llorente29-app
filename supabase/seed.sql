-- ============================================================================
-- supabase/seed.sql
-- ============================================================================
--
-- FIXTURES LOCALES para desarrollo Folvy V1.
--
-- Ejecutado automaticamente por `supabase db reset` en entornos LOCAL.
-- NUNCA debe ejecutarse en produccion.
--
-- Datos creados:
--   * 2 cuentas:
--       - Folvy Interno (UUID ceremonial 00000000-...0001, mismo que produccion)
--       - Restaurante Demo Folvy (cuenta cliente ficticia)
--   * 2 locations en la cuenta demo (Madrid + Barcelona)
--   * 3 employees en la cuenta demo (1 manager + 2 workers)
--   * 3 auth.users fake:
--       - admin@folvy.test / FolvyDev2026! -> admin Folvy Interno
--       - julio@folvy.test / FolvyDev2026! -> admin Folvy Interno + platform_admin CEO
--       - manager@demo.test / FolvyDev2026! -> admin de cuenta demo
--   * user_profiles correspondientes
--   * platform_admins entry para julio@folvy.test
--
-- Generado: 20/05/2026 - Sesion 11, Bloque M.
-- Schema referencia: produccion Folvy (xzmpnchlguibclvxyynt) consultada via
-- information_schema.
--
-- Historial:
--   v1: original.
--   v2: fix pgcrypto extension (gen_salt no existia en local).
--   v3: fix platform_admins.full_name NOT NULL (divergencia schema vs asuncion).
--
-- IMPORTANTE: passwords en claro abajo son SOLO para desarrollo local.
-- TLD .test es reservada (RFC 6761) y no resoluble - emails seguros para fixtures.
-- ============================================================================


-- ============================================================================
-- BLOQUE 0 - HABILITAR EXTENSIONES NECESARIAS
-- ============================================================================
--
-- pgcrypto provee crypt() y gen_salt() para hashear las passwords de auth.users.
-- En produccion Supabase ya viene habilitada, pero en local hay que crearla.
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- ============================================================================
-- BLOQUE 1 - CUENTA "FOLVY INTERNO" (paralela a produccion)
-- ============================================================================

INSERT INTO public.accounts (
  id, name, legal_name, slug, country, timezone, locale, currency,
  status, is_internal, metadata, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Folvy Interno',
  'Folvy',
  'folvy-interno',
  'ES',
  'Europe/Madrid',
  'es-ES',
  'EUR',
  'active',
  true,
  '{"notes":"Cuenta interna Folvy para desarrollo, demos y testing","purpose":"internal_dev_and_demo"}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- BLOQUE 2 - CUENTA DEMO "RESTAURANTE DEMO FOLVY"
-- ============================================================================

INSERT INTO public.accounts (
  id, name, legal_name, slug, cif, billing_email, billing_phone,
  country, timezone, locale, currency, status, is_internal,
  metadata, created_at, updated_at
) VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Restaurante Demo Folvy',
  'Restaurante Demo Folvy SL',
  'restaurante-demo-folvy',
  'B00000000',
  'demo@folvy.test',
  '+34900000000',
  'ES',
  'Europe/Madrid',
  'es-ES',
  'EUR',
  'active',
  false,
  '{"notes":"Cuenta demo para desarrollo local","purpose":"local_dev_demo"}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- BLOQUE 3 - LOCATIONS DE LA CUENTA DEMO
-- ============================================================================

INSERT INTO public.locations (
  id, name, address, phone, active, account_id, is_billable,
  created_at, updated_at
) VALUES
(
  '22222222-2222-2222-2222-222222222201'::uuid,
  'Demo Madrid Centro',
  'Calle Gran Via 1, 28013 Madrid',
  '+34910000001',
  true,
  '11111111-1111-1111-1111-111111111111'::uuid,
  true,
  NOW(),
  NOW()
),
(
  '22222222-2222-2222-2222-222222222202'::uuid,
  'Demo Barcelona Eixample',
  'Passeig de Gracia 100, 08008 Barcelona',
  '+34930000002',
  true,
  '11111111-1111-1111-1111-111111111111'::uuid,
  true,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- BLOQUE 4 - EMPLOYEES DE LA CUENTA DEMO
-- ============================================================================

INSERT INTO public.employees (
  id, name, dni, phone, email, position, department,
  contract_type, weekly_hours, active, location_id,
  created_at, updated_at
) VALUES
(
  '33333333-3333-3333-3333-333333333301'::uuid,
  'Marina Lopez (Manager Demo)',
  '00000001A',
  '+34600000001',
  'manager@demo.test',
  'Encargada',
  'Sala',
  'indefinido',
  40,
  true,
  '22222222-2222-2222-2222-222222222201'::uuid,
  NOW(),
  NOW()
),
(
  '33333333-3333-3333-3333-333333333302'::uuid,
  'Carlos Martin (Worker Demo)',
  '00000002B',
  '+34600000002',
  'carlos@demo.test',
  'Camarero',
  'Sala',
  'indefinido',
  30,
  true,
  '22222222-2222-2222-2222-222222222201'::uuid,
  NOW(),
  NOW()
),
(
  '33333333-3333-3333-3333-333333333303'::uuid,
  'Lucia Ramirez (Worker Demo)',
  '00000003C',
  '+34600000003',
  'lucia@demo.test',
  'Cocinera',
  'Cocina',
  'temporal',
  20,
  true,
  '22222222-2222-2222-2222-222222222201'::uuid,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- BLOQUE 5 - AUTH.USERS (USUARIOS FAKE PARA LOGIN LOCAL)
-- ============================================================================
--
-- Passwords hasheadas con bcrypt via extensions.crypt() (pgcrypto).
-- Todas las passwords son 'FolvyDev2026!' (SOLO LOCAL).
-- ----------------------------------------------------------------------------

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, is_sso_user, is_anonymous,
  created_at, updated_at
) VALUES
(
  '00000000-0000-0000-0000-000000000000'::uuid,
  '44444444-4444-4444-4444-444444444401'::uuid,
  'authenticated',
  'authenticated',
  'admin@folvy.test',
  extensions.crypt('FolvyDev2026!', extensions.gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Admin Folvy Interno (local)"}'::jsonb,
  false, false, false,
  NOW(), NOW()
),
(
  '00000000-0000-0000-0000-000000000000'::uuid,
  '44444444-4444-4444-4444-444444444402'::uuid,
  'authenticated',
  'authenticated',
  'julio@folvy.test',
  extensions.crypt('FolvyDev2026!', extensions.gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Julio Gascon (local)"}'::jsonb,
  false, false, false,
  NOW(), NOW()
),
(
  '00000000-0000-0000-0000-000000000000'::uuid,
  '44444444-4444-4444-4444-444444444403'::uuid,
  'authenticated',
  'authenticated',
  'manager@demo.test',
  extensions.crypt('FolvyDev2026!', extensions.gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Marina Lopez (local demo)"}'::jsonb,
  false, false, false,
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- BLOQUE 6 - AUTH.IDENTITIES (provider 'email' por cada user)
-- ============================================================================

INSERT INTO auth.identities (
  id, user_id, provider, provider_id, identity_data,
  last_sign_in_at, created_at, updated_at
) VALUES
(
  gen_random_uuid(),
  '44444444-4444-4444-4444-444444444401'::uuid,
  'email',
  '44444444-4444-4444-4444-444444444401',
  '{"sub":"44444444-4444-4444-4444-444444444401","email":"admin@folvy.test","email_verified":true,"phone_verified":false}'::jsonb,
  NULL, NOW(), NOW()
),
(
  gen_random_uuid(),
  '44444444-4444-4444-4444-444444444402'::uuid,
  'email',
  '44444444-4444-4444-4444-444444444402',
  '{"sub":"44444444-4444-4444-4444-444444444402","email":"julio@folvy.test","email_verified":true,"phone_verified":false}'::jsonb,
  NULL, NOW(), NOW()
),
(
  gen_random_uuid(),
  '44444444-4444-4444-4444-444444444403'::uuid,
  'email',
  '44444444-4444-4444-4444-444444444403',
  '{"sub":"44444444-4444-4444-4444-444444444403","email":"manager@demo.test","email_verified":true,"phone_verified":false}'::jsonb,
  NULL, NOW(), NOW()
)
ON CONFLICT (provider, provider_id) DO NOTHING;


-- ============================================================================
-- BLOQUE 7 - USER_PROFILES
-- ============================================================================

INSERT INTO public.user_profiles (
  id, user_id, role, active, display_name, account_id,
  terms_accepted_at, welcome_completed_at,
  created_at, updated_at
) VALUES
(
  '55555555-5555-5555-5555-555555555501'::uuid,
  '44444444-4444-4444-4444-444444444401'::uuid,
  'admin',
  true,
  'Admin Folvy Interno (local)',
  '00000000-0000-0000-0000-000000000001'::uuid,
  NOW(), NOW(),
  NOW(), NOW()
),
(
  '55555555-5555-5555-5555-555555555502'::uuid,
  '44444444-4444-4444-4444-444444444402'::uuid,
  'admin',
  true,
  'Julio Gascon (local)',
  '00000000-0000-0000-0000-000000000001'::uuid,
  NOW(), NOW(),
  NOW(), NOW()
),
(
  '55555555-5555-5555-5555-555555555503'::uuid,
  '44444444-4444-4444-4444-444444444403'::uuid,
  'admin',
  true,
  'Marina Lopez (local demo)',
  '11111111-1111-1111-1111-111111111111'::uuid,
  NOW(), NOW(),
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- BLOQUE 8 - PLATFORM_ADMINS (replica setup CEO de produccion)
-- ============================================================================
--
-- julio@folvy.test entra como platform_admin con role 'ceo', replicando el
-- estado de produccion (Sprint 1, Decision D3).
--
-- Schema real platform_admins (verificado 20/05/2026):
--   id, user_id, full_name (NOT NULL), role (NOT NULL), active (NOT NULL),
--   created_at, created_by, last_login_at, notes.
-- ----------------------------------------------------------------------------

INSERT INTO public.platform_admins (
  user_id, full_name, role, active
) VALUES (
  '44444444-4444-4444-4444-444444444402'::uuid,
  'Julio Gascon (local)',
  'ceo',
  true
)
ON CONFLICT DO NOTHING;


-- ============================================================================
-- FIN DEL SEED
-- ============================================================================
--
-- Verificacion rapida tras `supabase db reset`:
--
--   SELECT 'accounts' AS tabla, COUNT(*) FROM public.accounts
--   UNION ALL SELECT 'locations', COUNT(*) FROM public.locations
--   UNION ALL SELECT 'employees', COUNT(*) FROM public.employees
--   UNION ALL SELECT 'auth.users', COUNT(*) FROM auth.users
--   UNION ALL SELECT 'user_profiles', COUNT(*) FROM public.user_profiles
--   UNION ALL SELECT 'platform_admins', COUNT(*) FROM public.platform_admins;
--
-- Esperado: accounts=2, locations=2, employees=3, auth.users=3,
--           user_profiles=3, platform_admins=1.
--
-- DEUDA TECNICA DETECTADA Sesion 11:
--
-- 1. Funcion seed_appcc_for_account(uuid) referenciada por algun trigger en
--    public.accounts NO esta en el baseline.sql (no fue capturada por db dump).
--    Sospecha: vive en otro schema interno de Supabase o es trigger legacy.
--    En local genera WARNINGs al insertar cuentas (no bloqueante).
--    En produccion probablemente sigue funcionando (datos APPCC seed automatico
--    al crear cuenta cliente). Investigar y formalizar en proximo bloque.
-- ============================================================================
