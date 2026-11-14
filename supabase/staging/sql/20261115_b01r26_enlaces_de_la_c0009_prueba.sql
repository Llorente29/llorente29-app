-- supabase/staging/sql/20261115_b01r26_enlaces_de_la_c0009_prueba.sql
--
-- SOLO STAGING. Prueba de la B01r26 · los enlaces a la C0009 (0016). Todo en una
-- transacción con ROLLBACK:
--   1. Sin Foodint, la migración no hace nada (ni envíos ni traspasos).
-- Que sean exactamente los 301 y los 16, y que los 332 de esta noche no se
-- toquen, lo mide el ensayo de producción (la guarda de Sumied y las cuentas).
-- El mecanismo (un envío «enlazado» no va en el traspaso; en «pendiente» sin
-- referencia, sí) ya lo prueba 20261114_b01r26_enlaces_falsos_prueba.sql.
-- sin usuario: la 0016 solo la ejecuta el real de producción con service_role (envíos de una empresa); ningún usuario la llama.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01r26 C0009: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';
create temp table prueba_antes on commit drop as
  select (select count(*) from public.external_send where status = 'pendiente') pendientes,
         (select count(*) from public.external_send where last_error is null) sin_motivo,
         (select coalesce(sum(jsonb_array_length(detalle)), 0) from public.conta_diez_traspaso) detalle;
\i supabase/migrations/20261115T0016_b01r26_enlaces_de_la_c0009.sql
do $$ begin
  if (select count(*) from public.external_send where status = 'pendiente') <> (select pendientes from prueba_antes)
     or (select count(*) from public.external_send where last_error is null) <> (select sin_motivo from prueba_antes)
     or (select coalesce(sum(jsonb_array_length(detalle)), 0) from public.conta_diez_traspaso) <> (select detalle from prueba_antes) then
    raise exception 'PRUEBA B01r26 C0009 1: sin Foodint la migración ha cambiado algo.';
  end if;
end $$;
select 'PRUEBA B01r26 enlaces a la C0009: en verde' as resultado;
rollback;
