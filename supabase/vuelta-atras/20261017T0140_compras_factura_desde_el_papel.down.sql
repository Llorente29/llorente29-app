-- ============================================================================
-- Vuelta atrás de Compras · 5 · la factura sale del papel; la aprobación, en la base.
-- PARA si alguna factura creada desde el papel ya tiene asiento: eso se
-- deshace antes en el libro. Si no, anula (no borra) las facturas que creó
-- (las del rastro de goods_receipt_path con supplier_invoice_id y nacidas
-- «en_revision» de un papel), devuelve las filas del camino a sin consumir,
-- quita los dos disparadores, las funciones y las dos columnas, y deja el
-- CHECK de preguntas como lo dejó la 0120.
-- ============================================================================
do $$
begin
  if exists (select 1 from public.supplier_invoice si join public.goods_receipt_path p on p.supplier_invoice_id = si.id
              where si.journal_entry_id is not null) then
    raise exception 'Hay facturas creadas desde el papel que ya tienen asiento: deshazlo antes en el libro.';
  end if;
end $$;

update public.supplier_invoice si set status = 'anulada', notes = coalesce(si.notes || ' ', '') || 'Anulada por la vuelta atrás de 20261017T0140.'
 where si.id in (select p.supplier_invoice_id from public.goods_receipt_path p where p.supplier_invoice_id is not null and p.question is distinct from 'factura_repetida')
   and si.source = 'ocr' and si.status in ('en_revision', 'aprobada');
update public.goods_receipt_path set consumed_at = null where supplier_invoice_id is not null;

drop trigger if exists trg_supplier_invoice_aprobacion on public.supplier_invoice;
drop function if exists public.supplier_invoice_aprobacion();
drop trigger if exists trg_goods_receipt_path_factura on public.goods_receipt_path;
drop function if exists public.tg_goods_receipt_path_factura();
drop function if exists public.compras_factura_desde_papel(uuid, uuid, uuid, uuid);
drop function if exists public._compras_factura_desde_papel(uuid, uuid, uuid, uuid, uuid, uuid, text);
drop function if exists public.compras_euros(numeric);

update public.goods_receipt_path set question = null, question_detail = null
 where question in ('factura_sin_importes', 'factura_repetida');
alter table public.goods_receipt_path drop constraint if exists goods_receipt_path_question_check;
alter table public.goods_receipt_path add constraint goods_receipt_path_question_check
  check (question in ('a_nombre_de', 'papel_y_ficha', 'ficha_sin_forma', 'sin_papel', 'a_nombre_de_otro', 'error'));
alter table public.goods_receipt_path drop column if exists supplier_invoice_id;
drop index if exists public.supplier_invoice_empresa;
alter table public.supplier_invoice drop column if exists company_id;
