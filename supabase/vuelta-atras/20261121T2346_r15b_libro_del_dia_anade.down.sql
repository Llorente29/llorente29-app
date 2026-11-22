-- R15b · la vuelta atrás de la 2346: todo día repartido (también los nuevos) vuelve a su libro de antes, una fila por
-- tipo (con lo guardado en conta_tpv_libro_antes), y se quita lo que añadió. Va después de la de la 2347.
do $$
declare a record;
begin
  if to_regclass('public.conta_tpv_libro_antes') is not null then
    for a in select distinct entry_id from public.conta_tpv_libro_antes loop
      perform public._conta_tpv_libro_juntar(a.entry_id);
    end loop;
  end if;
end $$;
drop function if exists public.conta_347_ventas_por_cliente(uuid, integer);
drop function if exists public.conta_tpv_emitidas_libro(uuid, date, date);
drop function if exists public.conta_tpv_dia_libro(uuid);
drop function if exists public._conta_tpv_libro_juntar(uuid);
drop function if exists public._conta_tpv_libro_repartir(uuid, uuid, text);
drop function if exists public._conta_tpv_libro_grupos(uuid);
drop table if exists public.conta_tpv_libro_antes;
