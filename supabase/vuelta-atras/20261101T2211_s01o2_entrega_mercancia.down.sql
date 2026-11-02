-- supabase/vuelta-atras/20261101T2211_s01o2_entrega_mercancia.down.sql
--
-- Vuelta atrás de la 2211: las dos funciones como estaban y fuera la deducción y la columna.
select public._restaurar_funcion('public._compras_casar_solo(uuid)', '20261101T2211_s01o2_entrega_mercancia');
select public._restaurar_funcion('public.conta_correo_facturas(uuid)', '20261101T2211_s01o2_entrega_mercancia');
drop function if exists public._conta_entrega_mercancia(uuid);
alter table public.supplier drop column if exists delivers_goods;
