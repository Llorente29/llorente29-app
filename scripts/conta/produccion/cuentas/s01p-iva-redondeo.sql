-- scripts/conta/produccion/cuentas/s01p-iva-redondeo.sql
--
-- S01p·16 · El IVA redondeado línea a línea (1510) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. Asientos propuestos de Foodint de 2026 que no se validan por «la cuota … no es la base … × …»: 3 → 0 (los de Uber).
--   2. Los mismos, con cualquier otro motivo: no cambia.
--   3. Lo validado de Foodint en 2026 en la 472: no cambia (la tanda no valida nada).
select clave, valor from (
  -- corte: asientos propuestos de facturas recibidas de Foodint de 2026, creados antes del 06/11/2026
  select 1 o, 'Propuestos de Foodint con el motivo de la cuota' clave,
    (select count(*)::text from public.journal_entry e
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.source_type = 'supplier_invoice' and e.status = 'propuesto'
        and e.entry_date >= '2026-01-01' and e.created_at < timestamptz '2026-11-06 00:00+00'
        and exists (select 1 from public.conta_motivos_para_validar(e.id) m where m.motivo ~ 'no es la base')) valor
  union all
  -- corte: los mismos asientos (propuestos de recibidas de 2026 de Foodint, creados antes del 06/11/2026)
  select 2, 'Propuestos de Foodint con otro motivo',
    (select count(*)::text from public.journal_entry e
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.source_type = 'supplier_invoice' and e.status = 'propuesto'
        and e.entry_date >= '2026-01-01' and e.created_at < timestamptz '2026-11-06 00:00+00'
        and exists (select 1 from public.conta_motivos_para_validar(e.id) m where m.motivo !~ 'no es la base'))
  union all
  -- quieta: la tanda no valida nada
  select 3, 'Validado de Foodint en 2026 · 472',
    (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from public.journal_line l join public.journal_entry e on e.id = l.entry_id
       join public.company_account a on a.id = l.company_account_id
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.status = 'validado' and e.entry_date between '2026-01-01' and '2026-12-31' and a.code like '472%')
) t order by o;
