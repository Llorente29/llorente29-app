-- scripts/conta/produccion/cuentas/dl1-glovo-french-tacos.sql
--
-- DL1·26 · Glovo, French Tacos Club de Vallecas (0815) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. Sus dos cuentas (70000012 y 70800012) que faltan: 2 → 0.
--   2. 70000012 de 2026, menos 5.594,59 (la venta bruta, sin IVA): −5.594,59 → 0.
--   3. 70009002 de sus ventas, más 2.545,58 (la promoción a su cargo, sin IVA): −2.545,58 → 0.
--   4. 47700010 de sus ventas, menos 296,91 (el IVA del 10 % sobre lo neto, al 4T): −296,91 → 0.
--   5. 43000001 de lo que apunta la tanda, menos 1.760,01 (3.266,05 de ventas − 48,75 de espera
--      − 577,42 y 879,87 compensados): −1.760,01 → 0. Es lo que la ···2149 cobró de octubre y antes.
--   6. 47200021 de la factura I170326000585810, menos 152,70: −152,70 → 0.
--   7. Sus liquidaciones de la ···2149 sin la nota de «cobrado fuera»: 12 → 0.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
l as (
  select a.code, e.entry_date, e.concept, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
     -- corte: asientos de 2026
     and e.entry_date between date '2026-01-01' and date '2026-12-31'
),
t as (
  select * from l where l.concept like 'Ventas Glovo · French Tacos Club%' or l.concept like 'Glovo · I170326000585810%'
     or l.concept in ('Liquidación Glovo · I170326000551592', 'Factura GLOVOAPP SPAIN PLATFORM · I170326000585810')
)
select clave, valor from (
  select 1 o, 'cuentas 70000012 y 70800012 que faltan' clave,
    (select case when not (select hay from f) then 0 else 2 - count(*) end::text from public.company_account
      -- quieta: nadie más crea esas dos subcuentas; solo esta tanda (0 → 2)
      where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and code in ('70000012', '70800012')) valor
  union all
  select 2, '70000012 de 2026, menos 5.594,59',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.credit - l.debit), 0) - 5594.59 end::numeric(14,2)::text from l where l.code = '70000012')
  union all
  select 3, '70009002 de sus ventas, más 2.545,58',
    (select case when not (select hay from f) then 0 else 2545.58 - coalesce(sum(t.debit - t.credit), 0) end::numeric(14,2)::text from t where t.code = '70009002')
  union all
  select 4, '47700010 de sus ventas, menos 296,91',
    (select case when not (select hay from f) then 0 else coalesce(sum(t.credit - t.debit), 0) - 296.91 end::numeric(14,2)::text from t where t.code = '47700010')
  union all
  select 5, '43000001 de lo que apunta la tanda, menos 1.760,01',
    (select case when not (select hay from f) then 0 else coalesce(sum(t.debit - t.credit), 0) - 1760.01 end::numeric(14,2)::text from t where t.code = '43000001')
  union all
  select 6, '47200021 de la factura I170326000585810, menos 152,70',
    (select case when not (select hay from f) then 0 else coalesce(sum(t.debit - t.credit), 0) - 152.70 end::numeric(14,2)::text from t where t.code = '47200021')
  union all
  select 7, 'liquidaciones de la ···2149 sin la nota',
    -- quieta: la nota de esas 12 solo la pone esta tanda; la pantalla la escribe a mano y nadie la toca en ellas
    (select case when not (select hay from f) then 0 else 12 - count(*) end::text from public.channel_settlement c
      where c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and c.collection_note like 'Cobrado fuera de la empresa (···2149)%'
        and c.id in ('56eedbe5-5380-4732-ad7e-6c1b21531cef', 'c37e766a-e85e-4b25-b268-813aa0e553d5', '7822bad0-aa5f-4648-9d59-c8ed403db12d',
                     '446598c6-4b7c-4c1e-b16d-5fbaebb88b65', '12c89ce9-d516-457f-93cf-04b827315620', 'e8a76512-93ba-44ed-84e1-90e54514ba09',
                     '6b27b083-b05c-4df9-b42b-fb0118f91dda', 'ed39ee40-1364-4a8b-b108-434ec53c7077', '4012c24c-e05b-43d4-9bb9-867eccb98642',
                     '143f6110-5a6b-4695-8b02-dea834a17fa1', '91a54b57-2327-4e62-88aa-3a26bc9aac8c', '6e22811f-c001-48ec-9e3a-6907f1f28b8d'))
) x order by o, clave;
