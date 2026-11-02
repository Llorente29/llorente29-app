-- supabase/vuelta-atras/20261102T1837_s01q_borrar_asientos.down.sql
--
-- Vuelta atrás de la 1837: fuera las funciones de borrar y deshacer. El registro
-- (conta_asiento_borrado) se queda si guarda algún lote: es el respaldo.
drop function if exists public._conta_asientos_borrado_deshacer(uuid);
drop function if exists public._conta_asientos_borrar(uuid, uuid[], text, text);
drop function if exists public._conta_cadena_rota(uuid);
do $$ begin
  if to_regclass('public.conta_asiento_borrado') is not null and not exists (select 1 from public.conta_asiento_borrado) then
    drop table public.conta_asiento_borrado;
  end if;
end $$;
