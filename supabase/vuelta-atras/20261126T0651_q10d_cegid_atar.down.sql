-- supabase/vuelta-atras/20261126T0651_q10d_cegid_atar.down.sql
--
-- Vuelta atrás de la 0651 (Q10 · atar fichas a Cegid): quita las dos funciones y, si nadie ha atado nada, la tabla.
-- Si hay atados, la tabla se queda (es lo único que dice qué código tenía antes cada ficha): antes, la vuelta atrás de
-- la 0652.

drop function if exists public.conta_cegid_atar(uuid, uuid, int, text);
drop function if exists public._conta_cegid_atar(uuid, uuid, int, text, text);
do $vuelta$
begin
  if to_regclass('public.conta_cegid_atado') is null then return; end if;
  if exists (select 1 from public.conta_cegid_atado) then
    raise notice 'Q10 · 0651 vuelta atrás: hay fichas atadas; la tabla conta_cegid_atado se queda.';
  else
    drop table public.conta_cegid_atado;
  end if;
end $vuelta$;
