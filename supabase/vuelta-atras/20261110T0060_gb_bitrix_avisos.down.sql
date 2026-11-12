-- supabase/vuelta-atras/20261110T0060_gb_bitrix_avisos.down.sql
--
-- Vuelta atrás de la 0060 del GB: fuera el cron, las funciones y la tabla. Las
-- tareas ya puestas en el Bitrix24 de pruebas se quedan allí.
do $$
begin
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'conta-bitrix-avisos-despertar') then
      perform cron.unschedule('conta-bitrix-avisos-despertar');
    end if;
  end if;
end $$;
drop function if exists public.conta_bitrix_pestana_avisos_despertar();
drop function if exists public.conta_bitrix_pestana_aviso_apuntar(jsonb);
drop function if exists public.conta_bitrix_pestana_avisos_por_hacer(int);
drop table if exists public.conta_bitrix_pestana_aviso;
