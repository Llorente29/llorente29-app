-- supabase/vuelta-atras/20261028T1025_s01_pasada_de_noche.down.sql
--
-- Vuelta atrás de la 1025 (la pasada de las 03:40), que solo añade: se quitan
-- el cron, el procedimiento y la función. Lo que ya propuso o validó se queda
-- en el libro. Va antes que las de los cinco orígenes.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'conta-propuestas-de-noche') then
    perform cron.unschedule('conta-propuestas-de-noche');
  end if;
end $$;
drop procedure if exists public.conta_propuestas_de_noche_todas();
drop function if exists public.conta_propuestas_de_noche(uuid);
