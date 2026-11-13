-- supabase/migrations/20261113T0950_dl1_borrar_factura_410.sql
--
-- DL1 · Borrar del todo una factura subida por error (Julio, 13/11). La
-- FAC-00410 (id 62dbf6d8-2a9a-4a3d-b0ff-2f7a091fb402) no es de Llorente29: se
-- subió el 13/11 a las 09:34, está en revisión, sin asiento, sin pago y sin
-- proveedor. Nunca llegó a los libros: se borra sin dejar rastro. Aquí solo van
-- sus ids (T11): ni el nombre ni el NIF de la persona a la que va.
--
-- Lo que se borra, todo con su id:
--   · la factura y sus hijas (2 líneas, su IVA y su fila de «apuntar sola»);
--   · su fila de la bandeja (document_inbox 4854c7b0-188a-4283-9b17-ef21591a62b3)
--     y su actividad (3 filas);
--   · la sesión de lectura de la IA (goods_receipt_ai_session
--     5ea71419-1a88-4913-b552-ffba5f7226ee), que guarda lo leído del PDF.
-- Antes, comprueba que no la nombra nada más (asiento, pago, banco, lote,
-- remesa, declaración, liquidación, recepción, otra factura) y, si no, para.
--
-- El PDF (receipt-uploads, …/6a08de08-8e98-42a9-8898-a820bd9c1694/
-- 00-DescargarPDF.pdf, el mismo fichero para la factura y la bandeja) no se
-- puede borrar desde SQL: storage.objects tiene protect_objects_delete, y solo
-- lo borra la API del almacén. Va en el informe, con cómo.
--
-- SIN VUELTA ATRÁS, a propósito: es lo que se pide, que no quede nada.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_f constant uuid := '62dbf6d8-2a9a-4a3d-b0ff-2f7a091fb402';
  v_b constant uuid := '4854c7b0-188a-4283-9b17-ef21591a62b3';
  v_ia constant uuid := '5ea71419-1a88-4913-b552-ffba5f7226ee';
  v_mal text;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 borrar factura: sin la cuenta de Foodint, no hay nada que borrar.';
    return;
  end if;
  select string_agg(m, ' ') into v_mal from (
    select 'La factura no está como se midió (en revisión, sin asiento, sin pago, sin proveedor, de la bandeja y la sesión medidas).' m
     where not exists (select 1 from public.supplier_invoice where id = v_f and account_id = v_acc and code = 'FAC-00410' and status = 'en_revision'
                        and journal_entry_id is null and payment_entry_id is null and supplier_id is null and paid_at is null and batch_id is null
                        and corrects_invoice_id is null and inbox_id = v_b and ai_session_id = v_ia)
    union all select 'La bandeja no es solo de esta factura.'
     where not exists (select 1 from public.document_inbox where id = v_b and account_id = v_acc and supplier_invoice_id = v_f
                        and duplicate_of_invoice_id is null and ai_session_id = v_ia)
    union all select 'Tiene pagos.' where exists (select 1 from public.supplier_invoice_payment where invoice_id = v_f)
       or exists (select 1 from public.supplier_invoice_payment_log where invoice_id = v_f)
    union all select 'Está casada en el banco.' where exists (select 1 from public.bank_match_item where supplier_invoice_id = v_f)
       or exists (select 1 from public.bank_movement where proposal::text like '%' || v_f::text || '%')
    union all select 'Está en una remesa o una salida de pago.' where exists (select 1 from public.conta_pago_remesa_linea where invoice_id = v_f)
       or exists (select 1 from public.conta_pago_salida where invoice_id = v_f)
    union all select 'Tiene un asiento o un descarte.' where exists (select 1 from public.journal_entry where source_id = v_f)
       or exists (select 1 from public.journal_dismissal where source_key = v_f::text)
    union all select 'Está en una declaración.' where exists (select 1 from public.tax_return_line where supplier_invoice_id = v_f)
    union all select 'La nombra una liquidación.' where exists (select 1 from public.channel_settlement where commission_invoice_id = v_f)
       or exists (select 1 from public.channel_settlement_invoice where supplier_invoice_id = v_f)
       or exists (select 1 from public.licensed_settlement where received_invoice_id = v_f)
    union all select 'La nombra una recepción, un lote u otra factura.' where exists (select 1 from public.goods_receipt_path where supplier_invoice_id = v_f)
       or exists (select 1 from public.supplier_batch_issue where supplier_invoice_id = v_f) or exists (select 1 from public.supplier_batch_order where supplier_invoice_id = v_f)
       or exists (select 1 from public.supplier_invoice where corrects_invoice_id = v_f)
       or exists (select 1 from public.supplier_invoice_receipt where supplier_invoice_id = v_f) or exists (select 1 from public.supplier_invoice_expense where supplier_invoice_id = v_f)
       or exists (select 1 from public.supplier_invoice_change where supplier_invoice_id = v_f) or exists (select 1 from public.conta_recibida_pdf where invoice_id = v_f)
    union all select 'Otra bandeja la nombra.' where exists (select 1 from public.document_inbox where id <> v_b and (supplier_invoice_id = v_f or duplicate_of_invoice_id = v_f))
    union all select 'La sesión de la IA la usa algo más.' where exists (select 1 from public.goods_receipt where ai_session_id = v_ia)
       or exists (select 1 from public.supplier_invoice where ai_session_id = v_ia and id <> v_f) or exists (select 1 from public.document_inbox where ai_session_id = v_ia and id <> v_b)
       or exists (select 1 from public.goods_receipt_ai_session where id = v_ia and goods_receipt_id is not null)
  ) z;
  if v_mal is not null then raise exception 'DL1 borrar factura: no se borra nada. %', v_mal; end if;

  delete from public.document_activity where supplier_invoice_id = v_f or inbox_id = v_b;
  update public.document_inbox set supplier_invoice_id = null where id = v_b;
  delete from public.supplier_invoice where id = v_f;      -- sus líneas, su IVA y su «apuntar sola», en cascada
  delete from public.document_inbox where id = v_b;
  delete from public.goods_receipt_ai_session where id = v_ia;

  if exists (select 1 from public.supplier_invoice where id = v_f) or exists (select 1 from public.document_inbox where id = v_b)
     or exists (select 1 from public.supplier_invoice_line where supplier_invoice_id = v_f) or exists (select 1 from public.supplier_invoice_tax where supplier_invoice_id = v_f)
     or exists (select 1 from public.supplier_invoice_auto where invoice_id = v_f) or exists (select 1 from public.document_activity where supplier_invoice_id = v_f or inbox_id = v_b)
     or exists (select 1 from public.goods_receipt_ai_session where id = v_ia) then
    raise exception 'DL1 borrar factura: después de borrar queda alguna fila con su id.';
  end if;
  raise notice 'DL1 borrar factura: la FAC-00410, su bandeja, su actividad y su lectura, borradas. Queda su PDF en el almacén (ver el informe).';
end $$;
