-- supabase/vuelta-atras/20261024T0040_d01_facturas_correo.down.guarda.sql
--
-- La guarda de la vuelta atrás de la 0100 del 19 (facturas por correo), aparte
-- para probarla sola (supabase/staging/sql/20261119_d01_facturas_correo_prueba.sql).
-- La incluye 20261024T0040_d01_facturas_correo.down.sql. PARA si
-- company_inbound_sender tiene filas: primero va la vuelta atrás de la 0110.
do $$ begin
  if to_regclass('public.company_inbound_sender') is not null and exists (select 1 from public.company_inbound_sender) then
    raise exception 'VUELTA ATRÁS 0100 (facturas por correo) PARADA: company_inbound_sender tiene filas; primero la vuelta atrás de la 0110. No se toca nada.' using errcode = 'P0001';
  end if;
end $$;
