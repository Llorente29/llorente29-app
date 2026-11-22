-- R16 · la vuelta atrás de la 0810: quita las tres funciones. Los clientes que la salida a ERP10 haya dado de alta (su
-- tercero y su 430) se quedan: son fichas de Sumied como las demás, y pueden tener ya apuntes en ERP10.
drop function if exists public.conta_erp10_dias_tpv_libro(uuid, date);
drop function if exists public.conta_erp10_clientes_tpv(uuid, date, text);
drop function if exists public._conta_tpv_cliente_cuenta(uuid, text, text, text);
