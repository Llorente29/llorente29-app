-- scripts/conta/produccion/cuentas/b01r23-noviembre-bancos.sql
--
-- B01r23 · noviembre de Llorente29 (0155) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después de la tanda, todo a 0 (y el IVA, igual). Sin
-- Foodint (staging), todo da 0 antes y después. Los saldos, con la vara única (Julio, 13/11):
-- status in ('validado','anulado') and (voided_at is null or voided_by_entry_id is not null).
--   1. Movimientos de noviembre (hasta el 12/11) sin casar, menos los 6 de fuera: 49 → 0.
--   2. Casados de noviembre por Julio desde el 13/11 con su asiento validado, menos 40: −40 → 0.
--   3. Apartados de noviembre: anulados por el banco, menos 4; comprobación de tarjeta, menos 5.
--   4. Asientos de noviembre de los bancos casados y sin validar: 5 → 0.
--   5. Cada 572 a la fecha de su último movimiento, menos el saldo del banco ese día y menos lo que
--      la tanda deja fuera a propósito: la principal, 626,27 (los tres recobros del préstamo, −647,43,
--      que no se apuntan; y el −21,16 del 05/11, casado como agua y anulado por el banco); Revolut,
--      555,60 (el socio, −18,00, y QBO, −537,60). ···4525 y ···0133, nada.
--   6. El IVA de Foodint del 1T al 3T (472 y 477, por fecha): igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
l as (
  select a.code, e.entry_date, e.status, e.voided_at, e.voided_by_entry_id, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     -- corte: asientos de 2026
     and e.entry_date between date '2026-01-01' and date '2026-12-31'
)
select clave, valor from (
  -- corte: movimientos del 01/11 al 12/11
  select 1 o, 'Movimientos de noviembre hasta el 12/11 sin casar, menos los 6 de fuera' clave,
    (select case when not (select hay from f) then 0 else count(*) - 6 end from public.bank_movement m
      where m.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and m.op_date between date '2026-11-01' and date '2026-11-12'
        and m.status in ('por_aclarar', 'propuesto', 'pendiente'))::text valor
  union all
  -- corte: casados del 13/11 al 31/12
  select 2, 'Casados de noviembre por Julio desde el 13/11 con su asiento validado, menos 40',
    (select case when not (select hay from f) then 0 else count(*) - 40 end
       from public.bank_match b join public.bank_movement m on m.id = b.movement_id join public.journal_entry e on e.id = b.journal_entry_id
      where b.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and b.status = 'vivo' and e.status = 'validado'
        and b.created_by = '673fca49-f6b5-40ed-a8f7-558390acce10' and m.op_date between date '2026-11-01' and date '2026-11-12'
        and b.created_at between timestamptz '2026-11-13 00:00+01' and timestamptz '2026-12-31 00:00+00')::text
  union all
  -- corte: movimientos del 01/11 al 12/11
  select 3, 'Apartados de noviembre: ' || q.k || ', menos ' || q.n,
    (select case when not (select hay from f) then 0 else count(*) - q.n end from public.bank_movement m
      where m.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and m.op_date between date '2026-11-01' and date '2026-11-12'
        and m.status = 'ignorado' and m.ignored_reason = q.motivo)::text
    from (values ('anulados por el banco', 4, 'Anulado por el banco: no había saldo'), ('comprobación de tarjeta', 5, 'Comprobación de tarjeta')) q(k, n, motivo)
  union all
  -- corte: asientos de noviembre
  select 4, 'Asientos de noviembre de los bancos casados y sin validar',
    (select count(distinct e.id) from public.bank_match b join public.journal_entry e on e.id = b.journal_entry_id join public.bank_movement m on m.id = b.movement_id
      where b.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and b.status = 'vivo' and e.status = 'propuesto'
        and m.op_date between date '2026-11-01' and date '2026-11-12')::text
  union all
  select 5, q.c || ' a ' || to_char(q.d, 'DD/MM') || ' menos el banco' || q.nota,
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - q.banco - q.fuera end::numeric(14,2)::text
       from l where l.code = q.c and l.entry_date <= q.d
        and l.status in ('validado', 'anulado') and (l.voided_at is null or l.voided_by_entry_id is not null))
    from (values ('57200001', date '2026-11-11', 0.00, 626.27, ' y menos 626,27 de fuera'),
                 ('57200002', date '2026-11-11', 0.36, 0.00, ''),
                 ('57200003', date '2026-11-09', 0.11, 0.00, ''),
                 ('57200004', date '2026-11-12', 2231.46, 555.60, ' y menos 555,60 de fuera')) q(c, d, banco, fuera, nota)
  union all
  select 6, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from l where l.code like q.c || '%' and l.status in ('validado', 'anulado') and (l.voided_at is null or l.voided_by_entry_id is not null)
        and l.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
