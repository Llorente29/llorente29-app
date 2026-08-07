-- Bug encontrado durante el cierre de F8 (verificacion en vivo del toggle de Avisos): la fila GLOBAL de
-- app_settings (scope='global', account_id NULL) es invisible para CUALQUIER usuario autenticado, incluido
-- el admin de plataforma. Causa: la politica de SELECT exige "account_id = ANY(current_user_account_ids())",
-- y NULL nunca es igual a ningun elemento de un array de UUIDs reales -> la condicion es siempre NULL/false,
-- pase lo que pase con el rol del caller.
--
-- Efecto en produccion (confirmado con pg_policies + lectura directa de la fila): fetchAppSettings() falla
-- en TODA pantalla que la usa (AvisosSettingsPage del manager, TrabajadorApp del trabajador) y cae al
-- fallback DEFAULT_SETTINGS del cliente -- no es un fallo de seguridad (fail-closed, no se filtra nada),
-- pero deja INERTE el toggle "mostrar bolsa de horas al trabajador" que ya existia antes de hoy, y de
-- rebote los 3 nuevos de F8 (nocturnas/coste/cumplimiento): por mucho que el manager los active en Ajustes,
-- worker_portal_visibility() (SECURITY INVOKER, misma tabla) tampoco puede leer la fila -> siempre false.
--
-- La politica de UPDATE no tenia este problema: current_user_is_admin_of(account_id) con account_id=NULL
-- ya cae en su propio "OR current_user_is_admin()" y deja escribir al admin de plataforma. Solo el SELECT
-- estaba roto.
--
-- Fix: la fila global es legible por cualquier autenticado (es solo estado de un interruptor, no un dato
-- sensible en si mismo -- lo sensible es lo que el interruptor destapa, ya gateado aparte). Escritura sigue
-- restringida a admin.
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated
  using (account_id is null or account_id = any (current_user_account_ids()));
