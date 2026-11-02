-- supabase/vuelta-atras/20261102T1936_a01_un_correo_por_problema.down.sql
-- Vuelta atrás de la 1936 (A01-1): fuera la tarea avisos-resolver, las dos
-- funciones como estaban (del respaldo y con su huella) y fuera lo nuevo. Lo que
-- el techo calló (aviso_callado) se pierde con su tabla: no se mandó nunca.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'avisos-resolver') then
    perform cron.unschedule('avisos-resolver');
  end if;
end $$;
select public._restaurar_funcion('public.last_catalog_watchdog()', '20261102T1936_a01_un_correo_por_problema');
select public._restaurar_funcion('public.encolar_alerta(text,text,text,text,interval,uuid,uuid,uuid,text)', '20261102T1936_a01_un_correo_por_problema');
drop function if exists public.avisos_resolver();
drop function if exists public._last_horas_en_horario(timestamptz, timestamptz);
drop function if exists public._aviso_poner_en_cola(text, text, text, text, uuid, uuid, uuid, text, integer);
drop function if exists public._aviso_pasadas_desde(text, timestamptz);
drop function if exists public._aviso_rango(text, text);
drop function if exists public._aviso_clave(text);
drop table if exists public.aviso_callado;
drop table if exists public.aviso_problema;
drop table if exists public.aviso_tipo;
