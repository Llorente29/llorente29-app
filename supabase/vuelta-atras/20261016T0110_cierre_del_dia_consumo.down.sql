-- Vuelta atrás de «El día se cierra a las 6:00» · 2 · el stock no vuelve.
-- Devuelve las dos funciones al texto guardado en _backup_cierre_del_dia_consumo
-- (el medido el 09/10) y comprueba sus md5. PARA si falta la copia.
-- OJO: con esto, un pedido cerrado como no confirmado que se reprocese pierde
-- su consumo (vuelve a ser una anulación para el motor).
do $$
declare
  r record;
  v_trg text; v_gen text;
begin
  select prosrc into v_trg from public._backup_cierre_del_dia_consumo where funcion = 'tg_sale_consumption_on_complete()' and md5 = 'eada5e6667c33321dfc384c46f9c2300';
  select prosrc into v_gen from public._backup_cierre_del_dia_consumo where funcion = 'generate_sale_consumption(uuid)' and md5 = 'fa63d5b96be66fbb0238a28599a21656';
  if v_trg is null or v_gen is null then
    raise exception 'Vuelta atrás 0110: falta la copia de alguna de las dos funciones; no se toca nada.';
  end if;
  execute format('create or replace function public.tg_sale_consumption_on_complete() returns trigger language plpgsql security definer set search_path = public as %L', v_trg);
  execute format('create or replace function public.generate_sale_consumption(p_sale_id uuid) returns integer language plpgsql security definer set search_path = public as %L', v_gen);
  for r in select proname, md5(prosrc) m from pg_proc where oid in ('public.tg_sale_consumption_on_complete()'::regprocedure, 'public.generate_sale_consumption(uuid)'::regprocedure) loop
    if r.m not in ('eada5e6667c33321dfc384c46f9c2300', 'fa63d5b96be66fbb0238a28599a21656') then
      raise exception 'Vuelta atrás 0110: % no ha quedado como estaba (md5 %).', r.proname, r.m;
    end if;
  end loop;
end $$;
drop table if exists public._backup_cierre_del_dia_consumo;
