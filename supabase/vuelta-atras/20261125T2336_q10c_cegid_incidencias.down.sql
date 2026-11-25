-- supabase/vuelta-atras/20261125T2336_q10c_cegid_incidencias.down.sql
--
-- Vuelta atrás de la 2336 (Q10 · lo mandado a Cegid): quita la tabla, SOLO si no se ha mandado nada todavía. Si hay
-- incidencias mandadas, la tabla es la única memoria de qué hay en Cegid (para deshacer y para no repetir): no se
-- quita y lo dice; antes, «Deshacer» en la pantalla.

do $vuelta$
begin
  if to_regclass('public.conta_cegid_incidencia') is null then return; end if;
  if exists (select 1 from public.conta_cegid_incidencia where estado in ('mandando', 'mandada', 'facturada')) then
    raise notice 'Q10 · 2336 vuelta atrás: hay incidencias mandadas a Cegid; la tabla se queda (deshazlas antes en la pantalla).';
  else
    drop table public.conta_cegid_incidencia;
  end if;
end $vuelta$;
