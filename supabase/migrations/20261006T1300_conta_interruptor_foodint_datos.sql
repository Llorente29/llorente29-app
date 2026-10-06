-- ============================================================================
-- Conta · DATOS: el interruptor «Folvy Conta» (feature_flags, clave 'conta')
-- para la cuenta de Foodint. Tanda propia, antes del C02c (Respuesta 2 del
-- C02c: Julio quiere ver Folvy Conta en producción hoy).
-- ----------------------------------------------------------------------------
-- No hay pantalla para encenderlo: ningún código escribe en feature_flags, y
-- el panel de administración gestiona los módulos contratados, no esta tabla
-- (informe de la tarea 1 del C02c, PR #150).
--
-- Una fila, como la tiene la cuenta A en staging-conta: conta · enabled ·
-- manual_grant · sin caducidad · granted_by null. Anclada por account_id, no
-- por nombre (regla 9). En producción, el 06/10 (solo lectura): feature_flags
-- con 0 filas en la tabla entera; la cuenta 51ad1792-… existe y es «Foodint».
--
-- Si ya hubiera una fila 'conta' para la cuenta, no se toca (on conflict do
-- nothing) y la comprobación final dice si está encendida: si estuviera
-- apagada, aborta en vez de cambiarla en silencio.
--
-- Lo ve solo un usuario `admin` de la cuenta (el módulo pide requiredRole
-- admin), después de cerrar sesión y volver a entrar: la barra lee los
-- interruptores al empezar la sesión.
-- Vuelta atrás: supabase/vuelta-atras/20261006T1300_conta_interruptor_foodint_datos.down.sql
-- ============================================================================

do $$
declare
  v_cuenta constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
begin
  if not exists (select 1 from public.accounts where id = v_cuenta) then
    raise exception 'No existe la cuenta %: no se enciende nada.', v_cuenta;
  end if;

  insert into public.feature_flags (account_id, feature_key, enabled, source, expires_at, granted_by)
  values (v_cuenta, 'conta', true, 'manual_grant', null, null)
  on conflict (account_id, feature_key) do nothing;

  if not exists (select 1 from public.feature_flags
                  where account_id = v_cuenta and feature_key = 'conta' and enabled
                    and (expires_at is null or expires_at > now())) then
    raise exception 'La cuenta % ya tenía una fila «conta» y no está encendida (o ha caducado): no se cambia aquí. Mírala antes.', v_cuenta;
  end if;
end $$;
