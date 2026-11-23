-- scripts/conta/produccion/cuentas/x29-extractos.sql
--
-- X29 · Gestión de extractos bancarios (1712 y 1713) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE, y solo
-- columnas que existen antes de la tanda. Por cuenta (regla 9):
--   1. Regla 31: los movimientos ya conciliados (cuántos · asientos · huella de su casado, su asiento y sus líneas).
--   2. Lo que ha contabilizado solo el agente de conciliación HOY (Madrid): cuántos y por cuánto (la franja verde).
--   3. Lo que propone hoy bank_proponer en lo que está sin contabilizar: por origen y por seguridad (la columna «Por qué»).
-- Corte fijo para la 1: lo casado antes del 24/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'cuenta ' || m.account_id || ' · movimientos conciliados (cuántos · asientos · huella)' clave,
         count(distinct m.id) || ' · ' || count(distinct e.id) || ' · ' ||
         md5(string_agg(concat_ws('|', m.id, m.status, b.id, b.kind, e.id, e.number, e.series, e.status, e.hash,
                                  l.position, l.company_account_id, l.debit, l.credit), ',' order by m.id, b.id, l.position)) valor
    from public.bank_movement m
    join public.bank_match b on b.movement_id = m.id and b.status = 'vivo'
    join public.journal_entry e on e.id = b.journal_entry_id
    join public.journal_line l on l.entry_id = e.id
   where b.created_at < timestamptz '2026-11-24 00:00:00+01'
   group by m.account_id
  union all
  select 2, 'cuenta ' || b.account_id || ' · contabilizado solo por el agente hoy (cuántos · importe)',
         count(*) || ' · ' || coalesce(sum(abs(b.amount)), 0)
    from public.bank_match b
   where b.status = 'vivo' and b.by_who = 'folvy'
     and (b.created_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date
   group by b.account_id
  union all
  select 3, 'cuenta ' || m.account_id || ' · sin contabilizar · ' || coalesce(m.proposal->>'origen', 'sin propuesta') || ' · ' || coalesce(m.confidence, '-'),
         count(*)::text
    from public.bank_movement m
   where m.status not in ('casado', 'ignorado') and not m.before_cutover
   group by m.account_id, m.proposal->>'origen', m.confidence
) t order by o, clave;
