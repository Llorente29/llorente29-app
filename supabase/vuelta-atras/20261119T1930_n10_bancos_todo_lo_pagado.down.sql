-- supabase/vuelta-atras/20261119T1930_n10_bancos_todo_lo_pagado.down.sql
--
-- N10 · la vuelta atrás de «Bancos descuenta todo lo pagado»: las dos funciones de Bancos desde su
-- respaldo (como las dejó la 0800 del N09). No cambia ninguna fila.
select public._restaurar_funcion('public.bank_facturas_recibidas_pendientes(uuid)', '20261119T1930_n10_bancos_todo_lo_pagado');
select public._restaurar_funcion('public.bank_facturas_para_casar(uuid)', '20261119T1930_n10_bancos_todo_lo_pagado');
