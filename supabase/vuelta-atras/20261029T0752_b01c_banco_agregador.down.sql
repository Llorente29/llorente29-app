-- ============================================================================
-- VUELTA ATRÁS · 20261029T0752_b01c_banco_agregador.sql
-- ----------------------------------------------------------------------------
-- Quita el cron y el despertador, las funciones nuevas y la tabla nueva
-- (bank_aggregator_connection), y a bank_aggregator_link (la del B01, que ya
-- existía) las columnas y restricciones que le añadió. Va DESPUÉS de deshacer
-- la 0753. Se puede pasar dos veces. Los extractos y movimientos que ya hubieran entrado por
-- la conexión se quedan (son bank_statement de fuente «agregador:open-banking-io»;
-- se quitan, si hace falta, con bank_extracto_deshacer, uno a uno).
-- ============================================================================

do $$
begin
  if to_regclass('cron.job') is not null and exists (select 1 from cron.job where jobname = 'conta-banco-agregador-despertar') then
    perform cron.unschedule('conta-banco-agregador-despertar');
  end if;
end $$;

drop function if exists public.conta_banco_agregador_despertar();
drop function if exists public.bank_agregador_quitar(uuid);
drop function if exists public.bank_agregador_conexion_apuntar(uuid, text);
drop function if exists public.bank_agregador_apuntar(uuid, text, text, text, text, timestamptz, text, text, text, numeric, date, integer, integer, date, date);
drop table if exists public.bank_aggregator_connection;

alter table public.bank_aggregator_link drop column if exists bank_name, drop column if exists renew_url, drop column if exists last_run_at, drop column if exists last_status,
  drop column if exists last_message, drop column if exists bank_balance, drop column if exists bank_balance_date, drop column if exists last_new,
  drop column if exists last_repeated, drop column if exists last_from, drop column if exists last_to;
