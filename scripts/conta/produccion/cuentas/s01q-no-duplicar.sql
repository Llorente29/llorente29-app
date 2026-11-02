-- scripts/conta/produccion/cuentas/s01q-no-duplicar.sql
--
-- S01q·7 · Borrar 2/3272 y 2/3273 y las reglas 1 a 4 · LO QUE CUENTA LA TANDA,
-- antes y después. SOLO LEE. La misma vara a los dos lados (regla 31). Medido
-- antes (02/11, 19:15Z; se cuenta lo de antes de las 19:10Z). Lo que tiene que pasar en Foodint:
--   1. Asientos 2/3272 y 2/3273 (los de Vercel y Supabase del 29/10): 2 → 0.
--   2. Sus facturas enlazadas a su asiento de Diez («Ya contabilizada en Diez»): 0 → 2.
--   3. IVA soportado del 4T: 10,57 € menos (de 1.349,72 a 1.339,15).
--   4. Serie 2 de 2026: «3320 · 2999» → «3318 · 2997» (seguida, sin huecos).
--   5. Asientos con huella: 15.392 → 15.390. (La cadena la comprueban la tanda y el parte.)
--   6. Facturas recibidas que ya están en otro asiento vivo (la regla 1): 2 → 0.
select clave, valor from (
  select 1 o, 'Asientos 2/3272 y 2/3273 (Vercel y Supabase, 29/10)' clave,
    (select count(*)::text from public.journal_entry e
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and e.id in ('a17eba5a-56e1-4b0d-a724-c1eab988bfe6', '0f8ebdb5-0000-4e28-807d-e685e5890209')) valor union all
  select 2, 'Sus facturas, enlazadas a su asiento de Diez',
    (select count(*)::text from public.supplier_invoice si join public.journal_entry e on e.id = si.journal_entry_id and e.source_type = 'migrated'
      where si.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and si.id in ('403825dd-d8db-4ff5-a5cf-2115732fa89b', '7eddb982-81ef-444c-8d88-1e68d5d7c34f')) union all
  select 3, 'IVA soportado del 4T',
    (select coalesce(sum(v.tax_amount), 0)::text from public.vat_book_entry v
      where v.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and v.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and v.book = 'received' and v.voided_at is null
        and v.created_at < timestamptz '2026-11-02 19:10+00'
        and public._conta_iva_dia_del_libro(v.book, v.deduction_year, v.deduction_period, v.received_date, v.issue_date, v.operation_date) between date '2026-10-01' and date '2026-12-31') union all
  select 4, 'Serie 2 de 2026: último número y cuántos',
    (select max(e.number)::text || ' · ' || count(*)::text from public.journal_entry e join public.fiscal_year y on y.id = e.fiscal_year_id
      -- quieta: la serie 2 crece con lo que se valida; se mide lo validado antes del corte de la medida
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and y.code = '2026' and e.series = 2
        and e.number is not null and e.validated_at < timestamptz '2026-11-02 19:10+00') union all
  select 5, 'Asientos con huella',
    (select count(*)::text from public.journal_entry e
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.chain_seq is not null
        and e.validated_at < timestamptz '2026-11-02 19:10+00') union all
  select 6, 'Facturas recibidas con su número y su proveedor en otro asiento vivo de Diez',
    -- quieta: las de Foodint con asiento propio hasta el corte de la medida
    (select count(*)::text from public.journal_entry s join public.supplier_invoice si on si.id = s.source_id
      where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and s.source_type = 'supplier_invoice' and s.status <> 'anulado' and s.created_at < timestamptz '2026-11-02 19:10+00'
        and exists (select 1 from public.journal_entry e
                     where e.company_id = s.company_id and e.account_id = s.account_id and e.source_type = 'migrated' and e.status = 'validado'
                       and upper(regexp_replace(e.concept, '[^A-Za-z0-9]', '', 'g')) like upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g')) || '%'
                       and length(upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g'))) >= 4
                       and exists (select 1 from public.journal_line l join public.company_account_link k on k.company_account_id = l.company_account_id
                                    and k.entity = 'supplier' and k.entity_id = si.supplier_id::text and k.role = 'principal'
                                    where l.entry_id = e.id and l.credit - l.debit > 0)))
) q order by o;
