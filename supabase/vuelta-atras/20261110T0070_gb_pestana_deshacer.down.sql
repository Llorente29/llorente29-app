-- supabase/vuelta-atras/20261110T0070_gb_pestana_deshacer.down.sql
--
-- Vuelta atrás de la 0070 del GB: fuera la función y la acción «deshacer» (lo
-- apuntado con ella se borra antes: el CHECK de antes no la admite). Lo deshecho
-- en Sumied sigue deshecho: lo hizo la función de Code 1.
drop function if exists public.conta_bitrix_pestana_deshacer(text, text, text, text, uuid, timestamptz);
delete from public.conta_bitrix_pestana_cambio where accion = 'deshacer';
alter table public.conta_bitrix_pestana_cambio drop constraint if exists conta_bitrix_pestana_cambio_accion_check;
alter table public.conta_bitrix_pestana_cambio add constraint conta_bitrix_pestana_cambio_accion_check
  check (accion in ('alta', 'baja', 'tarifa'));
