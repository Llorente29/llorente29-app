-- scripts/conta/produccion/cuentas/b01r24-noviembre-fuera.sql
--
-- B01r24 · los de noviembre que quedaron fuera (0955) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después de la tanda, todo a 0 (y el IVA, igual). Sin
-- Foodint (staging), todo da 0 antes y después. Los saldos, con la vara única (Julio, 13/11):
-- status in ('validado','anulado') and (voided_at is null or voided_by_entry_id is not null).
--   1. Movimientos de noviembre (01/11–13/11) sin casar: 7 → 0.
--   2. Los 6 de la B01r24 casados con su asiento validado, menos 6: −6 → 0.
--   3. Apartados como «Traspaso a Revolut ya apuntado en su entrada del 02/11», menos 1: −1 → 0.
--   4. Lo que apuntan los 6 en cada cuenta, menos lo que tienen que apuntar: 52010000 617,43;
--      62600000 30,00; 62800000 18,00; 41000008 537,60; 40700001 200,00 (todo al Debe).
--   5. Cada 572 a la fecha de su último movimiento, menos el saldo del banco ese día: nada fuera.
--   6. El IVA de Foodint del 1T al 3T (472 y 477, por fecha): igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
seis(id) as (values ('7b9b5132-2861-4d6d-852f-53739dafe320'::uuid), ('8fb0c82f-f1ac-49bd-8338-b1df5b6dcb08'), ('63c89636-a53b-4003-bc50-dc86e0e2d00b'),
                    ('322d4cc1-9a0d-4866-867a-7e75e6225ad9'), ('df68f127-8f5f-405b-b54a-14d7f6eac6de'), ('9c9866da-a641-4689-9445-6ec8abcd490c')),
l as (
  select a.code, e.entry_date, e.status, e.voided_at, e.voided_by_entry_id, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     -- corte: asientos de 2026
     and e.entry_date between date '2026-01-01' and date '2026-12-31'
)
select clave, valor from (
  -- corte: movimientos del 01/11 al 13/11
  select 1 o, 'Movimientos de noviembre (01/11–13/11) sin casar' clave,
    (select case when not (select hay from f) then 0 else count(*) end from public.bank_movement m
      where m.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and m.op_date between date '2026-11-01' and date '2026-11-13'
        and m.status in ('por_aclarar', 'propuesto', 'pendiente'))::text valor
  union all
  -- quieta: seis movimientos por su id
  select 2, 'Los 6 de la B01r24 casados con su asiento validado, menos 6',
    (select case when not (select hay from f) then 0 else count(*) - 6 end
       from public.bank_match b join public.journal_entry e on e.id = b.journal_entry_id
      where b.movement_id in (select id from seis) and b.status = 'vivo' and e.status = 'validado')::text
  union all
  -- corte: movimientos del 01/11 al 13/11
  select 3, 'Apartados como traspaso a Revolut ya apuntado, menos 1',
    (select case when not (select hay from f) then 0 else count(*) - 1 end from public.bank_movement m
      where m.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and m.op_date between date '2026-11-01' and date '2026-11-13'
        and m.status = 'ignorado' and m.ignored_reason = 'Traspaso a Revolut ya apuntado en su entrada del 02/11')::text
  union all
  -- quieta: los asientos de esos seis movimientos
  select 4, 'Lo que apuntan los 6 en la ' || q.c || ', menos ' || q.k,
    (select case when not (select hay from f) then 0 else coalesce(sum(jl.debit - jl.credit), 0) - q.importe end::numeric(14,2)::text
       from public.bank_match b join public.journal_line jl on jl.entry_id = b.journal_entry_id join public.company_account a on a.id = jl.company_account_id
      where b.movement_id in (select id from seis) and b.status = 'vivo' and a.code = q.c)
    from (values ('52010000', 617.43, '617,43'), ('62600000', 30.00, '30,00'), ('62800000', 18.00, '18,00'),
                 ('41000008', 537.60, '537,60'), ('40700001', 200.00, '200,00')) q(c, importe, k)
  union all
  select 5, q.c || ' a ' || to_char(q.d, 'DD/MM') || ' menos el banco',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - q.banco end::numeric(14,2)::text
       from l where l.code = q.c and l.entry_date <= q.d
        and l.status in ('validado', 'anulado') and (l.voided_at is null or l.voided_by_entry_id is not null))
    from (values ('57200001', date '2026-11-13', 0.00), ('57200002', date '2026-11-11', 0.36),
                 ('57200003', date '2026-11-09', 0.11), ('57200004', date '2026-11-13', 2031.46)) q(c, d, banco)
  union all
  select 6, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from l where l.code like q.c || '%' and l.status in ('validado', 'anulado') and (l.voided_at is null or l.voided_by_entry_id is not null)
        and l.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
