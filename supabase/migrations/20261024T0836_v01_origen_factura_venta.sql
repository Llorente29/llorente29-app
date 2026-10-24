-- supabase/migrations/20261024T0836_v01_origen_factura_venta.sql
--
-- V01 · Entrega 1 · Ventas › Facturas: un origen más para los asientos, la
-- factura de venta ('customer_invoice'), que pone conta_venta_emitir (0835).
-- Solo amplía el CHECK: todo lo que valía sigue valiendo. Se pone NOT VALID y
-- se valida después (sin cierre exclusivo largo sobre journal_entry).
--
-- Va aparte de la 0835 porque es lo único que CAMBIA algo que ya existe: la
-- 0835 solo añade y entra de verdad en staging desde la rama; esta, solo en el
-- ensayo, hasta que esté en producción y se fusione.
--
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261024_v01_facturas_venta_prueba.sql
--
-- Vuelta atrás: supabase/vuelta-atras/20261024T0836_v01_origen_factura_venta.down.sql

alter table public.journal_entry drop constraint if exists journal_entry_source_type_check;
alter table public.journal_entry add constraint journal_entry_source_type_check check (source_type = any (array[
  'sales_day', 'sales_adjustment', 'supplier_invoice', 'supplier_payment', 'channel_settlement', 'licensed_settlement', 'payroll', 'bank',
  'vat_settlement', 'manual', 'template', 'reversal', 'opening', 'closing', 'migrated', 'purchase_accrual', 'purchase_accrual_reversal',
  'customer_invoice'])) not valid;
alter table public.journal_entry validate constraint journal_entry_source_type_check;

