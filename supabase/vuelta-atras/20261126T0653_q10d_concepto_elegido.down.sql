-- supabase/vuelta-atras/20261126T0653_q10d_concepto_elegido.down.sql
--
-- Vuelta atrás de la 0653 (Q10 · el concepto elegido): quita la función y, si nadie ha elegido nada, la tabla. La
-- columna del texto del cobro se queda: la escribe conta-gocardless-leer, y quitarla rompería su lectura.

drop function if exists public.conta_cegid_elegir_concepto(uuid, text, text, text);
do $vuelta$
begin
  if to_regclass('public.conta_cegid_concepto_elegido') is null then return; end if;
  if exists (select 1 from public.conta_cegid_concepto_elegido) then
    raise notice 'Q10 · 0653 vuelta atrás: hay conceptos elegidos; la tabla se queda (antes, la vuelta atrás de la 0654).';
  else
    drop table public.conta_cegid_concepto_elegido;
  end if;
end $vuelta$;
