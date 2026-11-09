-- supabase/vuelta-atras/20261109T1021_g05_verifactu_demos.down.sql
-- Vuelta atrás de la 1021 del G05: quita el cron de las pruebas de las demos
-- (si está) y su función. La de real (verifactu_despertar) no se toca.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule('verifactu-despertar-demos') from cron.job where jobname = 'verifactu-despertar-demos'$q$;
  end if;
end $$;
drop function if exists public.verifactu_despertar_demos();
