-- scripts/conta/produccion/cuentas/s01q-glovo-rehacer.sql
--
-- S01q·10 · Las 27 propuestas de Glovo y el 303 · LO QUE CUENTA LA TANDA, antes
-- y después. SOLO LEE. La misma vara a los dos lados (regla 31). Lo que tiene que
-- pasar en Foodint (medido el 03/11 antes de la tanda):
--   1. Propuestas de liquidación del Excel de Glovo con gasto o IVA soportado: 27 → 0.
--   2. Las que solo compensan: 0 → 13.
--   3. Su IVA soportado propuesto: 967,68 → 0.
--   4. Liquidaciones del Excel de Glovo apuntadas como «sin propuesta»: 0 → 14
--      (13 de referencia y la del I170326000551592, que espera a su factura).
--   5 a 7. El borrador del 303 del 4T: estado y resultado, cuántas líneas «no sé
--      declarar» (2 → 0: las de Anthropic Ireland) y cuándo se calculó.
select clave, valor from (
  select 1 o, 'Propuestas de liquidación de Glovo con gasto o IVA soportado' clave,
    -- quieta: las liquidaciones del Excel de Glovo que entraron antes del 03/11 a las 07:00 UTC; solo esta tanda les cambia la propuesta
    (select count(*)::text from public.journal_entry e join public.channel_settlement cs on cs.id = e.source_id
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.source_type = 'channel_settlement' and e.status = 'propuesto'
        and cs.source = 'excel_glovo' and cs.created_at < timestamptz '2026-11-03 07:00+00'
        and exists (select 1 from public.journal_line l join public.company_account ca on ca.id = l.company_account_id
                     where l.entry_id = e.id and (ca.code like '6%' or l.vat_book = 'received'))) valor union all
  select 2, 'Propuestas de liquidación de Glovo que solo compensan',
    -- quieta: las mismas liquidaciones, fijas por su origen y su hora de entrada
    (select count(*)::text from public.journal_entry e join public.channel_settlement cs on cs.id = e.source_id
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.source_type = 'channel_settlement' and e.status = 'propuesto'
        and cs.source = 'excel_glovo' and cs.created_at < timestamptz '2026-11-03 07:00+00'
        and not exists (select 1 from public.journal_line l join public.company_account ca on ca.id = l.company_account_id
                         where l.entry_id = e.id and (ca.code like '6%' or l.vat_book = 'received'))) union all
  select 3, 'Su IVA soportado propuesto',
    -- quieta: las mismas liquidaciones, fijas por su origen y su hora de entrada
    (select coalesce(sum(l.debit - l.credit), 0)::text from public.journal_entry e join public.channel_settlement cs on cs.id = e.source_id
       join public.journal_line l on l.entry_id = e.id
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.source_type = 'channel_settlement' and e.status = 'propuesto'
        and cs.source = 'excel_glovo' and cs.created_at < timestamptz '2026-11-03 07:00+00' and l.vat_book = 'received') union all
  select 4, 'Liquidaciones de Glovo apuntadas como «sin propuesta»',
    -- quieta: las mismas liquidaciones, fijas por su origen y su hora de entrada
    (select count(*)::text from public.conta_propuesta_pendiente q join public.channel_settlement cs on cs.id::text = q.origen_id
      where q.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and q.origen = 'channel_settlement'
        and cs.source = 'excel_glovo' and cs.created_at < timestamptz '2026-11-03 07:00+00') union all
  select 5, 'El 303 del 4T de 2026: estado, resultado y a pagar',
    -- quieta: una declaración fija por su id; solo cambia si alguien la recalcula, revisa o presenta (y entonces la tanda para)
    (select t.status || ' · ' || t.result_kind || ' · ' || coalesce(t.amount::text, '—') from public.tax_return t
      where t.id = '8ae554ae-4853-42c9-b5b0-346840223d47' and t.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 6, 'El 303 del 4T: líneas que Sumied no sabe declarar',
    -- quieta: las líneas de una declaración fija; solo se rehacen al recalcularla (esta tanda, o una persona a mano)
    (select count(*)::text from public.tax_return_line l
      where l.tax_return_id = '8ae554ae-4853-42c9-b5b0-346840223d47' and l.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and l.frozen->>'no_sabe' is not null) union all
  select 7, 'El 303 del 4T: calculado el',
    -- quieta: una declaración fija por su id; su calculated_at solo cambia al recalcularla (esta tanda, o una persona a mano)
    (select to_char(t.calculated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') from public.tax_return t
      where t.id = '8ae554ae-4853-42c9-b5b0-346840223d47' and t.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
) q order by o;
