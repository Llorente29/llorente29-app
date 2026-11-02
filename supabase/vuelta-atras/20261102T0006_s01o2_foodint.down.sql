-- supabase/vuelta-atras/20261102T0006_s01o2_foodint.down.sql
--
-- Vuelta atrás de la 0911: cada fila que tocó, como estaba (lo guardó en s01o2_foodint_antes).
update public.company_tax_profile p set en_roi = (a.datos->>'en_roi')::boolean, updated_at = now()
  from public.s01o2_foodint_antes a where a.tabla = 'company_tax_profile' and a.fila = p.company_id;
update public.supplier s set tax_id = a.datos->>'tax_id', updated_at = now()
  from public.s01o2_foodint_antes a where a.tabla = 'supplier' and a.fila = s.id;
delete from public.company_account_link k using public.s01o2_foodint_antes a where a.tabla = 'company_account_link' and a.fila = k.id;
delete from public.document_activity da where (da.detail->>'s01o2')::boolean and da.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';
update public.document_inbox d set status = a.datos->>'status', duplicate_of_invoice_id = nullif(a.datos->>'duplicate_of_invoice_id', '')::uuid,
       reason = a.datos->>'reason', updated_at = now()
  from public.s01o2_foodint_antes a where a.tabla = 'document_inbox' and a.fila = d.id;
-- Las dos de cada par vuelven a estar sin proveedor: la guarda de repetidas (2210) las pararía; se aparta solo para esto.
alter table public.supplier_invoice disable trigger trg_supplier_invoice_no_repetida;
update public.supplier_invoice si set supplier_id = nullif(a.datos->>'supplier_id', '')::uuid, status = a.datos->>'status',
       status_before_discard = a.datos->>'status_before_discard', discarded_at = nullif(a.datos->>'discarded_at', '')::timestamptz,
       discarded_by_name = a.datos->>'discarded_by_name', discard_reason = a.datos->>'discard_reason', reading_confidence = a.datos->>'reading_confidence',
       vat_non_deductible = (a.datos->>'vat_non_deductible')::boolean, vat_non_deductible_reason = a.datos->>'vat_non_deductible_reason', updated_at = now()
  from public.s01o2_foodint_antes a where a.tabla = 'supplier_invoice' and a.fila = si.id;
alter table public.supplier_invoice enable trigger trg_supplier_invoice_no_repetida;
drop table if exists public.s01o2_foodint_antes;
