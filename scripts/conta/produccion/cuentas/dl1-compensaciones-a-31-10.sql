-- scripts/conta/produccion/cuentas/dl1-compensaciones-a-31-10.sql
--
-- DL1 · Las compensaciones del 16–31/10 de Just Eat y Glovo, a 31/10 (1500) · LO QUE CUENTA LA TANDA. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
--   1. Las 11 liquidaciones con su compensación validada a 31/10, menos 11: −11 → 0.
--   2. Las 11 con una compensación viva en noviembre: 11 → 0.
--   3. Lo que compensan a 31/10, menos 1.514,20 (Glovo 1.402,45 + Just Eat 111,75): −1.514,20 → 0.
--   4. El IVA del 4T: igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
liq(id) as (values ('9898413d-3e24-434c-a653-3e9c7f97239f'::uuid), ('7c336ed5-3825-4177-b1a8-11068b16a7a7'), ('0a36579b-883e-4816-a188-12b78aa5f5ec'),
  ('509360e3-0116-45dc-a71d-2ec15ab08da2'), ('3476eeba-ee42-4bc4-ae1e-5bf5cecbbc3b'), ('514868a1-a61c-4dbb-a016-b968044b1aa2'), ('d6ecc55f-6bb5-4042-818e-3a7f1266d978'),
  ('80a20dfb-7c7d-4cf3-9db2-37369acc4b72'), ('6fa3dcae-ba1f-441d-a5cc-d1fb7c40c850'), ('3e1fa8d7-ec67-49c8-9209-0a94f58add16'), ('31c67dd0-d6c5-4975-a706-51ddc89a5050')),
e as (
  select x.id liq, j.id, j.entry_date, j.status from liq x join public.journal_entry j on j.source_type = 'channel_settlement' and j.source_id = x.id
   where j.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and j.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     -- corte: asientos de 2026
     and j.entry_date between date '2026-01-01' and date '2026-12-31'
)
select clave, valor from (
  select 1 o, 'Las 11 con su compensación validada a 31/10, menos 11' clave,
    (select case when not (select hay from f) then 0 else count(distinct liq) - 11 end from e where status = 'validado' and entry_date = date '2026-10-31')::text valor
  union all
  select 2, 'Las 11 con compensación viva en noviembre',
    (select count(distinct liq) from e where status in ('validado', 'propuesto', 'borrador') and entry_date > date '2026-10-31')::text
  union all
  select 3, 'Lo que compensan a 31/10, menos 1.514,20',
    -- quieta: solo las líneas de las compensaciones de estas 11 liquidaciones, que no escribe nadie más
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit), 0) - 1514.20 end::numeric(14,2)::text
       from e join public.journal_line l on l.entry_id = e.id where e.status = 'validado' and e.entry_date = date '2026-10-31')
  union all
  select 4, 'IVA ' || y.c || ' del 4T',
    (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry j on j.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where j.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and j.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and j.status in ('validado', 'anulado') and (j.voided_at is null or j.voided_by_entry_id is not null)
        and a.code like y.c || '%' and j.entry_date between date '2026-10-01' and date '2026-12-31')
    from (values ('472'), ('477')) y(c)
) t order by o, clave;
