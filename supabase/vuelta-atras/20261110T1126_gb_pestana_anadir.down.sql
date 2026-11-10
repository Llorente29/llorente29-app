-- supabase/vuelta-atras/20261110T1126_gb_pestana_anadir.down.sql
-- GB · la vuelta atrás de la 1126: fuera la función y la acción «servicio» (lo
-- apuntado con ella, antes; lo añadido en Sumied se queda: se quita en la ficha).
-- El CHECK vuelve a lo que había antes de la 1126: con «deshacer» si está la 0070
-- (#570) y con «devuelto» y «suelto» si está la 0950 (#581), como en producción,
-- donde van antes; sin ellas, como en una base que aún no las tiene (staging, al
-- probar esta tanda sola).
drop function if exists public.conta_bitrix_pestana_anadir(text, text, text, text, uuid, uuid, uuid, uuid, date, boolean);
delete from public.conta_bitrix_pestana_cambio where accion = 'servicio';
alter table public.conta_bitrix_pestana_cambio drop constraint if exists conta_bitrix_pestana_cambio_accion_check;
do $$
declare v text[] := array['alta', 'baja', 'tarifa'];
begin
  if to_regprocedure('public.conta_bitrix_pestana_deshacer(text,text,text,text,uuid,timestamptz)') is not null then v := v || 'deshacer'::text; end if;
  if to_regprocedure('public.conta_bitrix_pestana_devueltos(text,text,text,text)') is not null then v := v || array['devuelto', 'suelto']; end if;
  execute format('alter table public.conta_bitrix_pestana_cambio add constraint conta_bitrix_pestana_cambio_accion_check check (accion in (%s))',
    (select string_agg(quote_literal(x), ', ') from unnest(v) x));
end $$;
