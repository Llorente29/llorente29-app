-- supabase/vuelta-atras/20261121T1700_x24_proveedor_sin_nif.down.sql
--
-- X24 · Vuelta atrás de la 1700: las dos funciones, las de antes (de su respaldo). La columna nif_completado se
-- queda (solo añade; sin ella las de antes funcionan igual).
select public._restaurar_funcion('public._conta_proveedor_solo_deshacer(uuid,text)', '20261121T1700_x24_proveedor_sin_nif');
select public._restaurar_funcion('public._conta_proveedor_solo(uuid,text)', '20261121T1700_x24_proveedor_sin_nif');
