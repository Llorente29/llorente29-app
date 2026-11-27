-- supabase/vuelta-atras/20261127T0730_q10i_banco_a_cegid.down.sql
--
-- Vuelta atrás de la 0730 (Q10 · lo cobrado por el banco, a Cegid): quita la función y, si nadie ha decidido nada, la
-- tabla de decisiones; y, si no se ha mandado ninguna incidencia del banco, las tres columnas. Va ANTES de fusionar (si
-- se fusionó, primero hay que volver a desplegar conta-cegid-mandar de main).

drop function if exists public.conta_banco_decidir(uuid, text, text, text, int, text, text);
do $vuelta$
begin
  if to_regclass('public.conta_banco_decision') is not null then
    if exists (select 1 from public.conta_banco_decision) then
      raise notice 'Q10 · 0730 vuelta atrás: hay decisiones apuntadas; la tabla se queda.';
    else
      drop table public.conta_banco_decision;
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_cegid_incidencia' and column_name = 'origen_clave')
     and exists (select 1 from public.conta_cegid_incidencia where origen_clave is not null) then
    raise notice 'Q10 · 0730 vuelta atrás: hay incidencias del banco; sus columnas se quedan.';
  else
    alter table public.conta_cegid_incidencia drop column if exists parte;
    alter table public.conta_cegid_incidencia drop column if exists origen_clave;
    alter table public.conta_cegid_incidencia drop column if exists movement_id;
  end if;
end $vuelta$;
