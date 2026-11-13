-- supabase/vuelta-atras/20261113T1910_s01p_me_lo_factura_otro.down.sql
--
-- S01p·20·2 · la vuelta atrás de lo que añade: fuera el botón. La columna se queda si algún
-- proveedor ya tiene quién se lo factura (es una decisión de la pantalla, que se deshace eligiendo
-- otra forma); si está vacía, se quita. Va DESPUÉS de la de la 20261114T0033.
drop function if exists public.compras_lo_factura_otro(uuid, uuid);
do $$ begin
  if not exists (select 1 from public.supplier where invoiced_by_supplier_id is not null) then
    alter table public.supplier drop column invoiced_by_supplier_id;
  end if;
end $$;
