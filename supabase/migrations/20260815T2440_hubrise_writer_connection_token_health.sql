-- Fase 3 (A.1, 15/08/2026) -- la escritora de cuenta gana salud REAL de
-- token, igual que ya tienen las conexiones de location en external_integration.
-- Hoy hubrise_writer_connection no tiene token_status/token_checked_at en
-- absoluto: no hay forma de saber si el token de cuenta sigue vivo salvo
-- esperar a que falle una publicacion de catalogo (el mismo agujero de los
-- 8 dias de julio, sin cerrar para la escritora). Mismo formato exacto que
-- external_integration.token_status (CHECK ok/invalid/unknown, default
-- 'unknown' -- nunca miente por ausencia de dato).
--
-- hubrise-connection-health (redesenado en el mismo encargo, SIN /callback --
-- ver folvy_mapa_sistema.md, regla permanente) escribira aqui via GET
-- /account, verificado en vivo el 15/08/2026.

do $mig$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'hubrise_writer_connection'
      and column_name = 'token_status'
  ) then
    alter table public.hubrise_writer_connection
      add column token_status text not null default 'unknown',
      add column token_checked_at timestamptz null;

    alter table public.hubrise_writer_connection
      add constraint hubrise_writer_connection_token_status_check
      check (token_status = any (array['ok', 'invalid', 'unknown']));
  end if;
end;
$mig$;
