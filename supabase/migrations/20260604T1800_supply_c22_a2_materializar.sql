-- ============================================================================
-- Folvy Supply C2.2.a-2 — materializar recepción desde OCR
-- ============================================================================
-- Añade a goods_receipt:
--   · delivered_by   — quién ENTREGA físicamente cuando difiere del proveedor
--     comercial (p.ej. Joan/Bidfood entregan EN NOMBRE DE Cloudtown). El
--     proveedor (supplier_id) es el COMERCIAL (a quien se paga / contra quien va
--     el coste); delivered_by es trazabilidad del transportista-depositario.
--   · ai_session_id  — enlaza la recepción con la lectura OCR que la originó
--     (goods_receipt_ai_session), para auditoría y para que el casado (b) sepa
--     de qué sesión vienen las líneas.
--
-- DDL idempotente, sin BEGIN/COMMIT. No ejecuta funciones SECURITY DEFINER.
-- ============================================================================

alter table public.goods_receipt
  add column if not exists delivered_by text;

alter table public.goods_receipt
  add column if not exists ai_session_id uuid
    references public.goods_receipt_ai_session(id) on delete set null;

create index if not exists idx_goods_receipt_ai_session
  on public.goods_receipt(ai_session_id);
