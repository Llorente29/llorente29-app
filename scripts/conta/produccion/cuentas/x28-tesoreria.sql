-- scripts/conta/produccion/cuentas/x28-tesoreria.sql
--
-- X28 · Tesorería como ERP10 (0800 y 0801) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE, y solo columnas que
-- existen antes de la tanda. La 0800 solo añade; la 0801 cambia el casado (marca y plataforma, solo si el destino las
-- trae) y el «a mano» (tres parámetros opcionales). Regla 31: los movimientos del banco YA CONCILIADOS, por cuenta
-- (regla 9: Foodint, la primera), iguales antes y después: cuántos, y la huella de su casado, su asiento y sus líneas.
-- Corte fijo: lo casado antes del 23/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'cuenta ' || m.account_id || ' · movimientos conciliados (cuántos · asientos · huella)' clave,
         count(distinct m.id) || ' · ' || count(distinct e.id) || ' · ' ||
         md5(string_agg(concat_ws('|', m.id, m.status, b.id, b.kind, e.id, e.number, e.series, e.status, e.concept, e.hash,
                                  l.position, l.company_account_id, l.debit, l.credit, l.location_id, l.is_common, l.brand_id, l.channel_id),
                        ',' order by m.id, b.id, l.position)) valor
    from public.bank_movement m
    join public.bank_match b on b.movement_id = m.id and b.status = 'vivo'
    join public.journal_entry e on e.id = b.journal_entry_id
    join public.journal_line l on l.entry_id = e.id
   where b.created_at < timestamptz '2026-11-23 00:00:00+01'
   group by m.account_id
  union all
  select 2, 'cuenta ' || e.account_id || ' · asientos escritos a mano en el banco (cuántos · huella)',
         count(distinct e.id) || ' · ' || md5(string_agg(concat_ws('|', e.id, e.number, e.status, e.hash, l.position, l.company_account_id, l.debit, l.credit, l.is_common),
                                                         ',' order by e.id, l.position))
    from public.journal_entry e join public.journal_line l on l.entry_id = e.id
   where e.source_type = 'manual' and e.reason like 'Escrito a mano en Bancos%' and e.created_at < timestamptz '2026-11-23 00:00:00+01'
   group by e.account_id
) t order by o, clave;
