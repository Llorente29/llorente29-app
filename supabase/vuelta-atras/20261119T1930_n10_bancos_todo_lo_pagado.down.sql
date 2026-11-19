-- supabase/vuelta-atras/20261119T1930_n10_bancos_todo_lo_pagado.down.sql
--
-- N10 · la vuelta atrás de «Bancos cuenta todo lo pagado»: las cuatro funciones desde su respaldo (como las
-- dejó la 0800 del N09 y lo de antes), y después la función nueva que leían. No cambia ninguna fila.
select public._restaurar_funcion('public._bank_factura_aprobada_con_pago()', '20261119T1930_n10_bancos_todo_lo_pagado');
select public._restaurar_funcion('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)', '20261119T1930_n10_bancos_todo_lo_pagado');
select public._restaurar_funcion('public.bank_facturas_recibidas_pendientes(uuid)', '20261119T1930_n10_bancos_todo_lo_pagado');
select public._restaurar_funcion('public.bank_facturas_para_casar(uuid)', '20261119T1930_n10_bancos_todo_lo_pagado');
drop function if exists public._bank_recibida_pagado(uuid);
