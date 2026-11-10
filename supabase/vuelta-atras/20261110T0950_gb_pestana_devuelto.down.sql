-- supabase/vuelta-atras/20261110T0950_gb_pestana_devuelto.down.sql
--
-- Vuelta atrás de la 0950 del GB: fuera las dos funciones y las acciones
-- «devuelto» y «suelto» (lo apuntado con ellas se borra antes: el CHECK de antes
-- no las admite). Lo hecho con el recibo (el correo, el reintento) se queda: lo
-- hizo conta-cobro.
drop function if exists public.conta_bitrix_pestana_devuelto_hecho(text, text, text, text, uuid, text, text);
drop function if exists public.conta_bitrix_pestana_devueltos(text, text, text, text);
delete from public.conta_bitrix_pestana_cambio where accion in ('devuelto', 'suelto');
alter table public.conta_bitrix_pestana_cambio drop constraint if exists conta_bitrix_pestana_cambio_accion_check;
alter table public.conta_bitrix_pestana_cambio add constraint conta_bitrix_pestana_cambio_accion_check
  check (accion in ('alta', 'baja', 'tarifa', 'deshacer'));
