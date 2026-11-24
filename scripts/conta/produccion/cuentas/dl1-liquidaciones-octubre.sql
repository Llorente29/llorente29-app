-- scripts/conta/produccion/cuentas/dl1-liquidaciones-octubre.sql
--
-- DL1 · las liquidaciones de octubre que cuadran (0935) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. Las 12 con su compensación validada por Julio, menos 12: −12 → 0.
--   2. Lo que mueven en cada cuenta de cliente de plataforma, más lo que tienen que mover:
--      43000001 (Glovo) −1.402,45, 43000003 (Just Eat) −111,75, 43000002 (Uber) −11,98 → 0.
--   3. El IVA del 4T: igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
q as (select unnest(array['9898413d-3e24-434c-a653-3e9c7f97239f', '7c336ed5-3825-4177-b1a8-11068b16a7a7', '0a36579b-883e-4816-a188-12b78aa5f5ec',
  '509360e3-0116-45dc-a71d-2ec15ab08da2', '3476eeba-ee42-4bc4-ae1e-5bf5cecbbc3b', '514868a1-a61c-4dbb-a016-b968044b1aa2', 'd6ecc55f-6bb5-4042-818e-3a7f1266d978',
  '80a20dfb-7c7d-4cf3-9db2-37369acc4b72', '6fa3dcae-ba1f-441d-a5cc-d1fb7c40c850', '3e1fa8d7-ec67-49c8-9209-0a94f58add16', '31c67dd0-d6c5-4975-a706-51ddc89a5050',
  '2431b50f-0449-41ce-933a-d563ceb3a988']::uuid[]) liq),
c as (
  select e.id, e.status, e.validated_by from public.journal_entry e join q on q.liq = e.source_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.source_type = 'channel_settlement'
     -- corte: asientos del 26/10 al 07/11
     and e.entry_date between date '2026-10-26' and date '2026-11-07'
),
l as (
  select a.code, e.entry_date, e.id, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
     -- corte: asientos de 2026
     and e.entry_date between date '2026-01-01' and date '2026-12-31'
)
select clave, valor from (
  select 1 o, 'Las 12 con su compensación validada por Julio, menos 12' clave,
    (select case when not (select hay from f) then 0 else count(*) - 12 end from c where c.status = 'validado' and c.validated_by = '673fca49-f6b5-40ed-a8f7-558390acce10')::text valor
  union all
  select 2, 'Lo que mueven en la ' || x.c || ', más ' || x.t, (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) + x.v end::numeric(14,2)::text
                    from l where l.code = x.c and l.id in (select id from c))
    from (values ('43000001', 1402.45, '1.402,45'), ('43000003', 111.75, '111,75'), ('43000002', 11.98, '11,98')) x(c, v, t)
  union all
  select 3, 'IVA ' || y.c || ' del 4T', (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from l where l.code like y.c || '%' and l.entry_date between date '2026-10-01' and date '2026-12-31')
    from (values ('472'), ('477')) y(c)
) t order by o, clave;
