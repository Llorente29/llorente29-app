-- Guarda de 20261003T0110_c00_empresa.down.sql: si related_party_kind tiene
-- algún valor, para sin tocar nada. Va aparte para poder probarla sola en
-- staging. SOLO LEE.

do $$
declare n int;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'supplier' and column_name = 'related_party_kind') then
    execute 'select count(*) from public.supplier where related_party_kind is not null' into n;
    if n > 0 then
      raise exception 'VUELTA ATRÁS 0110 (C00): % proveedores tienen related_party_kind puesto; quitarla los perdería. No se toca nada.', n;
    end if;
  end if;
end $$;
