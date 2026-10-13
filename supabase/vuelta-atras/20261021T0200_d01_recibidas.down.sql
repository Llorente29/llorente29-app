-- Vuelta atrás de 20261021T0200 (D01): la base de Facturas recibidas.
-- PARA si ya hay algo de una persona o de un proveedor que se perdería:
-- llegadas, facturas que vinieron por la bandeja, bases por tipo, esperadas,
-- peticiones, actividad, direcciones o proveedores traídos de una factura.
-- El ajuste de compras sembrado sí se puede quitar si nadie lo ha cambiado.
do $$
declare v text;
begin
  select string_agg(t || ' ' || n, ', ') into v from (
    select 'llegadas' t, count(*) n from public.document_inbox union all
    select 'facturas con canal o lectura', count(*) from public.supplier_invoice where arrival_channel is not null or reading is not null or inbox_id is not null union all
    select 'bases por tipo', count(*) from public.supplier_invoice_tax union all
    select 'esperadas', count(*) from public.supplier_expected_invoice union all
    select 'peticiones', count(*) from public.supplier_invoice_request union all
    select 'actividad', count(*) from public.document_activity union all
    select 'direcciones', count(*) from public.company_inbound_address union all
    select 'proveedores traídos de factura', count(*) from public.supplier where created_from is not null union all
    select 'ajustes cambiados a mano', count(*) from public.company_purchase_setting where updated_by_name is not null
  ) x where n > 0;
  if v is not null then raise exception 'Vuelta atrás D01 0200: hay %; no se quita nada.', v; end if;
end $$;
drop function if exists public.banco_facturas_recibidas_pendientes(uuid, date);
drop function if exists public.conta_esperadas_aprender(uuid, date);
drop function if exists public.conta_esperadas_no_llegadas(uuid, date);
drop function if exists public.supplier_invoice_repetida(uuid, uuid, text, text, date, numeric, uuid);
drop function if exists public.conta_direccion_facturas(uuid, text);
drop function if exists public.conta_ajustes_compras_guardar(uuid, boolean, boolean, text);
drop function if exists public.conta_recibe_mercancia(uuid);
alter table public.supplier drop column if exists created_from;
drop table if exists public.document_activity;
drop table if exists public.supplier_invoice_request;
drop table if exists public.supplier_expected_invoice;
drop table if exists public.supplier_invoice_tax;
drop index if exists public.supplier_invoice_numero_uq;
alter table public.supplier_invoice drop column if exists inbox_id;
alter table public.supplier_invoice drop column if exists surcharge_total;
alter table public.supplier_invoice drop column if exists reading;
alter table public.supplier_invoice drop column if exists reading_confidence;
alter table public.supplier_invoice drop column if exists number_key;
alter table public.supplier_invoice drop column if exists arrival_channel;
drop table if exists public.document_inbox;
drop table if exists public.company_inbound_address;
drop table if exists public.company_purchase_setting;
do $$ begin
  if to_regclass('public.document_inbox') is not null or to_regclass('public.company_purchase_setting') is not null then raise exception 'Vuelta atrás D01 0200: algo ha quedado.'; end if;
  raise notice 'Vuelta atrás D01 0200: sin las tablas, columnas y funciones del D01.';
end $$;
