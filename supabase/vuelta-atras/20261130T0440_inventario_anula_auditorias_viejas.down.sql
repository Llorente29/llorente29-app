-- supabase/vuelta-atras/20261130T0440_inventario_anula_auditorias_viejas.down.sql
--
-- Vuelta atrás de la 0440: devuelve cada inventario anulado a su estado, sus
-- notas y su fecha de antes, desde la copia, y quita la copia. Solo los que
-- siguen anulados: si alguien ha tocado uno después, no se deshace a medias y
-- se dice.
do $$
declare v_n int; v_total int;
begin
  select count(*) into v_total from public.inventario_anulacion_20261021;
  update public.inventory_count ic
     set status = a.status_antes, notes = a.notes_antes, updated_at = a.updated_at_antes
    from public.inventario_anulacion_20261021 a
   where a.inventory_count_id = ic.id and a.account_id = ic.account_id and ic.status = 'anulado';
  get diagnostics v_n = row_count;
  if v_n <> v_total then
    raise exception 'vuelta atrás 0440: de % anulados solo % seguían anulados; no se deshace a medias.', v_total, v_n;
  end if;
  raise notice 'vuelta atrás 0440: % inventarios devueltos a como estaban.', v_n;
end $$;
drop table public.inventario_anulacion_20261021;
