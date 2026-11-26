-- scripts/conta/produccion/cuentas/r20-cifras-fiables.sql
--
-- R20 · Las cifras de «Clientes y cuotas» · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda no toca datos: añade una función y amplía el CHECK de «Pendiente de revisar». Se cuentan, por cuenta
-- (regla 9: los ids cortados a 8), los «Pendiente de revisar» que ya había (el CHECK solo amplía: no cambian) y, de
-- tabla entera, los del tipo nuevo (0 y 0: los escribe la lectura de cada noche).
-- Corte fijo: lo creado antes del 26/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'cuenta ' || left(d.account_id::text, 8) || ' · pendientes de revisar' clave, count(*)::text valor
    from public.conta_gestoria_diferencia d where d.created_at < timestamptz '2026-11-26 00:00:00+01' group by d.account_id
  union all
  select 2, 'tabla entera · pendientes del tipo nuevo', count(*)::text
    from public.conta_gestoria_diferencia d where d.tipo = 'cifras_no_cuadran' and d.created_at < timestamptz '2026-11-26 00:00:00+01'
) t order by o, clave;
