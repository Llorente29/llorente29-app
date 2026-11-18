-- supabase/vuelta-atras/20261118T1952_e04_las_que_esperan_se_pasan.down.sql
--
-- E04 · Vuelta atrás de la 1952: cada recibida pasada al aplicar vuelve a su
-- sociedad de antes (de conta_e04_respaldo), con su llegada, su actividad y su
-- apunte de «apunta sola», y se quita su apunte «Sumied · al aplicar el E04». Su
-- asiento propuesto, si lo tenía, se vuelve a proponer solo. Va la primera.
update public.supplier_invoice si
   set company_id = r.desde, location_id = r.location_id, vat_non_deductible = r.vat_non_deductible,
       vat_non_deductible_reason = r.vat_non_deductible_reason,
       journal_entry_id = case when exists (select 1 from public.journal_entry e where e.id = r.journal_entry_id) then r.journal_entry_id end
  from public.conta_e04_respaldo r
 where r.supplier_invoice_id = si.id and r.account_id = si.account_id;
update public.document_inbox d set company_id = r.desde from public.conta_e04_respaldo r where d.supplier_invoice_id = r.supplier_invoice_id and d.account_id = r.account_id;
update public.document_activity a set company_id = r.desde from public.conta_e04_respaldo r where a.supplier_invoice_id = r.supplier_invoice_id and a.account_id = r.account_id;
update public.supplier_invoice_auto u set company_id = r.desde from public.conta_e04_respaldo r where u.invoice_id = r.supplier_invoice_id and u.account_id = r.account_id;
delete from public.supplier_invoice_change h
 using public.conta_e04_respaldo r
 where h.supplier_invoice_id = r.supplier_invoice_id and h.account_id = r.account_id and h.by_name = 'Sumied'
   and h.cambios @> '[{"campo": "sociedad", "sola": true}]'::jsonb and h.cambios::text like '%al aplicar el E04%';
drop table if exists public.conta_e04_respaldo;
