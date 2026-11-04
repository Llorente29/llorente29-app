-- scripts/conta/produccion/cuentas/s01p-facturas-a-su-mes.sql
--
-- S01p · 4 · LO QUE CUENTA LA TANDA (2210 y 2211), antes y después. SOLO LEE.
-- Lo que tiene que pasar en Foodint:
--   1. La regla de la fecha: de «el día en que entró» a «su fecha»: 0 → 1.
--   2. Facturas de octubre con su asiento en noviembre: 22 → 0.
--   3. Facturas de octubre con su asiento con la fecha de su factura: +22.
select clave, valor from (
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 1 o, 'La factura recibida va con su fecha (regla S01p·4)' clave,
    (strpos(pg_get_functiondef('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)'::regprocedure), 'S01p·4') > 0)::int::text valor
  union all
  -- corte: facturas de octubre de 2026 de Foodint, entradas antes del 04/11 19:00Z
  select 2, 'Facturas de octubre con su asiento en noviembre',
    (select count(*)::text from public.supplier_invoice i join public.journal_entry e on e.id = i.journal_entry_id
      where i.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and i.invoice_date between '2026-10-01' and '2026-10-31' and e.entry_date >= '2026-11-01' and e.status = 'validado'
        and i.created_at < timestamptz '2026-11-04 19:00+00')
  union all
  -- corte: facturas de octubre de 2026 de Foodint, entradas antes del 04/11 19:00Z
  select 3, 'Facturas de octubre con su asiento con la fecha de su factura',
    (select count(*)::text from public.supplier_invoice i join public.journal_entry e on e.id = i.journal_entry_id
      where i.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and i.invoice_date between '2026-10-01' and '2026-10-31' and e.entry_date = i.invoice_date and e.status = 'validado'
        and i.created_at < timestamptz '2026-11-04 19:00+00')
) t order by o;
