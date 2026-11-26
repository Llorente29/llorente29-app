-- scripts/conta/produccion/cuentas/k14c-tpv-por-cliente.sql
--
-- K14c · Los pagos con tarjeta, uno a uno · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0015 solo añade una tabla (conta_banco_cobro_tarjeta) y sus 19 filas de QBO Integrity; no escribe en ninguna fila
-- de lo que ya existe. Se mide que no se mueve lo cobrado por el banco (conta_banco_cobro, la del K14) ni los abonos del
-- TPV; con todas las cuentas juntas, y por cuenta (regla 9). Corte fijo: entradas del banco hasta el 24/11/2026.
select clave, valor from (
  select 0 o, null::uuid account_id, 'todas las cuentas · cobrado por el banco: filas · huella' clave,
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', c.movement_id, c.importe, c.estado, c.party_id), ';' order by c.movement_id)), 12), 'ninguno') valor
    from public.conta_banco_cobro c where c.fecha <= date '2026-11-24'
  union all
  select 0, null, 'todas las cuentas · abonos del TPV («tarjeta»): filas · importe',
         count(*) || ' · ' || coalesce(sum(c.importe), 0)::text
    from public.conta_banco_cobro c where c.estado = 'tarjeta' and c.fecha <= date '2026-11-24'
  union all
  select 1, c.account_id, 'cuenta ' || c.account_id || ' · cobrado por el banco: filas',
         count(*)::text from public.conta_banco_cobro c where c.fecha <= date '2026-11-24'
   group by c.account_id
) t order by o, account_id, clave;
