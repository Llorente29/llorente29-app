-- supabase/staging/sql/20261113_dl1_borrar_factura_410_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · borrar la FAC-00410 (0950). Todo en una
-- transacción con ROLLBACK. La 0950 no añade objetos y solo actúa en Foodint.
--   1. Sin Foodint, la migración no borra nada (las tablas que toca siguen igual).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 borrar factura: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la tanda corre como el dueño.
set constraints all immediate;

create temp table prueba_antes on commit drop as
  select (select count(*) from public.supplier_invoice) f, (select count(*) from public.document_inbox) b,
         (select count(*) from public.document_activity) a, (select count(*) from public.goods_receipt_ai_session) s;
\i supabase/migrations/20261113T0950_dl1_borrar_factura_410.sql

do $$
begin
  if (select count(*) from public.supplier_invoice) <> (select f from prueba_antes) or (select count(*) from public.document_inbox) <> (select b from prueba_antes)
     or (select count(*) from public.document_activity) <> (select a from prueba_antes) or (select count(*) from public.goods_receipt_ai_session) <> (select s from prueba_antes) then
    raise exception 'PRUEBA DL1 borrar factura 1: sin Foodint la migración ha borrado algo.';
  end if;
end $$;

select 'PRUEBA DL1 borrar factura: en verde' as resultado;
rollback;
