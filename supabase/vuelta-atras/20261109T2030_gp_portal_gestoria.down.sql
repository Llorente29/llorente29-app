-- supabase/vuelta-atras/20261109T2030_gp_portal_gestoria.down.sql
--
-- GP · La vuelta atrás de la 2030: fuera el cron, el despertador, los avisos
-- pendientes y hacer o rechazar lo que pide el cliente; _conta_portal_proximo
-- como estaba antes, restaurada de su respaldo (_restaurar_funcion comprueba la
-- huella). Lo que ya se hizo con ellas (altas, bajas, avisos mandados) se queda:
-- son datos de verdad.
-- sin prueba con datos: la prueba de staging (20261109_gp_portal_gestoria_prueba.sql) la pasa en ROLLBACK y comprueba que no queda nada.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule('portal-avisos') from cron.job where jobname = 'portal-avisos'$q$;
  end if;
end $$;

drop function if exists public.conta_portal_despertar();
drop function if exists public.conta_portal_avisos_hechos(uuid[], uuid[]);
drop function if exists public.conta_portal_avisos_pendientes(int);
drop function if exists public.conta_portal_solicitud_rechazar(uuid, text);
drop function if exists public.conta_portal_solicitud_hacer(uuid, uuid);
select public._restaurar_funcion('public._conta_portal_proximo(uuid,uuid)', '20261109T2030_gp_portal_gestoria');
