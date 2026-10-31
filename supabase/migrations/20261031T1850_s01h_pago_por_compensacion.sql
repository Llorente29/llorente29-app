-- supabase/migrations/20261031T1850_s01h_pago_por_compensacion.sql
--
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261031_s01h_abonos_prueba.sql
--
-- S01h · Una forma de pago más para una factura recibida: «compensation», la
-- que queda pagada porque un abono del mismo proveedor la compensa (sin
-- movimiento de banco). Solo AMPLÍA el CHECK de paid_method: las cinco de
-- antes siguen valiendo. supplier_invoice no está en el camino del pedido.

alter table public.supplier_invoice
  drop constraint supplier_invoice_paid_method_check,
  add constraint supplier_invoice_paid_method_check check (
    paid_method is null or paid_method = any (array['transfer', 'direct_debit', 'card', 'cash', 'prepaid', 'compensation']::text[]));
