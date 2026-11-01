-- ============================================================================
-- DM1 · PR 1c · El superadministrador de prueba puede abrir la aplicación.
-- SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/conta/dm1/superadministrador.spec.ts (Julio, 31/10): «el
-- superadministrador, gestionando una cuenta con la contabilidad encendida, la
-- ve».
--
-- c06.plataforma@c06-prueba.test ya tiene su fila en platform_admins (semilla
-- del C06), y el carril se la copia. Lo que le faltaba para entrar en la
-- pantalla es un PERFIL: sin ninguno, AppContext no tiene cuenta ni perfil y la
-- aplicación se queda en «cargando». En producción el superadministrador tiene
-- el suyo en Folvy Interno, que en staging no existe (ni puede: las guardas de
-- las semillas y del carril abortan si la ven).
--
-- Así que, como en producción, una cuenta interna suya:
--   «Plataforma de Prueba» (inventada, is_internal), sin ningún interruptor:
--   en su propia cuenta «Folvy Conta» no sale, y gestionando A sí.
-- El carril copia la cuenta con él (la saca de sus perfiles).
--
-- Solo añade, y se puede aplicar dos veces (W07): «on conflict do nothing».
-- Guardas: aborta si al otro lado hay cuentas de producción, o si falta el
-- superadministrador de prueba.
-- ============================================================================

do $$
declare
  u      constant uuid := 'c0600000-0000-4000-8000-0000000000f0';
  cuenta constant uuid := 'c0600000-0000-4000-8000-0000000000f1';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla DM1 ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
  if not exists (select 1 from public.platform_admins where user_id = u and active) then
    raise exception 'Semilla DM1: falta el superadministrador de prueba (semilla del C06).';
  end if;

  insert into public.accounts (id, name, slug, is_internal, created_at, updated_at)
  values (cuenta, 'Plataforma de Prueba', 'plataforma-de-prueba', true, '2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00')
  on conflict (id) do nothing;

  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at, created_at, updated_at)
  values (u, cuenta, 'admin', true, 'Plataforma de prueba C06', '2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00')
  on conflict (user_id, account_id) do nothing;
end $$;
