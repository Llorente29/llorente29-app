-- 20260815T1920_hubrise_usable_connection_unique_index.sql
-- ENCARGO CODE — módulo de conexión HubRise, FASE 1.1.
-- Aplicada por MCP (verificada 2026-08-15: pg_indexes confirma la definición
-- exacta). Sin duplicados en datos reales antes de crearla (verificado con
-- GROUP BY ... HAVING count(*) > 1 = 0 filas).
--
-- A lo sumo UNA conexión "usable" (is_active AND push_status_enabled) por
-- (cuenta, external_location_id) de HubRise. Neutraliza la Trampa 2 del
-- encargo: resolveHubriseToken cogía `usable[0]` sin orden determinista;
-- con varios locales el riesgo de coger la fila equivocada se multiplica.
-- El orden determinista en el propio resolveHubriseToken (además de este
-- índice) vive en supabase/functions/_shared/hubriseToken.ts.

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='ux_ei_hubrise_usable'
  ) then
    create unique index ux_ei_hubrise_usable
      on public.external_integration (account_id, external_location_id)
      where source = 'hubrise' and is_active and push_status_enabled;
  end if;
end $$;
