-- scripts/conta/produccion/cuentas/b01c-agregador.sql
--
-- B01c (29/10) · LO QUE CUENTA LA TANDA DE LOS MOVIMIENTOS QUE ENTRAN SOLOS
-- (0752 y 0753), antes y después. SOLO LEE. Antes de la tanda y después de
-- deshacerla: la tabla nueva no existe, bank_aggregator_link sin sus columnas
-- nuevas, sin funciones ni cron, y _bank_cuenta_de_empresa sin la clave de
-- servicio. Con la tanda: la tabla con la fila de Foodint (solo en
-- producción), las 10 columnas nuevas, sus 4 funciones, el cron (donde está el
-- cron_secret) y la clave de servicio dentro.
--
-- Todo es del catálogo o de tablas que crea la propia tanda (miradas con
-- to_regclass): nada que otro proceso escriba a mitad del ensayo (W06).
select clave, valor from (
  select 1 o, 'tabla bank_aggregator_connection' clave, (to_regclass('public.bank_aggregator_connection') is not null)::text valor union all
  select 2, 'conexiones (base entera)',
    case when to_regclass('public.bank_aggregator_connection') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.bank_aggregator_connection', false, true, '')))[1]::text end union all
  select 3, 'columnas nuevas de bank_aggregator_link (de 11)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bank_aggregator_link'
       and column_name in ('bank_name', 'renew_url', 'last_run_at', 'last_status', 'last_message', 'bank_balance', 'bank_balance_date', 'last_new', 'last_repeated', 'last_from', 'last_to'))::text union all
  select 4, 'funciones (bank_agregador_*, conta_banco_agregador_despertar)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'bank\_agregador\_%' or p.proname = 'conta_banco_agregador_despertar'))::text union all
  select 5, 'cron conta-banco-agregador-despertar',
    case when to_regclass('cron.job') is null then 'sin pg_cron' else (select count(*) from cron.job where jobname = 'conta-banco-agregador-despertar')::text end union all
  select 6, '_bank_cuenta_de_empresa deja pasar a la clave de servicio',
    (pg_get_functiondef('public._bank_cuenta_de_empresa(uuid)'::regprocedure) like '%service_role%')::text union all
  select 7, 'el proveedor admite open_banking_io',
    coalesce((select pg_get_constraintdef(oid) like '%open_banking_io%' from pg_constraint where conname = 'bank_aggregator_link_provider_check')::text, 'sin CHECK')
) x order by o;
