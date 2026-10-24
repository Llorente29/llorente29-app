-- supabase/vuelta-atras/20261024T0835_v01_facturas_venta.down.sql
--
-- Vuelta atrás de la 0835 (V01 · Ventas › Facturas): quita las tablas y las
-- funciones de las facturas de venta y deja el CHECK de los orígenes de un
-- asiento como estaba.
--
-- FRENO: si ya hay alguna factura EMITIDA (o un asiento con origen
-- 'customer_invoice'), para sin tocar nada: una emitida no se borra nunca, y su
-- asiento ya está en el libro y quizá en Diez. Entonces la vuelta atrás es otra
-- cosa (apagar el apartado en el front) y se decide con Julio.

do $$
begin
  if to_regclass('public.customer_invoice') is not null
     and exists (select 1 from public.customer_invoice where status <> 'borrador') then
    raise exception 'Hay facturas de venta emitidas: la vuelta atrás de la 0835 no se hace (no se borra una emitida). Decide con Julio.' using errcode = '23514';
  end if;
  if exists (select 1 from public.journal_entry where source_type = 'customer_invoice') then
    raise exception 'Hay asientos con origen customer_invoice: la vuelta atrás de la 0835 no se hace.' using errcode = '23514';
  end if;
end $$;

drop function if exists public.conta_venta_enviada(uuid, text, text, jsonb, text);
drop function if exists public.conta_venta_pdf_guardar(uuid, text, text, integer);
drop function if exists public.conta_venta_cobrar(uuid, date, numeric, text, text, text);
drop function if exists public.conta_venta_corregir(uuid, text, text, text);
drop function if exists public.conta_venta_emitir(uuid, text);
drop function if exists public.conta_venta_borrar(uuid);
drop function if exists public.conta_venta_guardar(uuid, uuid, jsonb, jsonb, text);
drop function if exists public._conta_venta_evento(uuid, text, text, jsonb, text);
drop function if exists public._conta_venta_diferencia(uuid);
drop function if exists public._conta_venta_cifras(uuid);

drop table if exists public.customer_invoice_event;
drop table if exists public.customer_invoice_payment;
drop table if exists public.customer_invoice_counter;
drop table if exists public.customer_invoice_line;
drop table if exists public.customer_invoice;
drop function if exists public.customer_invoice_line_inalterable();
drop function if exists public.customer_invoice_inalterable();

alter table public.journal_entry drop constraint if exists journal_entry_source_type_check;
alter table public.journal_entry add constraint journal_entry_source_type_check check (source_type = any (array[
  'sales_day', 'sales_adjustment', 'supplier_invoice', 'supplier_payment', 'channel_settlement', 'licensed_settlement', 'payroll', 'bank',
  'vat_settlement', 'manual', 'template', 'reversal', 'opening', 'closing', 'migrated', 'purchase_accrual', 'purchase_accrual_reversal'])) not valid;
alter table public.journal_entry validate constraint journal_entry_source_type_check;
