-- R15b · la vuelta atrás de la 2350: los días que ella rehízo (origen «rehecho») vuelven a su libro de antes,
-- una fila por tipo, con lo guardado en conta_tpv_libro_antes. Los repartidos al validar (días nuevos) se quedan.
do $$
declare a record; v_dias int := 0;
begin
  for a in select distinct entry_id from public.conta_tpv_libro_antes where origen = 'rehecho' loop
    perform public._conta_tpv_libro_juntar(a.entry_id);
    v_dias := v_dias + 1;
  end loop;
  raise notice 'R15b · vuelta atrás de la 2350: % días vuelven a su libro de antes.', v_dias;
end $$;
