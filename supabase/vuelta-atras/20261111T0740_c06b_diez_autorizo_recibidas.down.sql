-- supabase/vuelta-atras/20261111T0740_c06b_diez_autorizo_recibidas.down.sql
--
-- Vuelta atrás de 20261111T0740: fuera la columna incluye_recibidas.
--
-- ANTES, ojo: conta-diez-enviar de esta versión lee la columna; sin ella no
-- puede leer las autorizaciones y deja Diez real cerrado para todo (lo dice,
-- no escribe). Y la versión anterior a la 0740 NO distingue recibidas: con
-- una autorización de empresa las abriría. Así que, si hay una autorización
-- de empresa, deshacer esto pide antes quitar esa fila o dejar la función
-- desplegada sin autorizaciones de empresa.
--
-- PARA si alguna autorización abre ya las recibidas: es una decisión de Julio
-- que se perdería callando.
do $$
declare n int;
begin
  select count(*) into n from public.conta_diez_autorizo where incluye_recibidas;
  if n > 0 then
    raise exception 'Vuelta atrás de la 0740: % autorizaciones abren las recibidas. No se toca nada.', n;
  end if;
end $$;
alter table public.conta_diez_autorizo drop column if exists incluye_recibidas;
