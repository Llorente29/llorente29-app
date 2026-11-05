-- scripts/conta/produccion/cuentas/dl1-uber.sql
--
-- DL1 · Uber con los saldos limpios (1702) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda propone diez asientos (no los valida): lo validado no se mueve hasta que Julio los valide.
--   1. Asientos de la tanda DL1 en Foodint: 0 → 10 propuestos.
--   2. 43000002 en la apertura (solo el asiento de apertura), a 30/06 y a 31/10, validado: igual.
--   3. Lo mismo, contando lo validado y los propuestos de la DL1: 1.754,35 · 375,90 · 7.387,89.
--   4. 41000003 a 31/10, lo mismo: validado y con los propuestos de la DL1.
--   5. El IVA de Foodint del 1T al 3T (472 y 477, validado): igual.
select clave, valor from (
  -- corte: asientos de la tanda DL1 de Foodint
  select 1 o, 'Asientos de la tanda DL1 · ' || coalesce(max(e.status), 'ninguno') clave, count(*)::text valor
    from public.journal_entry e
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.created_by_name = 'Julio (tanda DL1)' and e.created_at between timestamptz '2026-11-05 15:00+00' and timestamptz '2026-12-31 00:00+00'
  union all
  -- quieta: la tanda no valida nada
  select 2, '43000002 validado a ' || case when d.f = date '2026-01-01' then 'la apertura' else to_char(d.f, 'DD/MM') end,
    (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code = '43000002' and e.entry_date between date '2026-01-01' and d.f
        and (d.f > date '2026-01-01' or e.concept = 'Apertura del ejercicio' or e.created_by_name = 'Julio (tanda DL1)') and e.status in ('validado', 'anulado'))
    from (values (date '2026-01-01'), (date '2026-06-30'), (date '2026-10-31')) d(f)
  union all
  -- corte: con los propuestos de la tanda DL1
  select 3, '43000002 con la DL1 a ' || case when d.f = date '2026-01-01' then 'la apertura' else to_char(d.f, 'DD/MM') end,
    (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code = '43000002' and e.entry_date between date '2026-01-01' and d.f
        and (d.f > date '2026-01-01' or e.concept = 'Apertura del ejercicio' or e.created_by_name = 'Julio (tanda DL1)')
        and (e.status in ('validado', 'anulado') or (e.status = 'propuesto' and e.created_by_name = 'Julio (tanda DL1)')))
    from (values (date '2026-01-01'), (date '2026-06-30'), (date '2026-10-31')) d(f)
  union all
  -- corte: con los propuestos de la tanda DL1
  select 4, '41000003 a 31/10 · ' || k.t,
    (select coalesce(sum(l.credit - l.debit), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code = '41000003' and e.entry_date between date '2026-01-01' and date '2026-10-31'
        and (e.status = 'validado' or (k.t = 'con la DL1' and e.status = 'propuesto' and e.created_by_name = 'Julio (tanda DL1)')))
    from (values ('validado'), ('con la DL1')) k(t)
  union all
  -- quieta: la tanda no toca el IVA presentado
  select 5, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code like q.c || '%' and e.status = 'validado' and e.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
