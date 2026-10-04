-- ============================================================================
-- VUELTA ATRÁS de 20261006T0110_c01b_datos.sql
-- Quita lo que puso, y SOLO eso, según c01b_movimiento_registro: los contactos
-- y las propuestas de dirección creados, y los IVA convertidos. Los datos
-- vuelven a estar solo en las columnas viejas, que no se tocaron.
-- Para si las columnas viejas ya no existen (se aplicó la eliminación).
-- ============================================================================
do $$
declare
  v_contactos int; v_propuestas int; v_iva int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'supplier' and column_name = 'email') then
    raise exception 'C01b 0110 vuelta atrás: supplier.email ya no existe. Primero la vuelta atrás de la eliminación.';
  end if;

  delete from public.supplier_contact c
   where c.id in (select destino_id from public.c01b_movimiento_registro where destino = 'supplier_contact');
  get diagnostics v_contactos = row_count;

  delete from public.supplier_proposal p
   where p.id in (select destino_id from public.c01b_movimiento_registro where destino = 'supplier_proposal');
  get diagnostics v_propuestas = row_count;

  update public.supplier s set usual_tax_rate_ids = '{}'
   where s.id in (select supplier_id from public.c01b_movimiento_registro where destino = 'supplier.usual_tax_rate_ids');
  get diagnostics v_iva = row_count;

  delete from public.c01b_movimiento_registro;
  raise notice 'C01b 0110 deshecha: % contactos, % propuestas y % proveedores con IVA vuelven a como estaban.', v_contactos, v_propuestas, v_iva;
end $$;
