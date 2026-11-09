-- supabase/vuelta-atras/20261109T1707_gd_ingresos_gocardless.down.sql
--
-- Vuelta atrás de la 1707: se quita el cron y las dos funciones. Los ingresos
-- que ya hubiera apuntado se quedan en el banco de la demo, como cualquier
-- extracto subido (y casados o no, como los dejara Bancos): son datos de la
-- cuenta demo y «Volver a empezar» los limpia. El día del real, la 1707 no
-- apunta ninguno (0 liquidaciones leídas).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule('gd-ingresos-gocardless') from cron.job where jobname = 'gd-ingresos-gocardless'$q$;
  end if;
end $$;
drop function if exists public.demo_gestoria_ingresos_gocardless_demos();
drop function if exists public.demo_gestoria_ingresos_gocardless(uuid);
