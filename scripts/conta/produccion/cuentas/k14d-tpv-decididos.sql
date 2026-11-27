-- scripts/conta/produccion/cuentas/k14d-tpv-decididos.sql
--
-- K14d · Lo que decide Julio sobre los pagos con tarjeta · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0055 añade la columna «falta» y cambia 4 de los 19 pagos con tarjeta de QBO (dos pasan a casados, dos ganan su
-- ficha y uno, lo que le falta). Se mide: los pagos por estado (los casados pasan de 12 a 14), los que van a facturarse
-- y que no se mueve lo cobrado por el banco (conta_banco_cobro). Todas las cuentas juntas, y por cuenta (regla 9).
select clave, valor from (
  select 0 o, null::uuid account_id, 'todas las cuentas · pagos con tarjeta: filas · importe' clave,
         -- quieta: solo la escriben las migraciones K14c y K14d (nadie más inserta ni cambia)
         count(*) || ' · ' || coalesce(sum(t.importe), 0)::text valor
    from public.conta_banco_cobro_tarjeta t
  union all
  select 0, null, 'todas las cuentas · pagos con tarjeta por estado',
         -- quieta: solo la escriben las migraciones K14c y K14d
         coalesce(string_agg(z.estado || ' ' || z.n, ' · ' order by z.estado), 'ninguno')
    from (select t.estado, count(*) n from public.conta_banco_cobro_tarjeta t group by 1) z
  union all
  select 0, null, 'todas las cuentas · pagos con tarjeta con ficha: filas',
         -- quieta: solo la escriben las migraciones K14c y K14d
         count(*)::text from public.conta_banco_cobro_tarjeta t where t.party_id is not null
  union all
  select 0, null, 'todas las cuentas · cobrado por el banco: filas · huella',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', c.movement_id, c.importe, c.estado, c.party_id), ';' order by c.movement_id)), 12), 'ninguno')
    from public.conta_banco_cobro c where c.fecha <= date '2026-11-24'
  union all
  select 1, t.account_id, 'cuenta ' || t.account_id || ' · pagos con tarjeta: filas',
         -- quieta: solo la escriben las migraciones K14c y K14d
         count(*)::text from public.conta_banco_cobro_tarjeta t group by t.account_id
) t order by o, account_id, clave;
