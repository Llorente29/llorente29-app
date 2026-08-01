-- 20260801T1400_inventory_count_scheduled_for.sql
-- Aplicada: 2026-08-01 (a mano por SQL Editor; la BD ya está en este estado, este
--   fichero es REGISTRO, no re-ejecutar).
-- C1 — Inventario manual programado. scheduled_for = día para el que se PROGRAMA
--   (etiqueta + aviso). NO congela stock: el snapshot se congela cuando el empleado
--   pulsa "Empezar" (build_inventory_count diferido). Nullable, no la lee ningún
--   proceso vivo → cero efecto sobre autoinventario ni conteos existentes.

alter table inventory_count
  add column if not exists scheduled_for date;

-- refrescar el caché de esquema de PostgREST
notify pgrst, 'reload schema';

-- Guard: aborta si la columna no quedó.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'inventory_count' and column_name = 'scheduled_for'
  ) then
    raise exception 'Falta inventory_count.scheduled_for';
  end if;
end $$;
