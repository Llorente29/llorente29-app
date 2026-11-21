-- supabase/staging/sql/20261114_b01r26_token_de_la_c0009_prueba.sql
--
-- SOLO STAGING. Prueba de la B01r26 · el token de la C0009 (2256). Todo en una
-- transacción con ROLLBACK:
--   1. Sin Foodint, la migración no hace nada (ni conexiones, ni envíos, ni traspasos).
-- Que sean exactamente los 333 y que el token se quite lo mide el ensayo de
-- producción (la guarda de Sumied y las cuentas de la tanda). Lo del token en el
-- código lo prueban tests/conta/diez/cliente.test.ts.
-- sin usuario: la 2256 solo la ejecuta el real de producción con service_role (una conexión y sus envíos); ningún usuario la llama.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01r26 token: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';
create temp table prueba_antes on commit drop as
  select (select count(*) from public.account_connector where token_ref is not null) tokens,
         (select count(*) from public.external_send where last_error is null) sin_motivo,
         (select coalesce(sum(jsonb_array_length(detalle)), 0) from public.conta_diez_traspaso) detalle;
\i supabase/migrations/20261114T2256_b01r26_token_de_la_c0009.sql
do $$ begin
  if (select count(*) from public.account_connector where token_ref is not null) <> (select tokens from prueba_antes)
     or (select count(*) from public.external_send where last_error is null) <> (select sin_motivo from prueba_antes)
     or (select coalesce(sum(jsonb_array_length(detalle)), 0) from public.conta_diez_traspaso) <> (select detalle from prueba_antes) then
    raise exception 'PRUEBA B01r26 token 1: sin Foodint la migración ha cambiado algo.';
  end if;
end $$;
select 'PRUEBA B01r26 token de la C0009: en verde' as resultado;
rollback;
