-- La guarda de la vuelta atrás de B01 · 5 (tarjetas), aparte para probarla
-- sola (supabase/staging/sql/20261101_b01_vuelta_atras_prueba.sql). La incluye
-- 20261101T0140_b01_tarjetas.down.sql. PARA si hay tickets enlazados a un
-- movimiento: son justificantes, y quitar la columna se llevaría el enlace.
do $$
begin
  if exists (select 1 from public.bank_movement where receipt_path is not null) then
    raise exception 'Hay tickets enlazados a movimientos: guárdalos antes de quitar las tarjetas.';
  end if;
end $$;
