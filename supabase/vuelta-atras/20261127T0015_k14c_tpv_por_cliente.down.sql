-- K14c · vuelta atrás de 20261127T0015: quita la tabla de los pagos con tarjeta (y sus filas). No toca conta_banco_cobro.
drop table if exists public.conta_banco_cobro_tarjeta;
