-- ============================================================================
-- VUELTA ATRÁS de 20261005T0140_r02_sugerencia_ia.sql
-- Quita la detección, la respuesta y su registro. Si ya hay respuestas
-- guardadas, el registro es historia de lo que se decidió: para sin tocar nada.
-- ============================================================================
do $$
declare n int;
begin
  if to_regclass('public.delivery_policy_suggestion') is not null then
    execute 'select count(*) from public.delivery_policy_suggestion' into n;
    if n > 0 then
      raise exception 'VUELTA ATRÁS 0140 (R02): hay % respuestas a sugerencias de Folvy guardadas; se perderían. No se toca nada.', n;
    end if;
  end if;
end $$;

drop function if exists public.reparto_responder_sugerencia(uuid, uuid, text, uuid, boolean);
drop function if exists public.reparto_sugerencias(uuid, integer);
drop table if exists public.delivery_policy_suggestion;
