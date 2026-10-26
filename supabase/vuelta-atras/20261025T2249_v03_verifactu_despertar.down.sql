-- supabase/vuelta-atras/20261025T2249_v03_verifactu_despertar.down.sql
-- Vuelta atrás de la 2249: quita los dos cron (si están) y sus funciones. Va
-- antes de la de la 2141 y la de la 2140.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'verifactu-despertar') then perform cron.unschedule('verifactu-despertar'); end if;
    if exists (select 1 from cron.job where jobname = 'verifactu-aviso-certificado') then perform cron.unschedule('verifactu-aviso-certificado'); end if;
  end if;
end $$;
drop function if exists public.verifactu_despertar();
drop function if exists public.verifactu_aviso_certificado();
