-- Vuelta atrás de 20261024T0714_n6_puerta_v1.sql (N6).
-- Quita las siete funciones que añadió. No toca ninguna tabla ni ningún dato.
-- Si algo ya las llama (otra función o una vista), para: eso se quita antes.

drop function if exists public.fuente_recepciones_v1(uuid, date, date);
drop function if exists public.fuente_recepcion_lineas_v1(uuid);
drop function if exists public.fuente_ventas_dia_v1(uuid, date);
drop function if exists public.fuente_pedidos_v1(uuid, timestamptz, timestamptz, text);
drop function if exists public.fuente_productos_v1(uuid, text);
drop function if exists public.fuente__locales(uuid);
drop function if exists public.fuente__cuenta(uuid);
