-- supabase/vuelta-atras/20261111T0730_c06b_diez_autorizo_desde.down.sql
--
-- Vuelta atrás de 20261111T0730: fuera la columna «desde» y su CHECK.
-- PARA si alguna autorización ya lleva fecha: quitarla convertiría «empresa
-- desde una fecha» en «empresa, cualquier fecha», que es MÁS de lo que Julio
-- autorizó. Eso no se deshace callando: primero se quita esa fila.
do $$
declare n int;
begin
  select count(*) into n from public.conta_diez_autorizo where desde is not null;
  if n > 0 then
    raise exception 'Vuelta atrás de la 0730: % autorizaciones llevan fecha «desde»; sin la columna valdrían para cualquier fecha. No se toca nada.', n;
  end if;
end $$;
alter table public.conta_diez_autorizo drop constraint if exists conta_diez_autorizo_desde_check;
alter table public.conta_diez_autorizo drop column if exists desde;
