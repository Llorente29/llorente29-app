-- ============================================================================
-- _production_state_snapshot.sql
-- ============================================================================
--
-- SNAPSHOT DOCUMENTAL del estado real de producción Folvy.
--
-- Este fichero NO se ejecuta automáticamente. El prefijo "_" hace que el CLI
-- de Supabase lo ignore (no está en supabase/migrations/ ni en supabase/seed.sql).
--
-- Sirve como referencia inmutable de qué datos clave se insertaron manualmente
-- en producción durante Sprint 1 (Sesión 5) y Sesión 9, fuera del flujo
-- normal de migrations.
--
-- ----------------------------------------------------------------------------
-- Generado: 20/05/2026 — Sesión 11, Bloque M.
-- Proyecto Supabase: xzmpnchlguibclvxyynt (Folvy producción).
-- Fuente: queries directas vía SQL Editor (regla 5 — BBDD es la verdad).
-- ----------------------------------------------------------------------------
--
-- Para reproducir este estado en una BBDD vacía (entorno nuevo de producción,
-- staging real, etc.) ejecutar manualmente este SQL EN ORDEN tras aplicar
-- todas las migrations del baseline.
--
-- Para entornos locales de desarrollo, NO usar este fichero. Usar
-- supabase/seed.sql, que tiene fixtures reproducibles independientes
-- de auth.users reales.
--
-- ============================================================================


-- ============================================================================
-- 1. CUENTA "FOLVY INTERNO" (Sesión 9)
-- ============================================================================
--
-- Cuenta administrativa interna para desarrollo, demos y testing por parte
-- del equipo Folvy. UUID ceremonial 00000000-0000-0000-0000-000000000001
-- reservado por convención.
--
-- created_at: 2026-05-20 08:34:23.849925+00
-- created_by: NULL (insertada manualmente vía SQL Editor sin contexto auth)
-- ----------------------------------------------------------------------------

INSERT INTO public.accounts (
  id,
  name,
  legal_name,
  cif,
  billing_email,
  billing_phone,
  country,
  timezone,
  locale,
  currency,
  status,
  is_internal,
  trial_ends_at,
  stripe_customer_id,
  metadata,
  created_at,
  created_by
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Folvy Interno',
  'Folvy',
  NULL,
  NULL,
  NULL,
  'ES',
  'Europe/Madrid',
  'es-ES',
  'EUR',
  'active',
  true,
  NULL,
  NULL,
  '{"notes":"Cuenta interna Folvy para desarrollo, demos y testing","purpose":"internal_dev_and_demo"}'::jsonb,
  '2026-05-20 08:34:23.849925+00'::timestamptz,
  NULL
);


-- ============================================================================
-- 2. USER_PROFILE — JULIO GASCÓN COMO ADMIN DE FOLVY INTERNO (Sesión 9)
-- ============================================================================
--
-- Profile de Julio Gascón (CEO) en la cuenta Folvy Interno con role 'admin'.
-- Requiere que auth.users con id e298629b-9d34-4d62-9a00-ff7c3fa29a1a ya exista
-- (creado vía signup normal en Supabase Auth).
--
-- Terms aceptados y welcome completado el mismo timestamp de creación.
-- ----------------------------------------------------------------------------

INSERT INTO public.user_profiles (
  id,
  user_id,
  employee_id,
  role,
  active,
  display_name,
  account_id,
  terms_accepted_at,
  welcome_completed_at,
  last_password_change_at,
  last_login_at,
  suspended_at,
  suspended_by,
  created_at,
  updated_at
) VALUES (
  'bde73591-f5b4-4aa9-99ae-6c39329ae369'::uuid,
  'e298629b-9d34-4d62-9a00-ff7c3fa29a1a'::uuid,
  NULL,
  'admin',
  true,
  'Julio Gascón',
  '00000000-0000-0000-0000-000000000001'::uuid,
  '2026-05-20 08:34:23.849925+00'::timestamptz,
  '2026-05-20 08:34:23.849925+00'::timestamptz,
  NULL,
  NULL,
  NULL,
  NULL,
  '2026-05-20 08:34:23.849925+00'::timestamptz,
  '2026-05-20 08:34:23.849925+00'::timestamptz
);


-- ============================================================================
-- 3. PLATFORM_ADMIN — JULIO GASCÓN COMO CEO (Sprint 1, Sesión 5, Decisión D3)
-- ============================================================================
--
-- Julio Gascón registrado en platform_admins con role 'ceo'.
-- Esto le concede acceso transversal a operaciones de plataforma
-- (impersonation, gestión de cuentas, etc.).
--
-- created_at: 2026-05-19 07:51:32.950575+00
-- Origen: Decisión D3 del Sprint 1 (patrón Opción C2 — tabla separada).
-- Referencia: folvy_addendum_sesion2_decisiones.md §2.2.
-- ----------------------------------------------------------------------------

-- NOTA: la estructura exacta de platform_admins (columnas) no se incluye aquí
-- porque puede tener variaciones (timestamp updated_at, metadata, etc).
-- Consultar baseline para schema completo. Datos clave:
--
--   user_id:    e298629b-9d34-4d62-9a00-ff7c3fa29a1a
--   email:      jgcolon@idasal.com
--   role:       ceo
--   created_at: 2026-05-19 07:51:32.950575+00
--
-- Comando ejecutado en Sprint 1 (referencia documental):
--
--   INSERT INTO public.platform_admins (user_id, role)
--   VALUES ('e298629b-9d34-4d62-9a00-ff7c3fa29a1a'::uuid, 'ceo');
--
-- (Resto de columnas con DEFAULT.)


-- ============================================================================
-- 4. AUTH.USERS — JULIO GASCÓN (NO RECREABLE VÍA SQL)
-- ============================================================================
--
-- auth.users con id e298629b-9d34-4d62-9a00-ff7c3fa29a1a NO se puede crear
-- desde aquí. Pertenece al schema 'auth' gestionado por Supabase Auth.
--
-- Para recrearlo en un entorno nuevo de producción:
-- 1. Invitar a jgcolon@idasal.com vía Supabase Dashboard → Authentication.
-- 2. Completar el flow /welcome (asignar password + aceptar términos).
-- 3. Capturar el id generado y actualizar los UUIDs de este snapshot
--    si son distintos.
--
-- Datos clave en producción:
--
--   id:    e298629b-9d34-4d62-9a00-ff7c3fa29a1a
--   email: jgcolon@idasal.com


-- ============================================================================
-- FIN DEL SNAPSHOT
-- ============================================================================
--
-- Próximas actualizaciones esperadas: cuando se añadan otros platform_admins,
-- cuando Llorente29 entre como account real, o cuando otros datos críticos
-- se inserten manualmente fuera del flujo de migrations.
--
-- Mantener inmutable salvo por adiciones cronológicas con timestamp explícito.
-- ============================================================================
