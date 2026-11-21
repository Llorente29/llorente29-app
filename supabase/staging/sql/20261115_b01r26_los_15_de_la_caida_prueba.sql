-- supabase/staging/sql/20261115_b01r26_los_15_de_la_caida_prueba.sql
--
-- SOLO STAGING. Prueba de la B01r26 · los 15 de la caída (0825). Todo en una
-- transacción con ROLLBACK:
--   1. Sin Foodint, la migración no hace nada (ni envíos ni traspasos).
-- Que sean exactamente los 15 y que el detalle quede en 5 lo mide el ensayo de
-- producción (la guarda de Sumied y las cuentas de la tanda).
-- sin usuario: la 0825 solo la ejecuta el real de producción con service_role (15 envíos y un traspaso); ningún usuario la llama.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01r26 los 15: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';
create temp table prueba_antes on commit drop as
  select (select count(*) from public.external_send where last_error is null) sin_motivo,
         (select coalesce(sum(jsonb_array_length(detalle)), 0) from public.conta_diez_traspaso) detalle,
         (select coalesce(sum(no_llegaron), 0) from public.conta_diez_traspaso) no_llegaron;
\i supabase/migrations/20261115T0825_b01r26_los_15_de_la_caida.sql
do $$ begin
  if (select count(*) from public.external_send where last_error is null) <> (select sin_motivo from prueba_antes)
     or (select coalesce(sum(jsonb_array_length(detalle)), 0) from public.conta_diez_traspaso) <> (select detalle from prueba_antes)
     or (select coalesce(sum(no_llegaron), 0) from public.conta_diez_traspaso) <> (select no_llegaron from prueba_antes) then
    raise exception 'PRUEBA B01r26 los 15 1: sin Foodint la migración ha cambiado algo.';
  end if;
end $$;
select 'PRUEBA B01r26 los 15 de la caída: en verde' as resultado;
rollback;
