-- supabase/migrations/20260603T1400_sale_tax_capture.sql
--
-- Captura del desglose fiscal del pedido (Last.app bill.tax / bill.taxableBase).
--
-- Contexto: el webhook de Last.app envía en cada bill el IVA (tax) y la base
--   imponible (taxableBase), pero hasta ahora no se guardaban. Se necesitan
--   para calcular la base de comisión con/sin IVA de forma exacta (no estimada)
--   y para el desglose fiscal del motor de margen.
--
-- Importes en euros (el Edge Function divide los céntimos de Last entre 100,
--   igual que total / delivery_cost / discount_amount).
--
-- Columnas nullable: los pedidos antiguos (backfill de Excel y webhook con la
--   versión vieja del function) las tendrán en null; son recuperables
--   reprocesando desde lastapp_webhook_log con el function nuevo. No bloquea nada.
--
-- Aplicada: 2026-06-03 (SQL Editor, producción)

BEGIN;

ALTER TABLE public.sale ADD COLUMN IF NOT EXISTS tax          numeric;
ALTER TABLE public.sale ADD COLUMN IF NOT EXISTS taxable_base numeric;

COMMENT ON COLUMN public.sale.tax          IS 'IVA del pedido en euros (Last.app bill.tax/100). Base de comisión y desglose fiscal.';
COMMENT ON COLUMN public.sale.taxable_base IS 'Base imponible del pedido en euros (Last.app bill.taxableBase/100).';

COMMIT;
