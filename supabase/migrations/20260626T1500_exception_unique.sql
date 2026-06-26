-- 20260626T1500_exception_unique.sql
-- Aplicada: 2026-06-26 (SQL Editor)
-- Unicidad de excepción por (local, marca, fecha). brand_id NULL = horario
-- general del local; se normaliza a un UUID cero para que el unique también
-- cubra las filas generales (NULL no colisiona consigo mismo en un unique normal).

create unique index if not exists ux_business_hours_exc_unique
on business_hours_exception (location_id, coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), exception_date);
