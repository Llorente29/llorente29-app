-- Vuelta atrás de «El día se cierra a las 6:00» · 5 · el cron. Lo ya cerrado se queda cerrado.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'conta-cierre-del-dia') then
    perform cron.unschedule('conta-cierre-del-dia');
  end if;
end $$;
