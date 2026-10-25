-- supabase/vuelta-atras/20261024T0836_v01_origen_factura_venta.down.sql
--
-- Vuelta atrás de la 0836: el CHECK de los orígenes de un asiento, como estaba
-- (sin 'customer_invoice').
--
-- FRENO: si ya hay algún asiento con origen 'customer_invoice', para sin tocar
-- nada (es de una factura emitida: ya está en el libro y quizá en Diez).

do $$
begin
  if exists (select 1 from public.journal_entry where source_type = 'customer_invoice') then
    raise exception 'Hay asientos con origen customer_invoice: la vuelta atrás de la 0836 no se hace.' using errcode = '23514';
  end if;
end $$;

alter table public.journal_entry drop constraint if exists journal_entry_source_type_check;
alter table public.journal_entry add constraint journal_entry_source_type_check check (source_type = any (array[
  'sales_day', 'sales_adjustment', 'supplier_invoice', 'supplier_payment', 'channel_settlement', 'licensed_settlement', 'payroll', 'bank',
  'vat_settlement', 'manual', 'template', 'reversal', 'opening', 'closing', 'migrated', 'purchase_accrual', 'purchase_accrual_reversal'])) not valid;
alter table public.journal_entry validate constraint journal_entry_source_type_check;
