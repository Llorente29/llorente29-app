-- 20260801T1200_inventory_count_asignacion.sql
-- Aplicada: 2026-08-01 (a mano por SQL Editor; el editor descarta begin/commit).
-- Objetivo: permitir CREAR + ASIGNAR inventarios manuales (inicial / de seguridad)
--   a un empleado y un local concretos desde Folvy web, SIN tocar el autoinventario.
-- Aislamiento: estos conteos nacen con kind='full' (inicial / seguridad-todas) o
--   kind='audit' (seguridad de zonas); NUNCA 'cycle' -> la query fija de
--   MiAutoinventario (kind='cycle' AND created_at>=hoy) no los ve. Cero cambios en
--   generate_daily_count / autoinventory_queue / build_inventory_count.
-- Vía A: la asignación vive en la CABECERA (inventory_count.assigned_employee_id),
--   NO en el assigned_to por línea (ese es el carril del autoinventario). Un
--   inventario = un empleado.

-- 1a: columnas de asignación + alcance por zonas (scope_area_ids null = almacén entero)
alter table inventory_count
  add column if not exists assigned_employee_id uuid references employees(id),
  add column if not exists assigned_at           timestamptz,
  add column if not exists assigned_by           uuid,
  add column if not exists scope_area_ids        uuid[];

-- 1b: índice para listar "los inventarios asignados a un empleado"
create index if not exists idx_inventory_count_assigned_employee
  on inventory_count (assigned_employee_id)
  where assigned_employee_id is not null;

-- 1c: refrescar el caché de esquema de PostgREST (si no, el front no ve las columnas)
notify pgrst, 'reload schema';

-- Guard: aborta si algún objeto no quedó (1ª red; la verdad es la query independiente).
do $$
begin
  if (select count(*) from information_schema.columns
       where table_name = 'inventory_count'
         and column_name in ('assigned_employee_id','assigned_at','assigned_by','scope_area_ids')) <> 4 then
    raise exception 'Faltan columnas de asignacion en inventory_count';
  end if;
  if not exists (select 1 from pg_indexes
                  where tablename = 'inventory_count'
                    and indexname = 'idx_inventory_count_assigned_employee') then
    raise exception 'Falta idx_inventory_count_assigned_employee';
  end if;
end $$;
