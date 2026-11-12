-- supabase/vuelta-atras/20261110T1324_gb_pestana_dia_dni.down.sql
-- GB · la vuelta atrás de la 1324: conta_bitrix_pestana_hacer como estaba (la de la
-- 2250), restaurada de su respaldo (_restaurar_funcion comprueba la huella), y su
-- comentario de antes. Lo hecho con ella se queda (son líneas de Sumied; se deshacen en la ficha).

select public._restaurar_funcion('public.conta_bitrix_pestana_hacer(text, text, text, text, text, jsonb)', '20261110T1324_gb_pestana_dia_dni');

comment on function public.conta_bitrix_pestana_hacer(text, text, text, text, text, jsonb) is
  'GB · Alta y baja de un trabajador, cambio de nivel y precio especial desde la pestaña de Bitrix24. Solo el servidor (conta-bitrix-pestana), DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación. Actúa como la persona («usuario:cuenta») y llama a las funciones de la ficha del G04 (conta_gestoria_alta_empleado, conta_gestoria_baja_linea, conta_tarifa_nivel_cambiar y conta_tarifa_precio_guardar), que comprueban su permiso. Solo sobre el cliente de la ficha abierta.';
