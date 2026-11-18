-- supabase/vuelta-atras/20261117T1601_r05_dia_tpv_asiento.down.sql
--
-- Vuelta atrás de la 1601 (R05): quita el enlace del día con su asiento. Va la
-- última (después de la 1603 y la 1602). Si ya hay días del TPV validados, se
-- perdería qué asiento es de cada uno: por eso para si hay alguno.

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_tpv_dia' and column_name = 'entry_id') then
    if exists (select 1 from public.conta_tpv_dia where entry_id is not null) then
      raise exception 'Vuelta atrás R05: ya hay días del TPV validados con su asiento. No se quita el enlace sin mirarlo antes.';
    end if;
  end if;
end $$;
drop index if exists public.conta_tpv_dia_asiento;
alter table public.conta_tpv_dia drop column if exists entry_id;
