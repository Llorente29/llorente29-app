-- scripts/conta/produccion/cuentas/k14b-qbo-un-banco.sql
--
-- K14b · QBO Integrity, un solo banco · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1241 no tiene vuelta atrás: el ensayo comprueba que hace exactamente lo que declara su «esperado:». Cada medida
-- de lo que arregla cuenta lo que está MAL (y tiene que quedar en 0), para que lo esperado valga igual en producción y
-- en staging (donde no hay QBO Integrity: 0 antes y después). Lo que no se toca, «como antes». Todo de QBO Integrity
-- (regla 9), y los movimientos de las demás cuentas juntos. Corte fijo: lo creado antes del 26/11/2026 a las 14:00 de
-- Madrid; sin el estado del movimiento, que lo cambia la conciliación.
select clave, valor from (
  select 0 o, 'QBO · bancos activos con el IBAN ···7181 que no son «CaixaBank» con la 57200000' clave,
         count(*)::text valor
    -- quieta: los bancos de QBO solo los toca esta tanda (nadie da de alta bancos durante el ensayo)
    from public.treasury_account t
   where t.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and t.kind = 'bank' and t.is_active and t.iban like '%7181'
     and not (t.name = 'CaixaBank' and exists (select 1 from public.company_account_link l join public.company_account ca on ca.id = l.company_account_id
                                                where l.entity = 'bank_account' and l.entity_id = t.id::text and l.role = 'principal' and ca.code = '57200000'))
  union all
  select 0, 'QBO · movimientos: filas · huella',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', m.id, m.amount, m.op_date, m.treasury_account_id), ';' order by m.id)), 12), 'ninguno')
    from public.bank_movement m where m.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and m.created_at < timestamptz '2026-11-26 14:00:00+01'
  union all
  select 0, 'QBO · movimientos con «antes del inicio» mal puesto',
         count(*)::text from public.bank_movement m
   where m.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and m.created_at < timestamptz '2026-11-26 14:00:00+01'
     and m.before_cutover is distinct from (m.op_date < date '2026-11-01')
  union all
  select 0, 'QBO · casados vivos de antes del 01/11',
         count(*)::text
    -- quieta: en QBO nadie concilia lo de antes del 01/11 (la tanda lo deshace y la base ya no deja casarlo)
    from public.bank_match b join public.bank_movement m on m.id = b.movement_id
   where m.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and m.created_at < timestamptz '2026-11-26 14:00:00+01'
     and b.status = 'vivo' and m.op_date < date '2026-11-01'
  union all
  select 0, 'QBO · ingresos de GoCardless de noviembre sin casar en la 57200000',
         count(*)::text
    -- quieta: los pagos de GoCardless de noviembre de QBO solo los casa esta tanda durante el ensayo
    from public.conta_gc_payout p
   where p.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and p.llegada >= date '2026-11-01' and p.llegada < date '2026-11-26' and p.estado = 'paid'
     and p.gc_id in ('PO01M6NP12C08CMKAB0XKK9YMMJF', 'PO01M6R89GVPEK95R0K71AK85PJ9', 'PO01M6ZZN4Q8QRBP1CKCRV9D3CAV', 'PO01M7Q58G3H283TS3DPG4T42MXP')
     and not exists (select 1 from public.bank_match b join public.journal_line jl on jl.entry_id = b.journal_entry_id
                       join public.company_account ca on ca.id = jl.company_account_id
                      where b.id = p.match_id and b.status = 'vivo' and ca.code = '57200000')
  union all
  select 0, 'QBO · asientos de banco validados de antes del 01/11',
         count(*)::text
    -- quieta: la base ya no deja apuntar asientos de banco de antes del 01/11 en QBO (el día de inicio)
    from public.journal_entry e
   where e.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and e.source_type = 'bank' and e.status = 'validado' and e.entry_date < date '2026-11-01'
  union all
  select 0, 'QBO · cobros casados del K14: filas · huella',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', c.movement_id, c.estado, c.party_id, c.importe), ';' order by c.movement_id)), 12), 'ninguno')
    -- quieta: el motor del K14 solo escribe al leer un extracto, y nadie lee extractos de QBO durante el ensayo
    from public.conta_banco_cobro c where c.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4'
  union all
  select 1, 'las demás cuentas · movimientos del banco: filas · huella',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', m.id, m.amount, m.op_date, m.treasury_account_id, m.before_cutover), ';' order by m.id)), 12), 'ninguno')
    from public.bank_movement m where m.company_id <> '58e574ec-012a-4483-9f5b-3501cc023ba4' and m.created_at < timestamptz '2026-11-26 14:00:00+01'
) t order by o, clave;
