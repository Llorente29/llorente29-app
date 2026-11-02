-- scripts/conta/produccion/cuentas/s01q-guarda.sql
--
-- S01q · La guarda · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La misma vara a los dos lados (regla 31). La tanda no mueve filas: las tres
-- primeras no cambian con el real; la cuarta crece cuando pasen las pasadas.
--   1. La de la sesión principal: apuntadas solas con su número en el concepto de
--      un asiento traído de Diez (medido el 02/11: 129).
--   2. La mejorada: además su proveedor (su subcuenta) por el total, en su lado (123).
--   3. Su importe (9.584,37 €).
--   4. Facturas marcadas «ya contabilizada» por la guarda (0 antes del real).
select clave, valor from (
  select 1 o, 'Apuntadas solas con su número en un asiento de Diez' clave,
    (select count(distinct a.invoice_id)::text from public.supplier_invoice_auto a join public.supplier_invoice si on si.id = a.invoice_id
      join public.journal_entry e on e.company_id = si.company_id and e.source_type = 'migrated' and e.status = 'validado'
      where a.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and a.estado = 'apuntada' and a.at < timestamptz '2026-11-02 12:00+00'
        and length(upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g'))) >= 4
        and upper(regexp_replace(e.concept, '[^A-Za-z0-9]', '', 'g')) like '%' || upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g')) || '%') valor union all
  select 2, 'Las mismas, con su proveedor por el total',
    (select count(distinct a.invoice_id)::text from public.supplier_invoice_auto a join public.supplier_invoice si on si.id = a.invoice_id
      join public.journal_entry e on e.company_id = si.company_id and e.source_type = 'migrated' and e.status = 'validado'
      where a.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and a.estado = 'apuntada' and a.at < timestamptz '2026-11-02 12:00+00'
        and length(upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g'))) >= 4
        and upper(regexp_replace(e.concept, '[^A-Za-z0-9]', '', 'g')) like '%' || upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g')) || '%'
        and exists (select 1 from public.journal_line l join public.company_account_link k on k.company_account_id = l.company_account_id
                     and k.entity = 'supplier' and k.entity_id = si.supplier_id::text and k.role = 'principal'
                     where l.entry_id = e.id and (case when si.grand_total >= 0 then l.credit - l.debit else l.debit - l.credit end) = abs(si.grand_total))) union all
  select 3, 'Su importe',
    (select coalesce(sum(si.grand_total), 0)::text from public.supplier_invoice si
      where si.id in (select a.invoice_id from public.supplier_invoice_auto a join public.supplier_invoice s2 on s2.id = a.invoice_id
                       join public.journal_entry e on e.company_id = s2.company_id and e.source_type = 'migrated' and e.status = 'validado'
                      where a.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and a.estado = 'apuntada' and a.at < timestamptz '2026-11-02 12:00+00'
                        and length(upper(regexp_replace(s2.invoice_number, '[^A-Za-z0-9]', '', 'g'))) >= 4
                        and upper(regexp_replace(e.concept, '[^A-Za-z0-9]', '', 'g')) like '%' || upper(regexp_replace(s2.invoice_number, '[^A-Za-z0-9]', '', 'g')) || '%'
                        and exists (select 1 from public.journal_line l join public.company_account_link k on k.company_account_id = l.company_account_id
                                     and k.entity = 'supplier' and k.entity_id = s2.supplier_id::text and k.role = 'principal'
                                     where l.entry_id = e.id and (case when s2.grand_total >= 0 then l.credit - l.debit else l.debit - l.credit end) = abs(s2.grand_total)))) union all
  select 4, 'Marcadas «ya contabilizada»',
    (select count(*)::text from public.supplier_invoice_auto a
      -- quieta: solo la guarda escribe este estado, y no existe hasta el real
      where a.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and to_jsonb(a)->>'estado' = 'ya_contabilizada')
) q order by o;
