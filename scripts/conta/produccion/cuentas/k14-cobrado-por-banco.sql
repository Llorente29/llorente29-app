-- scripts/conta/produccion/cuentas/k14-cobrado-por-banco.sql
--
-- K14 · Lo cobrado por el banco · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0915 solo añade (dos tablas y cuatro funciones) y no escribe en ninguna fila de lo que ya existe. Se mide que no se
-- mueve lo que lee el motor: los movimientos del banco, los cobros de GoCardless y lo cobrado por otra vía a mano (G04);
-- con todas las cuentas juntas, y por cuenta (regla 9). Corte fijo: lo creado o leído antes del 26/11/2026 a las 10:00 de
-- Madrid. Sin el estado del movimiento ni el del cobro: los cambian la conciliación y la lectura de GoCardless, no esta tanda.
select clave, valor from (
  select 0 o, null::uuid account_id, 'todas las cuentas · movimientos del banco: filas · huella' clave,
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', m.id, m.amount, m.op_date), ';' order by m.id)), 12), 'ninguno') valor
    from public.bank_movement m where m.created_at < timestamptz '2026-11-26 10:00:00+01'
  union all
  select 0, null, 'todas las cuentas · cobros de GoCardless: filas · huella',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', g.company_id, g.gc_id, g.importe), ';' order by g.company_id, g.gc_id)), 12), 'ninguno')
    from public.conta_gc_cobro g where g.leido_at < timestamptz '2026-11-26 10:00:00+01'
  union all
  select 0, null, 'todas las cuentas · cobrados por otra vía: filas',
         count(*)::text from public.conta_gc_cobro_otra_via o where o.cuando < timestamptz '2026-11-26 10:00:00+01'
  union all
  select 1, m.account_id, 'cuenta ' || m.account_id || ' · movimientos del banco: filas',
         count(*)::text from public.bank_movement m where m.created_at < timestamptz '2026-11-26 10:00:00+01'
   group by m.account_id
) t order by o, account_id, clave;
