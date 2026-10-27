-- supabase/vuelta-atras/20261027T0641_pc01e4_recordatorios.down.sql
--
-- Vuelta atrás de la 0641 (PC01 · E4 · recordatorios), que solo añade: se
-- quita el cron y todo lo que crea, en orden inverso. Las tablas se van con sus
-- filas (ajustes de cobro, clientes apagados y el registro de recordatorios).
-- Lo que ya está en otra tabla se queda, porque es verdad con o sin la 0641:
-- las frases del historial de cada factura («Recordatorio mandado a …»,
-- customer_invoice_event), que cuentan correos que sí salieron.
-- Se puede pasar dos veces (todo «if exists»).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'conta-recordatorios-despertar') then
    perform cron.unschedule('conta-recordatorios-despertar');
  end if;
end $$;

drop function if exists public.conta_recordatorios_despertar();
drop function if exists public.conta_recordatorios_cliente(uuid, uuid, boolean);
drop function if exists public.conta_cobro_ajustes_guardar(uuid, boolean, integer[]);
drop function if exists public.conta_recordatorios_resumen(uuid);
drop function if exists public.conta_recordatorio_prueba_datos(uuid);
drop function if exists public.conta_recordatorio_apuntar(uuid, integer, date, boolean, text, text, text, text);
drop function if exists public.conta_recordatorios_por_mandar(date, integer);
drop function if exists public._pc01e4_datos(uuid);
drop function if exists public._pc01e4_sin_recordatorio(uuid);
drop function if exists public._pc01e4_correo(uuid);
drop function if exists public._pc01e4_dias(uuid);
drop table if exists public.conta_recordatorio;
drop table if exists public.conta_cobro_cliente;
drop table if exists public.conta_cobro_ajuste;
