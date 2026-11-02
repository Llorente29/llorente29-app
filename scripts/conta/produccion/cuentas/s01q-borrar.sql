-- scripts/conta/produccion/cuentas/s01q-borrar.sql
--
-- S01q · Borrar duplicados · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La misma vara a los dos lados (regla 31). Medido antes (02/11, 17:45Z): 123 · 9.584,37 ·
-- 3.013,14 · «3443 · 3122» · 15.515; la cadena, 15.515 de 15.515 bien. Lo que tiene que pasar en Foodint:
--   1 y 2. Asientos de la lista (apuntados solos y ya en Diez): 123 y 9.584,37 € → 0 y 0.
--   3. IVA soportado del 4T: 1.663,42 € menos (de 3.013,14 a 1.349,72).
--   4. Serie 2 de 2026: «3443 · 3122» → «3320 · 2999» (seguida, sin huecos).
--   5. Asientos con huella: 15.515 → 15.392. (La cadena la comprueban la tanda y el parte.)
select clave, valor from (
  select 1 o, 'Asientos de la lista (apuntados solos y ya en Diez)' clave,
    (select count(distinct a.entry_id)::text from public.supplier_invoice_auto a join public.supplier_invoice si on si.id = a.invoice_id
       join public.journal_entry s on s.id = a.entry_id and s.status = 'validado'
      where a.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and a.estado = 'apuntada' and a.at < timestamptz '2026-11-02 12:00+00'
        and length(upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g'))) >= 4
        and exists (select 1 from public.journal_entry e where e.company_id = si.company_id and e.source_type = 'migrated' and e.status = 'validado'
                      and upper(regexp_replace(e.concept, '[^A-Za-z0-9]', '', 'g')) like '%' || upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g')) || '%'
                      and exists (select 1 from public.journal_line l join public.company_account_link k on k.company_account_id = l.company_account_id
                                   and k.entity = 'supplier' and k.entity_id = si.supplier_id::text and k.role = 'principal'
                                   where l.entry_id = e.id and (case when si.grand_total >= 0 then l.credit - l.debit else l.debit - l.credit end) = abs(si.grand_total)))) valor union all
  select 2, 'Su importe',
    (select coalesce(sum(si.grand_total), 0)::text from public.supplier_invoice_auto a join public.supplier_invoice si on si.id = a.invoice_id
       join public.journal_entry s on s.id = a.entry_id and s.status = 'validado'
      where a.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and a.estado = 'apuntada' and a.at < timestamptz '2026-11-02 12:00+00'
        and length(upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g'))) >= 4
        and exists (select 1 from public.journal_entry e where e.company_id = si.company_id and e.source_type = 'migrated' and e.status = 'validado'
                      and upper(regexp_replace(e.concept, '[^A-Za-z0-9]', '', 'g')) like '%' || upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g')) || '%'
                      and exists (select 1 from public.journal_line l join public.company_account_link k on k.company_account_id = l.company_account_id
                                   and k.entity = 'supplier' and k.entity_id = si.supplier_id::text and k.role = 'principal'
                                   where l.entry_id = e.id and (case when si.grand_total >= 0 then l.credit - l.debit else l.debit - l.credit end) = abs(si.grand_total)))) union all
  select 3, 'IVA soportado del 4T',
    (select coalesce(sum(v.tax_amount), 0)::text from public.vat_book_entry v
      where v.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and v.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and v.book = 'received' and v.voided_at is null
        and v.created_at < timestamptz '2026-11-02 12:00+00'
        and public._conta_iva_dia_del_libro(v.book, v.deduction_year, v.deduction_period, v.received_date, v.issue_date, v.operation_date) between date '2026-10-01' and date '2026-12-31') union all
  select 4, 'Serie 2 de 2026: último número y cuántos',
    (select max(e.number)::text || ' · ' || count(*)::text from public.journal_entry e join public.fiscal_year y on y.id = e.fiscal_year_id
      -- quieta: la serie 2 crece con lo que se valida; se mide lo validado antes del corte de la medida
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and y.code = '2026' and e.series = 2
        and e.number is not null and e.validated_at < timestamptz '2026-11-02 12:00+00') union all
  select 5, 'Asientos con huella',
    (select count(*)::text from public.journal_entry e
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.chain_seq is not null
        and e.validated_at < timestamptz '2026-11-02 12:00+00')
) q order by o;
