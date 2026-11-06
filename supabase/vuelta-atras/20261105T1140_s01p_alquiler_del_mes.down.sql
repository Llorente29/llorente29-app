-- supabase/vuelta-atras/20261105T1140_s01p_alquiler_del_mes.down.sql
-- Vuelta atrás de la 1140: fuera la pasada de cada día, las dos funciones desde
-- su respaldo, fuera las nuevas, y las columnas nuevas (después de la vuelta
-- atrás de la 1141, que quita lo que las usa en Foodint).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 's01p-alquiler-del-mes') then perform cron.unschedule('s01p-alquiler-del-mes'); end if;
  end if;
end $$;
select public._restaurar_funcion('public.conta_esperadas_del_mes(uuid,date)', '20261105T1140_s01p_alquiler_del_mes');
select public._restaurar_funcion('public.conta_cierre_bloque_repite(uuid,date)', '20261105T1140_s01p_alquiler_del_mes');
drop function if exists public._conta_alquileres_proponer_todas();
drop function if exists public._conta_alquiler_proponer(uuid, date);
drop function if exists public._conta_alquiler_del_mes(uuid, date);
drop table if exists public.recurring_contract_month;
alter table public.supplier_expected_invoice drop column if exists ends_on;
alter table public.recurring_contract
  drop constraint if exists recurring_contract_alquiler_dia,
  drop constraint if exists recurring_contract_exento_con_certificado,
  drop constraint if exists recurring_contract_alquiler_fechas,
  drop column if exists location_id, drop column if exists vat_rate_id, drop column if exists withholding_rate_id,
  drop column if exists vat_account, drop column if exists withholding_account, drop column if exists creditor_account,
  drop column if exists day_of_month, drop column if exists propose_from, drop column if exists starts_on, drop column if exists ends_on,
  drop column if exists withholding_since, drop column if exists withholding_exempt,
  drop column if exists exempt_document_name, drop column if exists exempt_document_uploaded_at;
