-- supabase/vuelta-atras/20261124T1552_x14_traer_por_trozos.down.sql
-- X14 · Devuelve conta_traer_cargar, conta_traer_deshacer y _journal_entry_proponer a sus respaldos, quita la cola, las dos
-- funciones de seguir y el margen, y deja el CHECK de import_run como estaba. Con una carga a medias («cargando») no hace
-- nada y lo dice: hay que deshacerla antes, con «Descartar lo leído».
do $$
begin
  if exists (select 1 from public.import_run where status = 'cargando') then
    raise exception 'X14 · vuelta atrás: hay % a medias («cargando»): deshazla antes con «Descartar lo leído».',
      (select case when count(*) = 1 then '1 carga' else count(*) || ' cargas' end from public.import_run where status = 'cargando');
  end if;
end $$;
select public._restaurar_funcion('public.conta_traer_cargar(uuid,text,jsonb,text)', '20261124T1552_x14_traer_por_trozos');
select public._restaurar_funcion('public.conta_traer_deshacer(uuid,text)', '20261124T1552_x14_traer_por_trozos');
select public._restaurar_funcion('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)', '20261124T1552_x14_traer_por_trozos');
drop function if exists public.conta_traer_seguir(uuid);
drop function if exists public._conta_traer_seguir(uuid, timestamptz);
drop function if exists public._conta_traer_margen();
drop table if exists public.conta_traer_trozo;
alter table public.import_run drop constraint if exists import_run_status_check;
alter table public.import_run add constraint import_run_status_check check (status = any (array[
  'en_curso', 'hecho', 'fallido', 'en_prueba', 'dada_por_buena', 'deshecha']::text[]));
