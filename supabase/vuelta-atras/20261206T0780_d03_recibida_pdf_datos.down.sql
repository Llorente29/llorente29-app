-- supabase/vuelta-atras/20261206T0780_d03_recibida_pdf_datos.down.sql
--
-- Vuelta atrás de 20261206T0780_d03_recibida_pdf_datos (solo Foodint):
-- FAC-00098 y FAC-00101 otra vez sin documento (raw_document_url nulo), como
-- estaban; la 0780 no tocó nada más. Solo las que tienen JUSTO el fichero de
-- su lectura: si alguna tiene otro, no es lo que puso la 0780 y no se toca.
--
-- PARA, sin cambiar nada, si alguna ya se ha usado con ese documento: tiene
-- asiento (validado o no: «Apuntar» o el libro pueden haber guardado ya el
-- PDF en el asiento y Diez puede haberlo recibido), o el D02 ya ha hecho o
-- enlazado algo con ella (conta_recibida_pdf). Quitarle el documento entonces
-- dejaría a medias lo que ya se hizo con él.
--
-- sin prueba con datos: solo actúa sobre Foodint (cuenta 51ad1792…), que no
-- está en staging; la prueba de la 0770 la ejecuta igual (y la 0780) para ver
-- que se leen y que, sin Foodint, no tocan nada. Su prueba con datos es el
-- ENSAYO de la tanda en producción (todo en una transacción y rollback).
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_fac constant uuid[] := array['9a87fa22-fbc7-471b-bf1d-a88c856259ea', 'd6913598-9f52-4d43-8860-eddff2a6d436']::uuid[];
  v_lec constant uuid[] := array['92c53abd-d369-40e2-9beb-9a05adf5c80c', 'd155b941-2c47-4f1f-bca9-067129cfcd77']::uuid[];
  v_suyas int;
  v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'D03 0780 (vuelta atrás): esta base no tiene la cuenta de Foodint (staging): nada que deshacer.';
    return;
  end if;

  if exists (select 1 from public.supplier_invoice i
              where i.account_id = v_acc and i.id = any (v_fac)
                and (i.journal_entry_id is not null
                     or exists (select 1 from public.journal_entry e
                                 where e.account_id = v_acc and e.source_type = 'supplier_invoice' and e.source_id = i.id)
                     or exists (select 1 from public.conta_recibida_pdf r where r.invoice_id = i.id))) then
    raise exception 'D03 0780 (vuelta atrás): FAC-00098 o FAC-00101 ya tiene asiento o el D02 ya ha hecho algo con su documento: no se le quita. Míralo antes.';
  end if;

  select count(*) into v_suyas
    from public.supplier_invoice i
    join unnest(v_fac, v_lec) as m(fac, lec) on m.fac = i.id
    join public.goods_receipt_ai_session a on a.id = m.lec and a.account_id = v_acc
   where i.account_id = v_acc and i.ai_session_id = m.lec and i.raw_document_url = a.input_files -> 0 ->> 'path';

  update public.supplier_invoice i
     set raw_document_url = null
    from unnest(v_fac, v_lec) as m(fac, lec), public.goods_receipt_ai_session a
   where i.id = m.fac and i.account_id = v_acc and i.ai_session_id = m.lec
     and a.id = m.lec and a.account_id = v_acc and i.raw_document_url = a.input_files -> 0 ->> 'path';
  get diagnostics v_n = row_count;
  if v_n <> v_suyas then
    raise exception 'D03 0780 (vuelta atrás): esperaba quitar % documento(s) y han sido %.', v_suyas, v_n;
  end if;
  raise notice 'D03 0780 (vuelta atrás): % recibida(s) de Foodint otra vez sin documento.', v_n;
end $$;
