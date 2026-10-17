-- supabase/vuelta-atras/20261121T0130_s01_ejes_analiticos.down.sql
--
-- Vuelta atrás de 20261121T0130_s01_ejes_analiticos. ANTES, la de la 0140 (la
-- regla 5 lee esta tabla) y el front de antes del S01 (el del S01 la lee).
-- No se pierde ningún dato de los asientos: solo qué ejes estaban encendidos.
-- PARA, sin tocar nada, si una persona ya ha cambiado un eje (updated_by): lo
-- que decidió se perdería. Lo sembrado por la 0130 no lleva updated_by.

do $$
declare n bigint;
begin
  if to_regclass('public.conta_eje_analitico') is not null then
    execute 'select count(*) from public.conta_eje_analitico where updated_by is not null' into n;
    if n > 0 then
      raise exception 'S01 0130 vuelta atrás: % ejes de analítica los ha cambiado una persona y se perdería lo que decidió. No se toca nada.', n;
    end if;
  end if;
end $$;

drop trigger if exists trg_conta_eje_analitico_al_dia on public.conta_eje_analitico;
drop table if exists public.conta_eje_analitico;
drop function if exists public.conta_eje_analitico_al_dia();
