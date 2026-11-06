-- supabase/vuelta-atras/20261106T1530_g01_clientes_cuotas.down.sql
--
-- G01 · La vuelta atrás de la 1530: fuera la lectura de cada noche, las vistas,
-- las funciones, los disparadores, las tablas nuevas y las columnas añadidas a
-- conta_cobro_cliente y conta_mandato; y los secretos de las conexiones en
-- Vault (solo los de este encargo: conta_gocardless:* y conta_bitrix:*).
-- Va después de la de la 1531 (que quita la restricción que usa
-- conta_mandato.origen).
-- sin prueba con datos: la prueba de staging (20261106_g01_clientes_cuotas_prueba.sql) pasa la tanda y esta vuelta atrás en ROLLBACK y comprueba que todo queda como antes; el ensayo de producción la pasa entera, en ROLLBACK.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') and exists (select 1 from cron.job where jobname = 'conta-gestoria-leer') then
    perform cron.unschedule('conta-gestoria-leer');
  end if;
end $$;

drop view if exists public.conta_consulta_diferencias;
drop view if exists public.conta_consulta_lineas;
drop view if exists public.conta_consulta_clientes;

drop function if exists public.conta_gestoria_despertar();
drop function if exists public.conta_linea_al_mes(uuid, date);
drop function if exists public.conta_bitrix_guardar_fichas(uuid, jsonb);
drop function if exists public.conta_bitrix_secreto(uuid);
drop function if exists public.conta_bitrix_guardar_conexion(uuid, text, text, text, text);
drop function if exists public.conta_gocardless_secreto(uuid);
drop function if exists public.conta_gocardless_guardar_conexion(uuid, text, text, text);

drop table if exists public.conta_gestoria_diferencia;
drop table if exists public.conta_gestoria_lectura;
drop table if exists public.conta_gc_importacion;
drop table if exists public.conta_gc_cobro;
drop table if exists public.conta_gc_suscripcion;
drop table if exists public.conta_gc_mandato;
drop table if exists public.conta_gc_cliente;
drop table if exists public.conta_gestoria_cambio;
drop table if exists public.conta_linea;
drop table if exists public.conta_solicitud;
drop table if exists public.conta_tarifa;
drop table if exists public.conta_servicio;
drop table if exists public.conta_gestoria_cliente;
drop table if exists public.conta_crm_bitrix;
drop table if exists public.conta_cobro_gocardless;
drop function if exists public._conta_gestoria_apuntar();

drop index if exists public.conta_mandato_gocardless_idx;
alter table public.conta_mandato drop column if exists gc_estado;
alter table public.conta_mandato drop column if exists gc_mandato_id;
alter table public.conta_mandato drop column if exists origen;
alter table public.conta_cobro_cliente drop column if exists gc_casado_por;
alter table public.conta_cobro_cliente drop column if exists gc_cliente_id;
alter table public.conta_cobro_cliente drop column if exists forma_cobro;

delete from vault.secrets where name like 'conta_gocardless:%' or name like 'conta_bitrix:%';
