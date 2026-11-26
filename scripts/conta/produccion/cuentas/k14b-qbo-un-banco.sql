-- scripts/conta/produccion/cuentas/k14b-qbo-un-banco.sql
--
-- K14b · QBO Integrity, un solo banco · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1241 no tiene vuelta atrás (deshace 37 casados con su contraasiento y borra el banco repetido): el ensayo comprueba
-- que hace exactamente lo que declara su «esperado:». Todo de QBO Integrity (regla 9), y los movimientos de las demás
-- cuentas, por cuenta, para ver que no se tocan. Sin el estado del movimiento: lo cambia la conciliación.
select clave, valor from (
  select 0 o, null::uuid account_id, 'QBO · bancos activos' clave,
         count(*)::text valor
    from public.treasury_account t where t.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and t.kind = 'bank' and t.is_active
  union all
  select 0, null, 'QBO · el banco de los movimientos: nombre · subcuenta',
         coalesce((select t.name || ' · ' || coalesce((select ca.code from public.company_account_link l join public.company_account ca on ca.id = l.company_account_id
                                                         where l.entity = 'bank_account' and l.entity_id = t.id::text and l.role = 'principal'), 'sin subcuenta')
                     from public.treasury_account t where t.id = '0094f430-89a8-45b4-b115-bbae8f4cbda1'), 'no está')
  union all
  select 0, null, 'QBO · movimientos: filas · huella',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', m.id, m.amount, m.op_date, m.treasury_account_id), ';' order by m.id)), 12), 'ninguno')
    from public.bank_movement m where m.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4'
  union all
  select 0, null, 'QBO · movimientos de antes del inicio',
         count(*)::text from public.bank_movement m where m.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and m.before_cutover
  union all
  select 0, null, 'QBO · casados vivos: total · de antes del 01/11 · con su asiento en la 57200000',
         count(*) || ' · ' || count(*) filter (where m.op_date < date '2026-11-01') || ' · '
         || count(*) filter (where exists (select 1 from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id
                                            where jl.entry_id = b.journal_entry_id and ca.code = '57200000'))
    from public.bank_match b join public.bank_movement m on m.id = b.movement_id
   where m.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and b.status = 'vivo'
  union all
  select 0, null, 'QBO · asientos de banco anulados',
         count(*)::text from public.journal_entry e where e.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and e.source_type = 'bank' and e.status = 'anulado'
  union all
  select 0, null, 'QBO · cobros casados del K14: filas · huella',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', c.movement_id, c.estado, c.party_id, c.importe), ';' order by c.movement_id)), 12), 'ninguno')
    from public.conta_banco_cobro c where c.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4'
  union all
  select 1, m.account_id, 'cuenta ' || m.account_id || ' · movimientos del banco: filas · huella',
         count(*) || ' · ' || left(md5(string_agg(concat_ws('|', m.id, m.amount, m.op_date, m.treasury_account_id, m.before_cutover), ';' order by m.id)), 12)
    from public.bank_movement m where m.account_id <> 'f4e8032d-510a-4e57-914c-4b67732d8655'
   group by m.account_id
) t order by o, account_id, clave;
