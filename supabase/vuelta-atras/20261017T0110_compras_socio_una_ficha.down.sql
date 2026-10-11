-- ============================================================================
-- Vuelta atrás de Compras · 2 · el socio, una sola ficha.
-- Deshace las cuatro uniones al socio que hizo la 0110, de la última a la
-- primera, con _supplier_merge_undo: cada fila vuelve a su ficha, la ficha
-- que queda pierde lo que se le rellenó y las otras cuatro dejan de estar
-- archivadas. En otra base (staging) no encuentra nada y no hace nada.
-- ============================================================================
do $$
declare r record;
begin
  for r in select id, summary from public.supplier_merge
            where kept_supplier_id = '8d53a379-1aa6-4c49-a7aa-dcfaeb353b5e' and undone_at is null
              and done_by_name = 'Migración 20261017T0110 (orden de Julio, 10/10)'
            order by done_at desc, id desc loop
    perform public._supplier_merge_undo(r.id, 'Vuelta atrás de 20261017T0110');
    raise notice 'Deshecha: %', r.summary;
  end loop;
end $$;
