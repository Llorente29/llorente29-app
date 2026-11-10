-- supabase/vuelta-atras/20261110T1126_gb_pestana_anadir.down.sql
-- GB · la vuelta atrás de la 1126: fuera la función y la acción «servicio» (lo apuntado con ella, antes; lo añadido en Sumied se queda: se quita en la ficha).
drop function if exists public.conta_bitrix_pestana_anadir(text, text, text, text, uuid, uuid, uuid, uuid, date, boolean);
delete from public.conta_bitrix_pestana_cambio where accion = 'servicio';
alter table public.conta_bitrix_pestana_cambio drop constraint if exists conta_bitrix_pestana_cambio_accion_check;
alter table public.conta_bitrix_pestana_cambio add constraint conta_bitrix_pestana_cambio_accion_check
  check (accion in ('alta', 'baja', 'tarifa', 'deshacer', 'devuelto', 'suelto'));
