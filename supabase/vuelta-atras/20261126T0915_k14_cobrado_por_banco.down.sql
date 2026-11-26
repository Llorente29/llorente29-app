-- K14 · vuelta atrás de 20261126T0915: quita la tabla de lo cobrado por el banco (con sus recibos pagados) y sus tres
-- funciones. Lo que el motor había casado se pierde; los movimientos del banco y los recibos de GoCardless no se tocan.
-- Antes, avisar a Q y a R: dejan de tener qué leer.
drop function if exists public.conta_banco_cobro_decidir(uuid, uuid, boolean, text);
drop function if exists public.conta_banco_cobros_guardar(uuid, jsonb, text);
drop function if exists public.conta_banco_cobros_datos(uuid);
drop function if exists public._conta_banco_cobro_empresa(uuid);
drop table if exists public.conta_banco_cobro_recibo;
drop table if exists public.conta_banco_cobro;
