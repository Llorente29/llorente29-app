-- scripts/conta/produccion/cuentas/dl1-glovo-envios.sql
--
-- DL1 · envíos de Glovo de octubre (2342) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
--   1. Pedidos de Glovo de octubre con el envío por aclarar, menos 4 (los del 04–05/10, en asientos
--      validados, que no se tocan): 22 → 0.
--   2. Envíos aclarados por Julio como «lo_paga», menos 22: −22 → 0.
--   3. Lo que suman esos envíos, menos 99,00: −99,00 → 0.
--   4. El IVA de Foodint del 1T al 3T (472 y 477, por fecha): igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
s as (
  select s.id, s.account_id
    from public.sale s join public.sales_channel ch on ch.id = s.channel_id
   where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and ch.slug ilike 'glovo%'
     -- corte: pedidos de octubre
     and s.sold_at between timestamptz '2026-10-01 00:00+02' and timestamptz '2026-11-01 00:00+01'
),
a as (
  select a.sale_id, c.envio
    from public.conta_envio_aclarado a join s on s.id = a.sale_id
    cross join lateral public.conta_cargos_de_pedidos(s.account_id, array[s.id]) c
   where a.decision = 'lo_paga' and a.created_by = '673fca49-f6b5-40ed-a8f7-558390acce10'
     -- corte: aclarados entre el 12/11 y el 31/12
     and a.created_at between timestamptz '2026-11-12 00:00+00' and timestamptz '2026-12-31 00:00+00'
)
select clave, valor from (
  select 1 o, 'Pedidos de Glovo de octubre con el envío por aclarar, menos 4' clave,
    (select case when not (select hay from f) then 0 else count(*) - 4 end
       from s cross join lateral public.conta_cargos_de_pedidos(s.account_id, array[s.id]) c where c.clase = 'por_aclarar')::text valor
  union all
  select 2, 'Envíos aclarados por Julio como «lo_paga», menos 22',
    (select case when not (select hay from f) then 0 else count(*) - 22 end from a)::text
  union all
  select 3, 'Lo que suman esos envíos, menos 99,00',
    (select case when not (select hay from f) then 0 else coalesce(sum(a.envio), 0) - 99.00 end from a)::numeric(14,2)::text
  union all
  select 4, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account ca on ca.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and ca.code like q.c || '%' and e.status = 'validado' and e.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
