-- supabase/vuelta-atras/20261108T1511_g04_servicio_crear.down.sql
--
-- G04 · La vuelta atrás de la 1511: fuera la función «+ Crear › Servicio» y
-- los servicios que creó (su clave empieza por «g04:»), con sus precios y sus
-- niveles (se van en cascada). Un servicio creado que ya cobra a algún cliente
-- (una línea en conta_linea) o que está dentro de un paquete NO se borra: es
-- trabajo de alguien, y se dice cuántos quedan.
-- sin prueba con datos: la prueba de staging (20261108_g04_servicio_crear_prueba.sql) la pasa en ROLLBACK, con datos inventados, y comprueba que quita lo creado y deja lo que está en uso.

do $$
declare v_borrados int; v_quedan int;
begin
  if to_regclass('public.conta_servicio') is null then return; end if;
  delete from public.conta_servicio s
   where s.clave like 'g04:%'
     and not exists (select 1 from public.conta_linea l where l.servicio_id = s.id)
     and not exists (select 1 from public.conta_paquete_linea pl where pl.servicio_id = s.id);
  get diagnostics v_borrados = row_count;
  select count(*) into v_quedan from public.conta_servicio where clave like 'g04:%';
  raise notice 'Vuelta atrás de la 1511: % servicios creados borrados; % se quedan porque ya cobran a algún cliente o están en un paquete.', v_borrados, v_quedan;
end $$;

drop function if exists public.conta_tarifa_servicio_crear(uuid, text, text, text, numeric, jsonb, date, boolean);
