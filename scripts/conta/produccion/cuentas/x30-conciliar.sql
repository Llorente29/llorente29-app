-- scripts/conta/produccion/cuentas/x30-conciliar.sql
--
-- X30 · Conciliar solo y reglas de verdad (2050, 2051 y 2052) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE, y
-- solo columnas que existen antes de la tanda. Por cuenta (regla 9). Cortes fijos (W06): lo creado antes del 23/11/2026
-- a las 21:00 de Madrid.
--   1. Regla 31: los movimientos ya conciliados (cuántos · asientos · huella de su casado, su asiento y sus líneas).
--      Ninguna regla de partida concilia nada al aplicar la tanda: esto sale igual.
--   2. Las reglas de cada cuenta (cuántas · cuántas activas): las de partida se añaden; las de antes no cambian.
--   3. El «Cuadra ✗» del 16/11 de BBVA ···0133 (Foodint), en solo lectura y sin conceptos (T11): cada movimiento del
--      16/11 en el orden en que hoy lo pinta la pantalla (created_at, id) con su importe y su estado; los extractos que
--      lo traen con su saldo final; el saldo de su 572 en Sumied al final del 16/11, y lo que hay sin contabilizar hasta
--      ese día (lo que separa los dos saldos si el saldo de partida cuadra).
select clave, valor from (
  select 1 o, 'cuenta ' || m.account_id || ' · movimientos conciliados (cuántos · asientos · huella)' clave,
         count(distinct m.id) || ' · ' || count(distinct e.id) || ' · ' ||
         md5(string_agg(concat_ws('|', m.id, m.status, b.id, b.kind, e.id, e.number, e.series, e.status, e.hash,
                                  l.position, l.company_account_id, l.debit, l.credit), ',' order by m.id, b.id, l.position)) valor
    from public.bank_movement m
    join public.bank_match b on b.movement_id = m.id and b.status = 'vivo'
    join public.journal_entry e on e.id = b.journal_entry_id
    join public.journal_line l on l.entry_id = e.id
   where b.created_at < timestamptz '2026-11-23 21:00:00+01'
   group by m.account_id
  union all
  select 2, 'cuenta ' || r.account_id || ' · reglas del banco (cuántas · activas · confirmadas en total)',
         count(*) || ' · ' || count(*) filter (where r.status = 'activa') || ' · ' || coalesce(sum(r.confirmations), 0)
    from public.bank_rule r
   where r.created_at < timestamptz '2026-11-23 21:00:00+01'
   group by r.account_id
  union all
  select 3, 'BBVA ···0133 · 16/11 · ' || lpad(row_number() over (order by m.created_at, m.id)::text, 2, '0') || ' (orden de hoy)',
         to_char(m.amount, 'FM999G990D00') || ' € · ' || m.status || ' · extracto ' || left(m.statement_id::text, 8) || ' · entró ' || to_char(m.created_at at time zone 'Europe/Madrid', 'DD/MM HH24:MI:SS')
    from public.bank_movement m join public.treasury_account t on t.id = m.treasury_account_id
   where m.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and t.iban like '%0133' and m.op_date = date '2026-11-16'
     and m.created_at < timestamptz '2026-11-23 21:00:00+01'
  union all
  select 4, 'BBVA ···0133 · extracto ' || left(s.id::text, 8) || ' · del ' || to_char(s.period_from, 'DD/MM') || ' al ' || to_char(s.period_to, 'DD/MM'),
         'saldo inicial ' || coalesce(to_char(s.opening_balance, 'FM999G990D00'), '-') || ' · final ' || coalesce(to_char(s.closing_balance, 'FM999G990D00'), '-') || ' · ' || s.source
    from public.bank_statement s join public.treasury_account t on t.id = s.treasury_account_id
   where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and t.iban like '%0133'
     and s.period_from <= date '2026-11-17' and s.period_to >= date '2026-11-15' and s.imported_at < timestamptz '2026-11-23 21:00:00+01'
  union all
  select 5, 'BBVA ···0133 · saldo de su 572 en Sumied al final del 16/11 (' || t.pgc_hint || ')',
         to_char(coalesce(sum(l.debit - l.credit), 0), 'FM999G990D00') || ' €'
    from public.treasury_account t
    join public.company_account a on a.company_id = t.company_id and a.code = t.pgc_hint
    left join public.journal_line l on l.company_account_id = a.id
      and exists (select 1 from public.journal_entry e where e.id = l.entry_id and e.status in ('borrador', 'validado') and e.entry_date <= date '2026-11-16'
                    and e.created_at < timestamptz '2026-11-23 21:00:00+01')
   where t.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and t.iban like '%0133'
   group by t.pgc_hint
  union all
  select 6, 'BBVA ···0133 · sin contabilizar hasta el 16/11 (cuántos · suma)',
         count(*) || ' · ' || to_char(coalesce(sum(m.amount), 0), 'FM999G990D00') || ' €'
    from public.bank_movement m join public.treasury_account t on t.id = m.treasury_account_id
   where m.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and t.iban like '%0133' and m.op_date <= date '2026-11-16'
     and m.status <> 'casado' and m.created_at < timestamptz '2026-11-23 21:00:00+01'
) t order by o, clave;
