-- supabase/migrations/20261031T1852_s01h_abono_europastry_foodint.sql
--
-- S01h · Datos de Foodint (decisión de Julio, 31/10: «el 1506416, ya guardado,
-- se corrige en la tanda del S01h con su autorizo»). El abono 1506416 de
-- Europastry (FAC-00120, 13/10) entró antes de que Sumied supiera de abonos:
-- las bases en negativo pero las cuotas en positivo, el total −146,46 en vez
-- de −175,46, sin ligar a lo que anula y con «efectivo» como forma de pago.
--
-- Queda así: cuotas −13,44 (10 %) y −1,06 (4 %), IVA −14,50, total −175,46,
-- sin forma de pago, con las comprobaciones que da el lector nuevo para esas
-- cifras («Cuadra: bases + IVA = total, al céntimo.», en vez de «sobran
-- 29,00 €» y los dos «debería ser»), y ligado a la FAC-00006 (el albarán-factura 24056558, que
-- anula entero; lo sustituye la 24056932, FAC-00121). Sin asiento todavía: al
-- validarlo, la 1851 compensa la FAC-00006 y las dos quedan pagadas.
--
-- Guarda: sin la cuenta de Foodint (staging, la base local) no hace nada; y si
-- el abono ya no está como se midió el 31/10, para sin tocar nada.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_abono constant uuid := 'f9e2738d-675c-4502-a6e9-c6eb71081633';
  v_fac constant uuid := '0d18e0ea-04fe-4ceb-9890-1d1ce122b532';
  a public.supplier_invoice; v_n integer;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01h 1852: sin la cuenta de Foodint, no hay nada que arreglar.';
    return;
  end if;
  select * into a from public.supplier_invoice where id = v_abono and account_id = v_acc for update;
  if a.id is null or a.doc_kind <> 'credit_note' or a.grand_total <> -146.46 or a.tax_total <> 14.50 or a.corrects_invoice_id is not null
     or a.status <> 'aprobada' or exists (select 1 from public.journal_entry j where j.account_id = v_acc and j.source_type = 'supplier_invoice' and j.source_id = v_abono and j.status <> 'anulado') then
    raise exception 'S01h 1852: el abono FAC-00120 ya no está como se midió el 31/10 (total %, IVA %, ligado a %, estado %). No se toca.',
      a.grand_total, a.tax_total, a.corrects_invoice_id, a.status;
  end if;
  if not exists (select 1 from public.supplier_invoice where id = v_fac and account_id = v_acc and supplier_id = a.supplier_id and number_key = '24056558' and status = 'aprobada') then
    raise exception 'S01h 1852: la FAC-00006 (24056558) ya no está sin pagar. No se toca.';
  end if;
  update public.supplier_invoice_tax set vat_amount = -abs(vat_amount)
   where supplier_invoice_id = v_abono and vat_amount > 0;
  get diagnostics v_n = row_count;
  if v_n <> 2 then raise exception 'S01h 1852: esperaba 2 cuotas que cambiar de signo y hay %.', v_n; end if;
  update public.supplier_invoice
     set tax_total = -14.50, grand_total = -175.46, payment_method = null, corrects_invoice_id = v_fac, reading_confidence = 'seguro',
         reading = jsonb_set(jsonb_set(jsonb_set(reading, '{factura,cuota}', '-14.5'), '{factura,forma}', 'null'),
                             '{factura,tipos}', (select jsonb_agg(t || jsonb_build_object('cuota', -abs((t->>'cuota')::numeric))) from jsonb_array_elements(reading->'factura'->'tipos') t))
                   || jsonb_build_object('confianza', 'seguro', 'porque', jsonb_build_array('Todo cuadra y trae lo que pide la norma.'),
                        'comprobaciones', jsonb_build_array(jsonb_build_object('id', 'suma', 'ok', true, 'grave', true, 'texto', 'Cuadra: bases + IVA = total, al céntimo.'))),
         updated_at = now()
   where id = v_abono;
  if (select sum(base) + sum(vat_amount) from public.supplier_invoice_tax where supplier_invoice_id = v_abono) <> -175.46 then
    raise exception 'S01h 1852: base + IVA del abono no da −175,46.';
  end if;
  raise notice 'S01h 1852: el abono 1506416 queda con IVA −14,50, total −175,46 y ligado a la FAC-00006.';
end $$;
