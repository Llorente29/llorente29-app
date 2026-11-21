-- scripts/conta/produccion/cuentas/r06-formas-de-pago.sql
--
-- R06 · A qué cuenta va cada forma de pago (2130) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 2130 añade cinco funciones y no escribe ninguna fila: se mide que las cuentas de las formas de
-- pago y los días del TPV siguen igual. Cifras de la TABLA ENTERA, a propósito (regla 9, excepción: la
-- huella de «esto no se ha movido»), y se etiquetan como tal.
-- Corte fijo (el #241): solo lo creado antes del 17/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  -- corte: cuentas de formas de pago creadas antes del 17/11 a las 00:00
  select 1 o, 'tabla entera · conta_tpv_forma_cuenta' clave, count(*)::text valor
    from public.conta_tpv_forma_cuenta where created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: días del TPV subidos antes del 17/11 a las 00:00
  select 2, 'tabla entera · conta_tpv_dia ' || estado, count(*)::text
    from public.conta_tpv_dia where subido_en < timestamptz '2026-11-17 00:00:00+01' group by estado
) t order by o, clave;
