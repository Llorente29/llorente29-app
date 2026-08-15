-- Fase 3 (A.1, 15/08/2026) -- callback_status: si el callback registrado en
-- HubRise es el correcto, para el tablero de vigilancia. DIRIGIDO POR
-- EVENTOS, nunca por cron -- ver folvy_mapa_sistema.md, regla permanente
-- "NINGUN cron sondea GET /callback" (condicion del pre-audit de Antoine,
-- punto 2, 29/07). Se escribe:
--   - al conectar/reconectar (hubrise-oauth-callback, ensureHubriseCallback ya
--     corre ahi -- 2.6)
--   - al desconectar (hubrise-location-disconnect, siempre 'missing': el paso
--     1 ya intenta borrar el callback en HubRise)
--   - cuando un token pasa de invalid a ok (hubrise-connection-health,
--     transicion real, no bucle -- un token que murio y volvio merece
--     reconfirmar su callback una vez, no vigilancia continua)
--   - bajo demanda, boton "Verificar callback ahora" del tablero (Fase 3, A.1)
--
-- Mismo formato que token_status (NOT NULL DEFAULT 'unknown', nunca miente
-- por ausencia de dato -- las filas existentes empiezan en 'unknown' hasta
-- el primer evento real que las toque).

do $mig$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'external_integration'
      and column_name = 'callback_status'
  ) then
    alter table public.external_integration
      add column callback_status text not null default 'unknown',
      add column callback_checked_at timestamptz null;

    alter table public.external_integration
      add constraint external_integration_callback_status_check
      check (callback_status = any (array['ok', 'missing', 'unknown']));
  end if;
end;
$mig$;
