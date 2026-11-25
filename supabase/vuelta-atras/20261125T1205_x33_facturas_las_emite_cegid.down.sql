-- X33 · vuelta atrás de 20261125T1205: quita el ajuste «Las facturas las emite Cegid» (su tabla y sus funciones).
-- Va después de la de la 1206, que deja la salida sin el freno.
drop function if exists public.conta_erp10_facturas_fuera_del_mes(uuid, date);
drop function if exists public.conta_erp10_facturas_fuera_poner(uuid, boolean, text);
drop function if exists public._conta_erp10_factura_frenada(uuid, uuid);
drop table if exists public.conta_erp10_facturas_fuera;
