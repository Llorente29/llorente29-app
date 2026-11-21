-- supabase/vuelta-atras/20261121T1700_x24_proveedor_sin_nif.down.sql
--
-- X24 · Vuelta atrás de la 1700: las dos funciones, las de antes (de su respaldo), y la columna que añadió
-- (conta_proveedor_solo.nif_completado), para que todo quede como estaba. Lo que se completó con ella ya no se
-- podrá «Deshacer» desde la ficha: si hace falta, antes de la vuelta atrás, «Deshacer» en cada factura.
select public._restaurar_funcion('public._conta_proveedor_solo_deshacer(uuid,text)', '20261121T1700_x24_proveedor_sin_nif');
select public._restaurar_funcion('public._conta_proveedor_solo(uuid,text)', '20261121T1700_x24_proveedor_sin_nif');
alter table public.conta_proveedor_solo drop column if exists nif_completado;
