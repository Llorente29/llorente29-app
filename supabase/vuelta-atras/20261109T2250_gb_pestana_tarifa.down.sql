-- supabase/vuelta-atras/20261109T2250_gb_pestana_tarifa.down.sql
--
-- Vuelta atrás de la 2250 del GB: conta_bitrix_pestana_hacer como estaba antes
-- (del respaldo que guarda la 2250) y el CHECK de antes. Si hay cambios «tarifa» apuntados, el
-- CHECK de antes no entra: se quitan antes sus apuntes (los cambios de tarifa
-- siguen en Sumied: son de la ficha; solo se pierde el registro de la pestaña).
delete from public.conta_bitrix_pestana_cambio where accion = 'tarifa';
alter table public.conta_bitrix_pestana_cambio drop constraint if exists conta_bitrix_pestana_cambio_accion_check;
alter table public.conta_bitrix_pestana_cambio add constraint conta_bitrix_pestana_cambio_accion_check check (accion in ('alta', 'baja'));

select public._restaurar_funcion('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)', '20261109T2250_gb_pestana_tarifa');
