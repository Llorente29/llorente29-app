-- scripts/conta/produccion/cuentas/dl1-cloudtown-enero.sql
--
-- DL1 · Cloudtown, enero de Carabanchel (1451) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después de la tanda, todo a 0. Así lo esperado vale igual
-- en producción y en staging (que no tiene Foodint: ahí todo da 0 antes y después). Va después de la 1421.
--   1. Factura de la DL1 a Cloudtown (enero, Carabanchel) emitida, menos 1: −1 → 0.
--   2. Asientos de la DL1 de Cloudtown de enero validados por Julio (la 678, la FV-02593 y su compensación), menos 3: −3 → 0.
--   3. 43000004 validado, menos −0,67: −4.209,95 → 0,00.
--   4. 67800000 de marzo de 2026: 718,14 → 0,00.
--   5. IVA repercutido de la factura nueva, menos 421,16: −421,16 → 0,00.
--   6. El IVA de Foodint del 1T al 3T (472 y 477, validado): igual.
select clave, valor from (
  -- corte: facturas creadas entre el 12/11 y el 31/12
  select 1 o, 'Factura de la DL1 a Cloudtown (enero) emitida, menos 1' clave,
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0 else count(*) - 1 end::text
       from public.customer_invoice ci
      where ci.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and ci.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and ci.party_id = '915b4784-9c28-4a29-8158-7d1d5abfa38c' and ci.status = 'emitida' and ci.notes like 'DL1 · Cloudtown Carabanchel 09/01/2026%'
        and ci.created_at between timestamptz '2026-11-12 00:00+00' and timestamptz '2026-12-31 00:00+00') valor
  union all
  -- corte: asientos creados entre el 12/11 y el 31/12
  select 2, 'Asientos de la DL1 de Cloudtown de enero validados por Julio, menos 3',
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0 else count(*) - 3 end::text
       from public.journal_entry e
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and e.concept in ('Parte del anterior titular de la liquidación de Cloudtown de enero (01–08/01), pagada por cuenta de Cloudtown',
                          'Factura de stock Cloudtown FV-02593 · febrero 2026 · Carabanchel · apuntada el 01/10',
                          'Compensación con Cloudtown · FV-02593 contra la AF-02593 (febrero, Carabanchel)')
        and e.status = 'validado' and e.validated_by = '673fca49-f6b5-40ed-a8f7-558390acce10' and e.validated_by_name = 'Julio'
        and e.created_at between timestamptz '2026-11-12 00:00+00' and timestamptz '2026-12-31 00:00+00')
  union all
  -- corte: asientos de 2026 de Foodint hasta el 31/12
  select 3, '43000004 validado, menos −0,67',
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0
                 else coalesce(sum(l.debit - l.credit), 0) + 0.67 end::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code = '43000004' and e.status = 'validado' and e.entry_date between date '2026-01-01' and date '2026-12-31')
  union all
  -- corte: asientos de marzo de 2026 de Foodint
  select 4, '67800000 de marzo de 2026',
    (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code = '67800000' and e.status = 'validado' and e.entry_date between date '2026-03-01' and date '2026-03-31')
  union all
  -- corte: facturas creadas entre el 12/11 y el 31/12
  select 5, 'IVA repercutido de la factura de enero a Cloudtown, menos 421,16',
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0
                 else coalesce(sum(l.credit - l.debit), 0) - 421.16 end::numeric(14,2)::text
       from public.journal_line l join public.company_account a on a.id = l.company_account_id
      where a.code like '477%' and l.entry_id in (
        select ci.entry_id from public.customer_invoice ci
         where ci.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and ci.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
           and ci.party_id = '915b4784-9c28-4a29-8158-7d1d5abfa38c' and ci.status = 'emitida' and ci.notes like 'DL1 · Cloudtown Carabanchel 09/01/2026%'
           and ci.created_at between timestamptz '2026-11-12 00:00+00' and timestamptz '2026-12-31 00:00+00'))
  union all
  -- quieta: la tanda no toca el IVA presentado
  select 6, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code like q.c || '%' and e.status = 'validado' and e.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
