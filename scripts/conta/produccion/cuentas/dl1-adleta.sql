-- scripts/conta/produccion/cuentas/dl1-adleta.sql
--
-- DL1 · Adleta: las autofacturas que faltan (2052) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después de la tanda, todo a 0. Así lo esperado vale igual
-- en producción y en staging (que no tiene Foodint: ahí todo da 0 antes y después).
--   1. Asientos de Adleta de la tanda DL1 validados por Julio, menos 5: −5 → 0.
--   2. 43000006 validado, menos lo que debe Adleta (+1.759,18): −13.834,32 → 0,00.
--   3. IVA repercutido de esos asientos (477, 4T), menos 1.008,23: −1.008,23 → 0,00.
--   4. El IVA de Foodint del 1T al 3T (472 y 477, validado): igual.
select clave, valor from (
  -- corte: asientos de la tanda DL1 creados entre el 06/11 y el 31/12
  select 1 o, 'Asientos de Adleta de la DL1 validados por Julio, menos 5' clave,
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0 else count(*) - 5 end::text
       from public.journal_entry e
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and e.created_by_name = 'Julio (tanda DL1)' and (e.concept like 'Autofactura Adleta%' or e.concept like 'Ajuste de Adleta%')
        and e.status = 'validado' and e.validated_by = '673fca49-f6b5-40ed-a8f7-558390acce10' and e.validated_by_name = 'Julio'
        and e.created_at between timestamptz '2026-11-06 00:00+00' and timestamptz '2026-12-31 00:00+00') valor
  union all
  -- corte: asientos de 2026 de Foodint hasta el 31/12
  select 2, '43000006 validado, menos lo que debe Adleta (1.759,18)',
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0
                 else coalesce(sum(l.debit - l.credit), 0) - 1759.18 end::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code = '43000006' and e.status = 'validado' and e.entry_date between date '2026-01-01' and date '2026-12-31')
  union all
  -- corte: asientos de la tanda DL1 creados entre el 06/11 y el 31/12
  select 3, 'IVA repercutido de Adleta de la DL1 (4T), menos 1.008,23',
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0
                 else coalesce(sum(l.credit - l.debit), 0) - 1008.23 end::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code like '477%' and e.status = 'validado' and e.created_by_name = 'Julio (tanda DL1)'
        and (e.concept like 'Autofactura Adleta%' or e.concept like 'Ajuste de Adleta%')
        and e.created_at between timestamptz '2026-11-06 00:00+00' and timestamptz '2026-12-31 00:00+00')
  union all
  -- quieta: la tanda no toca el IVA presentado
  select 4, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code like q.c || '%' and e.status = 'validado' and e.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
