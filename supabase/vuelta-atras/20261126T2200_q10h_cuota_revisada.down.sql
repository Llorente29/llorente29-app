-- supabase/vuelta-atras/20261126T2200_q10h_cuota_revisada.down.sql
--
-- Vuelta atrás de la 2200 (Q10 · la guarda de las cuotas fijas y lo corregido): quita la tabla de cuotas revisadas y,
-- si no se ha corregido ninguna incidencia, las dos columnas. conta-cegid-mandar lee la tabla y conta-cegid-corregir
-- escribe las columnas desde esta rama: la vuelta atrás va ANTES de fusionar (si se fusionó, primero hay que volver a
-- desplegar las funciones de main).

drop table if exists public.conta_cegid_cuota_revisada;
do $vuelta$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_cegid_incidencia' and column_name = 'corregida_at')
     and exists (select 1 from public.conta_cegid_incidencia where corregida_at is not null) then
    raise notice 'Q10 · 2200 vuelta atrás: hay incidencias corregidas; sus columnas se quedan.';
  else
    alter table public.conta_cegid_incidencia drop column if exists corregida_at;
    alter table public.conta_cegid_incidencia drop column if exists corregida_por;
  end if;
end $vuelta$;
