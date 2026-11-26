-- scripts/conta/produccion/cuentas/r20b-te-deben-banco.sql
--
-- R20b · «Te deben», cruzado con el banco · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda no toca datos: añade una función que lee lo del K14. Se cuenta, por cuenta (regla 9: los ids cortados a 8),
-- lo que esa función lee, que no cambia con la tanda: los recibos pagados por el banco y las entradas del TPV sin
-- asignar. Corte fijo: las entradas del banco anteriores al 26/11/2026 (su fecha no cambia; «calculado_en», sí, cada vez que el K14 recalcula).
select clave, valor from (
  select 1 o, 'cuenta ' || left(r.account_id::text, 8) || ' · recibos de GoCardless pagados por el banco' clave, count(*)::text valor
    from public.conta_banco_cobro_recibo r join public.conta_banco_cobro b on b.movement_id = r.movement_id
   where b.fecha < date '2026-11-26' group by r.account_id
  union all
  select 2, 'cuenta ' || left(b.account_id::text, 8) || ' · TPV sin asignar', count(*)::text
    from public.conta_banco_cobro b where b.via = 'tarjeta' and b.estado = 'tarjeta' and b.party_id is null and b.fecha < date '2026-11-26'
   group by b.account_id
) t order by o, clave;
