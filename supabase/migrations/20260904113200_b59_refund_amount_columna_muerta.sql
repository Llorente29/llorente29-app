-- B59 §5 · 04/09/2026 — sale.refund_amount ES UNA COLUMNA MUERTA. QUEDA DICHO.
-- ===========================================================================
-- Medido el 04/09: NULL en 9.265 de 9.265 ventas. Nunca ha recibido un valor.
--
-- NO ES QUE FALTE RELLENARLA: es que su fuente declarada no existe. El mapa de
--   fuentes decia que venia de Last.app, pero el adaptador nunca la escribio.
--   Comprobado que no es un fallo general del adaptador: `discount_amount`, su
--   vecina, esta poblada en 9.136 de 9.265. O sea que la ingesta SI rellena
--   columnas hermanas — esta se quedo sin escritor y nadie se dio cuenta en
--   nueve mil ventas.
--
-- DONDE VIVE DE VERDAD ESE DATO, que es lo que hay que saber para no volver a
--   buscarlo aqui: la devolucion por incidencia esta a nivel de LIQUIDACION, en
--   channel_settlement_order.incidents_refund (8 filas, 102,74 EUR) y en
--   channel_settlement.incidents_refund (4 filas, 51,10 EUR). Es dato de
--   factura, no de venta: llega semanas despues del pedido y no por el webhook.
--   Tampoco hay lineas de tipo 'refund' en sale_line: cero.
--
-- POR QUE NO SE BORRA LA COLUMNA: borrarla es un cambio de esquema que rompe los
--   tipos generados y cualquier lectura que exista, y el dato SI puede acabar
--   teniendo sitio aqui el dia que L4 case una reclamacion con su venta. Lo que
--   no puede seguir es estar muda: un `comment` la declara muerta EN LA PROPIA
--   BASE, que es donde mira quien la va a usar (regla F12). Una columna que
--   parece un dato y siempre es NULL es una trampa para el siguiente.

begin;

comment on column public.sale.refund_amount is
  'COLUMNA MUERTA (verificado 04/09/2026): NULL en las 9.265 ventas, nunca ha recibido un valor. '
  'Su fuente declarada era Last.app y el adaptador nunca la escribio (comparar con discount_amount, '
  'poblada en 9.136). NO APOYAR NINGUNA DECISION EN ELLA. La devolucion por incidencia vive hoy a '
  'nivel de liquidacion: channel_settlement_order.incidents_refund y channel_settlement.incidents_refund. '
  'Si L4 acaba casando reclamaciones con ventas, este es el sitio donde escribirla — y entonces se '
  'quita este comentario.';

do $verif$
begin
  if (select count(*) from public.sale where refund_amount is not null) > 0 then
    raise exception 'B59 §5: refund_amount YA tiene valores. El comentario de columna muerta seria falso: revisar antes de aplicar.';
  end if;
end
$verif$;

commit;
