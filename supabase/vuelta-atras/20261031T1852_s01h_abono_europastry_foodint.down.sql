-- supabase/vuelta-atras/20261031T1852_s01h_abono_europastry_foodint.down.sql
--
-- S01h · Vuelta atrás de la 1852: el abono 1506416 (FAC-00120) de Foodint como
-- se midió el 31/10 (cuotas 13,44 y 1,06 en positivo, IVA 14,50, total
-- −146,46, «efectivo» y sin ligar). Solo si su asiento no se ha validado: con
-- él validado, la compensación ya está hecha y no se deshace aquí.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_abono constant uuid := 'f9e2738d-675c-4502-a6e9-c6eb71081633';
begin
  if not exists (select 1 from public.supplier_invoice where id = v_abono and account_id = v_acc) then return; end if;
  if exists (select 1 from public.journal_entry where account_id = v_acc and source_type = 'supplier_invoice' and source_id = v_abono and status = 'validado') then
    raise exception 'S01h 1852 (vuelta atrás): el asiento del abono ya está validado; no se deshace aquí.';
  end if;
  update public.supplier_invoice_tax set vat_amount = abs(vat_amount) where supplier_invoice_id = v_abono and vat_amount < 0;
  update public.supplier_invoice
     set tax_total = 14.50, grand_total = -146.46, payment_method = 'cash',
         reading = jsonb_set(jsonb_set(jsonb_set(reading, '{factura,cuota}', '14.5'), '{factura,forma}', '"cash"'),
                             '{factura,tipos}', (select jsonb_agg(t || jsonb_build_object('cuota', abs((t->>'cuota')::numeric))) from jsonb_array_elements(reading->'factura'->'tipos') t)),
         updated_at = now()
   where id = v_abono and account_id = v_acc;
  -- Aparte: el disparador de la 1851 (que se quita después) liga al tocar «reading».
  update public.supplier_invoice set corrects_invoice_id = null where id = v_abono and account_id = v_acc;
end $$;
