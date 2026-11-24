-- supabase/vuelta-atras/20261118T1836_e03_lo_marcado_vuelve_a_pregunta.down.sql
--
-- E03 · Vuelta atrás de la 1836: cada recibida tocada vuelve a como estaba (de
-- conta_e03_respaldo), y su apunte «Sumied (E03)» se quita. Va ANTES que la
-- vuelta atrás de la 1833, que quita las columnas de la respuesta.
update public.supplier_invoice si
   set vat_non_deductible = r.vat_non_deductible, vat_non_deductible_reason = r.vat_non_deductible_reason,
       recipient_answer = r.recipient_answer, recipient_answered_at = r.recipient_answered_at,
       recipient_answered_by_name = r.recipient_answered_by_name
  from public.conta_e03_respaldo r
 where r.supplier_invoice_id = si.id and r.account_id = si.account_id;
delete from public.supplier_invoice_change h
 where h.by_name = 'Sumied (E03)' and h.cambios @> '[{"campo": "de_quien_es"}]'::jsonb
   and h.supplier_invoice_id in (select supplier_invoice_id from public.conta_e03_respaldo where que = 'vuelve_a_pregunta');
drop table if exists public.conta_e03_respaldo;
