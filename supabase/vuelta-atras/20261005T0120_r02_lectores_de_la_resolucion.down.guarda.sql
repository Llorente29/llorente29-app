-- Guarda de 20261005T0120_r02_lectores_de_la_resolucion.down.sql: las
-- funciones de antes leen brand.own_delivery_enabled. Si la columna ya no
-- está (se aplicó la 0200), primero va la vuelta atrás de la 0200. SOLO LEE.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'brand' and column_name = 'own_delivery_enabled') then
    raise exception 'VUELTA ATRÁS 0120 (R02): brand.own_delivery_enabled no existe. Primero la vuelta atrás de 20261005T0200. No se toca nada.';
  end if;
  -- Los feeds de antes llaman a marca_reparte_propio: tiene que existir.
  if to_regprocedure('public.marca_reparte_propio(public.brand)') is null then
    raise exception 'VUELTA ATRÁS 0120 (R02): marca_reparte_propio no existe. Primero la vuelta atrás de 20261005T0200. No se toca nada.';
  end if;
end $$;
