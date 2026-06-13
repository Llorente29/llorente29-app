-- supabase/migrations/20260613T2700_kds_set_default_station.sql
-- ============================================================================
-- CAPA 1 del KDS · RPC kds_set_default_station (cambio ATÓMICO del defecto)
-- ============================================================================
-- Fija la estación por defecto de un local en UNA sola operación: quita el
-- defecto a todas las del local y lo pone a la elegida, dentro de la misma
-- función (atómico). Evita la ventana "cero defaults" de dos UPDATE sueltos
-- desde el cliente (si se cortara entre ambos, el local quedaría sin defecto
-- → las líneas volverían a "Sin estación"). Deuda 0.
--
-- SECURITY DEFINER con guard de sesión (la llama el encargado desde Ajustes;
-- no es kiosco). Verifica que la estación pertenece al local indicado.
-- Como un solo statement UPDATE cubre ambos cambios, el índice único parcial
-- (where is_default) nunca ve dos true a la vez.
--
-- DDL/CREATE OR REPLACE. auth.uid() null en SQL Editor → NO probar aquí la
-- rama de sesión; se prueba desde la app.
-- ============================================================================

create or replace function public.kds_set_default_station(
  p_location_id uuid,
  p_station_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  -- la estación debe existir, estar activa y pertenecer al local
  select account_id into v_account from kitchen_station
   where id = p_station_id and location_id = p_location_id and is_active;
  if v_account is null then
    raise exception 'kds_set_default_station: estación no válida para el local';
  end if;

  -- guard de sesión: el usuario debe poder gestionar esta cuenta
  if not current_user_is_admin_or_manager_of(v_account) then
    raise exception 'kds_set_default_station: sin permiso';
  end if;

  -- Cambio atómico en un único UPDATE: la elegida pasa a true, el resto del
  -- local a false. Un solo statement → el índice parcial nunca ve dos true.
  update kitchen_station
     set is_default = (id = p_station_id),
         updated_at = now()
   where location_id = p_location_id
     and is_default is distinct from (id = p_station_id);
end;
$$;
