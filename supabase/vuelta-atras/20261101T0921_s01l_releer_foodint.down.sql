-- supabase/vuelta-atras/20261101T0921_s01l_releer_foodint.down.sql
-- S01l · Vuelta atrás de la 0921: la factura que creó (si sigue «Por revisar»,
-- sin asiento ni pago) se quita y su llegada vuelve a «recibido», como estaba.
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_inbox constant uuid := '55541602-d1bc-4fc4-97da-041a1822c205';
  v_fac uuid;
begin
  select supplier_invoice_id into v_fac from public.document_inbox where id = v_inbox and account_id = v_acc;
  if v_fac is null then return; end if;
  if exists (select 1 from public.supplier_invoice where id = v_fac and (status <> 'en_revision' or created_by_name <> 'Folvy'))
     or exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = v_fac)
     or exists (select 1 from public.supplier_invoice_payment p where p.invoice_id = v_fac) then
    raise notice 'S01l 0921 (vuelta atrás): la factura ya se ha tocado; se queda.';
    return;
  end if;
  update public.document_inbox set status = 'recibido', ai_session_id = null, supplier_invoice_id = null, reason = null, updated_at = now() where id = v_inbox;
  delete from public.document_activity where inbox_id = v_inbox and supplier_invoice_id = v_fac and actor = 'folvy';
  delete from public.supplier_invoice_line where supplier_invoice_id = v_fac;
  delete from public.supplier_invoice_tax where supplier_invoice_id = v_fac;
  delete from public.supplier_invoice where id = v_fac;
end $$;
