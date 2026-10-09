-- Vuelta atrás de «El día se cierra a las 6:00» · 3 · no proponer un día sin cerrar.
-- Devuelve las dos funciones al texto guardado (el medido el 09/10) y comprueba sus md5.
do $$
declare v_dias text; v_ped text; r record;
begin
  select prosrc into v_dias from public._backup_cierre_del_dia_proponer where md5 = '87ec3f1d01604aba8e0477a869814bc5';
  select prosrc into v_ped  from public._backup_cierre_del_dia_proponer where md5 = 'a4f6598329b5f746f813e7f5a43eb143';
  if v_dias is null or v_ped is null then
    raise exception 'Vuelta atrás 0120: falta la copia de alguna de las dos funciones; no se toca nada.';
  end if;
  execute format('create or replace function public.conta_dias_por_asentar(p_company uuid, p_desde date, p_hasta date) returns table (location_id uuid, dia date, pedidos bigint) language sql stable set search_path = public as %L', v_dias);
  execute format('create or replace function public.conta_pedidos_del_dia(p_company uuid, p_location uuid, p_dia date) returns table (id uuid, codigo text, canal_id uuid, marca_id uuid, propia boolean, estado text, total numeric, base numeric, cuota numeric, tipos numeric[]) language sql stable set search_path = public as %L', v_ped);
  for r in select p.oid::regprocedure::text f, md5(p.prosrc) m from pg_proc p
            where p.oid in ('public.conta_dias_por_asentar(uuid,date,date)'::regprocedure, 'public.conta_pedidos_del_dia(uuid,uuid,date)'::regprocedure) loop
    if r.m not in ('87ec3f1d01604aba8e0477a869814bc5', 'a4f6598329b5f746f813e7f5a43eb143') then
      raise exception 'Vuelta atrás 0120: % no ha quedado como estaba (md5 %).', r.f, r.m;
    end if;
  end loop;
end $$;
drop table if exists public._backup_cierre_del_dia_proponer;
