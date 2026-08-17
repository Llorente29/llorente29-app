-- 20260815T2430_hubrise_disconnect_check_and_revoke_pending.sql
-- ENCARGO CODE — módulo de conexión HubRise, 2.5 (15/08/2026).
--
-- Punto B de Julio: al desconectar, el token guardado deja de servir para
-- nada y es un secreto en texto plano ocupando sitio -- se borra
-- (access_token = NULL) en la fila desconectada. El CHECK actual
-- (verificado con pg_get_constraintdef antes de tocar, no copiado de
-- memoria) exige access_token IS NOT NULL siempre que source='hubrise'.
-- Se relaja EXACTAMENTE igual que ya se hizo con external_catalog_id
-- (20260815T2310): exigirlo solo cuando la fila está activa. Relajación
-- pura -- cualquier fila que ya cumplía el CHECK viejo sigue cumpliendo el
-- nuevo (access_token IS NOT NULL implica NOT is_active OR access_token IS
-- NOT NULL), así que no puede romper filas existentes.
--
-- revoke_pending: si la revocación en HubRise (POST oauth2/v1/revoke) falla
-- (red, 4xx) durante una desconexión, NO se miente ("desconectado" a
-- medias) -- se apaga la fila igual (is_active=false, deja de operar) pero
-- se conserva access_token (para poder reintentar la revocación luego) y se
-- marca revoke_pending=true. Sin este flag, un intento fallido de revocar
-- sería indistinguible de uno exitoso una vez el resto de los flags está
-- apagado.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'external_integration_source_shape_chk'
  ) then
    alter table public.external_integration
      drop constraint external_integration_source_shape_chk;
  end if;

  alter table public.external_integration
    add constraint external_integration_source_shape_chk
    check (
      (source = 'lastapp' and external_org_id is not null and token_secret_name is not null)
      or (source = 'hubrise' and (not is_active or access_token is not null) and external_location_id is not null)
      or (source not in ('lastapp', 'hubrise'))
    );

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='external_integration' and column_name='revoke_pending'
  ) then
    alter table public.external_integration
      add column revoke_pending boolean not null default false;
  end if;
end $$;
