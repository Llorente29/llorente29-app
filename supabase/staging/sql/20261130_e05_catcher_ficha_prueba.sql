-- ============================================================================
-- PRUEBA (staging) · E05 · la 0420 (la ficha de Catcher Marketplace en
-- Foodint). Todo en una transacción con ROLLBACK.
--
-- La 0420 y su vuelta atrás solo actúan sobre Foodint, que no está en staging:
-- aquí no hacen nada y lo dicen. Su prueba con datos es el ENSAYO de la tanda
-- en producción (todo en una transacción y rollback).
--   1. Staging no tiene a Foodint.
--   2. La 0420 aquí no crea ni cambia nada (huella de las fichas, las cuentas y
--      las facturas de la empresa A, igual antes y después).
--   3. Su vuelta atrás, tampoco.
-- ============================================================================

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA 0420 · 1: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  raise notice 'PRUEBA 0420 · 1: staging no tiene a Foodint.';
end $$;

create temp table huella_0420 as
  select (select count(*) from public.supplier) proveedores, (select count(*) from public.company_account) cuentas,
         (select count(*) from public.company_account_link) enlaces, (select md5(coalesce(string_agg(id::text || coalesce(supplier_id::text, ''), '|' order by id), '')) from public.supplier_invoice) facturas;

\i supabase/migrations/20261130T0420_e05_catcher_ficha.sql
\i supabase/vuelta-atras/20261130T0420_e05_catcher_ficha.down.sql

do $$
declare h record;
begin
  select * into h from huella_0420;
  if h.proveedores <> (select count(*) from public.supplier) or h.cuentas <> (select count(*) from public.company_account)
     or h.enlaces <> (select count(*) from public.company_account_link)
     or h.facturas <> (select md5(coalesce(string_agg(id::text || coalesce(supplier_id::text, ''), '|' order by id), '')) from public.supplier_invoice) then
    raise exception 'PRUEBA 0420 · 2/3: la 0420 o su vuelta atrás han cambiado algo en staging.';
  end if;
  raise notice 'PRUEBA 0420 · 2 y 3: la 0420 y su vuelta atrás no tocan nada aquí (fichas, cuentas, enlaces y facturas, iguales).';
end $$;

rollback;
