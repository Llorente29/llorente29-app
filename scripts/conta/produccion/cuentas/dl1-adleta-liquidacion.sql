-- scripts/conta/produccion/cuentas/dl1-adleta-liquidacion.sql
--
-- DL1 · Adleta, lo no liquidado (2213) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después de la tanda, todo a 0. Así lo esperado vale igual
-- en producción y en staging (que no tiene Foodint: ahí todo da 0 antes y después).
--   1. Facturas de la DL1 a Adleta emitidas, menos 2: −2 → 0.
--   2. Repartos por local de esas facturas validados por Julio, menos 2: −2 → 0.
--   3. 43000006 validado, menos lo que debe Adleta (+6.822,98): −5.063,80 → 0,00.
--   4. IVA repercutido de Adleta del 4T (las autofacturas del 01/10 y las dos facturas), menos 1.468,58: −460,35 → 0,00.
--   5. El IVA de Foodint del 1T al 3T (472 y 477, validado): igual.
select clave, valor from (
  -- corte: facturas creadas entre el 06/11 y el 31/12
  select 1 o, 'Facturas de la DL1 a Adleta emitidas, menos 2' clave,
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0 else count(*) - 2 end::text
       from public.customer_invoice ci
      where ci.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and ci.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and ci.party_id = '11fee0f6-b5ab-4cb8-8611-ce6b4ce6b121' and ci.status = 'emitida' and ci.notes like 'DL1 · Lobbers %'
        and ci.created_at between timestamptz '2026-11-06 00:00+00' and timestamptz '2026-12-31 00:00+00') valor
  union all
  -- corte: asientos creados entre el 06/11 y el 31/12
  select 2, 'Repartos por local de las facturas a Adleta validados por Julio, menos 2',
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0 else count(*) - 2 end::text
       from public.journal_entry e
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and e.concept like 'Reparto por local de la factura % a Adleta %' and e.status = 'validado'
        and e.validated_by = '673fca49-f6b5-40ed-a8f7-558390acce10' and e.validated_by_name = 'Julio'
        and e.created_at between timestamptz '2026-11-06 00:00+00' and timestamptz '2026-12-31 00:00+00')
  union all
  -- corte: asientos de 2026 de Foodint hasta el 31/12
  select 3, '43000006 validado, menos lo que debe Adleta (6.822,98)',
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0
                 else coalesce(sum(l.debit - l.credit), 0) - 6822.98 end::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code = '43000006' and e.status = 'validado' and e.entry_date between date '2026-01-01' and date '2026-12-31')
  union all
  -- corte: asientos del 4T de 2026 de Foodint
  select 4, 'IVA repercutido de Adleta del 4T, menos 1.468,58',
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0
                 else coalesce(sum(l.credit - l.debit), 0) - 1468.58 end::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code like '477%' and e.status = 'validado' and e.entry_date between date '2026-10-01' and date '2026-12-31'
        and ((e.created_by_name = 'Julio (tanda DL1)' and (e.concept like 'Autofactura Adleta%' or e.concept like 'Ajuste de Adleta%'))
             or e.id in (select ci.entry_id from public.customer_invoice ci where ci.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
                           and ci.party_id = '11fee0f6-b5ab-4cb8-8611-ce6b4ce6b121' and ci.status = 'emitida')))
  union all
  -- quieta: la tanda no toca el IVA presentado
  select 5, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code like q.c || '%' and e.status = 'validado' and e.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
