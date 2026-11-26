-- scripts/conta/produccion/cuentas/k14b-un-solo-banco.sql
--
-- K14b · Un IBAN, un banco · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1240 cambia bank_cuenta_alta y añade funciones y disparadores; no escribe en ninguna fila. Se mide que no se mueve
-- nada de lo que tocan: los bancos, los movimientos (con su lado del día de inicio), los ejercicios y los ajustes del
-- banco; con todas las cuentas juntas, y los movimientos por cuenta (regla 9). Corte fijo: lo creado antes del 26/11/2026
-- a las 14:00 de Madrid. Sin el estado del movimiento: lo cambia la conciliación, no esta tanda.
select clave, valor from (
  select 0 o, null::uuid account_id, 'todas las cuentas · bancos y tarjetas: filas · huella' clave,
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', t.id, t.name, t.iban, t.is_active), ';' order by t.id)), 12), 'ninguno') valor
    from public.treasury_account t where t.created_at < timestamptz '2026-11-26 14:00:00+01'
  union all
  select 0, null, 'todas las cuentas · movimientos del banco: filas · antes del inicio · huella',
         count(*) || ' · ' || count(*) filter (where m.before_cutover) || ' · '
         || coalesce(left(md5(string_agg(concat_ws('|', m.id, m.treasury_account_id, m.amount, m.op_date, m.before_cutover), ';' order by m.id)), 12), 'ninguno')
    from public.bank_movement m where m.created_at < timestamptz '2026-11-26 14:00:00+01'
  union all
  select 0, null, 'todas las cuentas · ejercicios: filas · huella',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', y.id, y.starts_on, y.ends_on, y.origin, y.imported_until), ';' order by y.id)), 12), 'ninguno')
    from public.fiscal_year y
  union all
  select 0, null, 'todas las cuentas · ajustes del banco: filas · huella',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', b.company_id, b.cutover_date), ';' order by b.company_id)), 12), 'ninguno')
    from public.bank_settings b
  union all
  select 1, m.account_id, 'cuenta ' || m.account_id || ' · movimientos del banco: filas',
         count(*)::text from public.bank_movement m where m.created_at < timestamptz '2026-11-26 14:00:00+01'
   group by m.account_id
) t order by o, account_id, clave;
