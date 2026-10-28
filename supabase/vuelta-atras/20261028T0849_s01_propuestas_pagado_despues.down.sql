-- supabase/vuelta-atras/20261028T0849_s01_propuestas_pagado_despues.down.sql
--
-- Vuelta atrás de la 0849 (el pagado después se propone solo). Primero la
-- regla de ventas de antes, byte a byte (_restaurar_funcion), y después se
-- quitan los disparadores y las funciones nuevas. Las propuestas que ya hizo se
-- quedan en el libro (se descartan o se validan allí). Va antes que la de la 0753.
select public._restaurar_funcion('public.conta_propuesta_ventas_unidad(uuid,uuid,date,uuid,uuid)', '20261028T0849_s01_propuestas_pagado_despues');
drop trigger if exists conta_liquidacion_pedidos_proponer_al_entrar on public.channel_settlement_order;
drop trigger if exists conta_liquidacion_pedidos_proponer_al_casar on public.channel_settlement_order;
drop function if exists public.tg_conta_liquidacion_pedidos_proponer();
drop function if exists public.conta_proponer_pagados_despues(uuid, text);
drop function if exists public.conta_propuesta_pagado_despues(uuid, jsonb);
drop function if exists public._conta_propuesta_ventas(uuid, uuid, date, uuid, uuid, uuid);
