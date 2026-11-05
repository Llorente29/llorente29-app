-- scripts/conta/produccion/cuentas/s01p-candado-iva.sql
--
-- S01p·13 · El candado, solo para lo que lleva IVA (0830) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda cambia reglas (funciones y disparadores) y no mueve ningún asiento: todo tiene que quedar igual.
--   1. Asientos de Foodint en los meses cerrados (enero a septiembre de 2026), por mes y estado.
--   2. El IVA de Foodint del 1T al 3T de 2026 (472 al debe menos haber, 477 al haber menos debe, validado), al céntimo.
--   3. Las retenciones de Foodint del 1T al 3T (4751 al haber menos debe, validado).
--   4. Las marcas de «apuntado tarde» de Foodint (conta_mes_cambio).
select clave, valor from (
  -- quieta: la tanda no crea, no cambia y no borra ningún asiento
  select 1 o, 'Asientos de Foodint, ' || to_char(date_trunc('month', e.entry_date), 'MM/YYYY') || ' · ' || e.status clave, count(*)::text valor
    from public.journal_entry e
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.entry_date between '2026-01-01' and '2026-09-30'
   group by date_trunc('month', e.entry_date), e.status
  union all
  -- quieta: la tanda no toca ningún apunte
  select 2, 'IVA de Foodint ' || q.t || ' de 2026 · ' || q.c,
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and e.status = 'validado' and a.code like q.c || '%'
        and e.entry_date between q.desde and q.hasta)
    from (values ('1T', date '2026-01-01', date '2026-03-31'), ('2T', date '2026-04-01', date '2026-06-30'), ('3T', date '2026-07-01', date '2026-09-30')) q0(t, desde, hasta)
    cross join lateral (select q0.t, q0.desde, q0.hasta, c from unnest(array['472', '477']) c) q
  union all
  -- quieta: la tanda no toca ningún apunte
  select 3, 'Retenciones de Foodint ' || q.t || ' de 2026 · 4751',
    (select coalesce(sum(l.credit - l.debit), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and e.status = 'validado' and a.code like '4751%'
        and e.entry_date between q.desde and q.hasta)
    from (values ('1T', date '2026-01-01', date '2026-03-31'), ('2T', date '2026-04-01', date '2026-06-30'), ('3T', date '2026-07-01', date '2026-09-30')) q(t, desde, hasta)
  union all
  -- quieta: la tanda no marca nada
  select 4, 'Marcas de apuntado tarde de Foodint',
    (select count(*)::text from public.conta_mes_cambio c where c.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
) t order by o, clave;
