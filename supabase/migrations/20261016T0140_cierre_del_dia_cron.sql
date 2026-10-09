-- ============================================================================
-- El día se cierra a las 6:00 — 5 · CADA HORA
-- ----------------------------------------------------------------------------
-- A los 7 minutos de cada hora (UTC; da igual: el procedimiento decide por
-- la hora de Madrid de cada empresa, y solo cierra lo que ya ha pasado su
-- hora). Con el cierre a las 6:00, el día de ayer se cierra a las 6:07 de
-- Madrid, en verano y en invierno.
--
-- La PRIMERA pasada cierra el atraso de agosto, septiembre y octubre: los
-- pedidos de marca propia que siguen abiertos en días ya cerrados. La lista,
-- en el PR antes de aplicar (conta_por_cerrar).
--
-- Va al final de la tanda: detrás de la 0110, para que el cierre no devuelva
-- stock, y de la 0120, para que lo cerrado no se proponga.
-- Si falla una empresa, el procedimiento termina con ERROR y cron.job_run_details
-- lo apunta como «failed» (no como aviso).
-- Vuelta atrás: supabase/vuelta-atras/20261016T0140_cierre_del_dia_cron.down.sql
-- ============================================================================

do $$ begin
  if exists (select 1 from cron.job where jobname = 'conta-cierre-del-dia') then
    perform cron.unschedule('conta-cierre-del-dia');
  end if;
end $$;

select cron.schedule('conta-cierre-del-dia', '7 * * * *', $cron$call public.conta_cierre_del_dia_todas()$cron$);
