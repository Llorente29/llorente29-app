-- scripts/conta/produccion/cuentas/g05-alta-baja-dia.sql
--
-- G05 · Alta y baja con su día y su DNI o NIE (nº 77, punto 1) · LO QUE CUENTA LA
-- TANDA, antes y después. SOLO LEE. La misma vara a los dos lados (regla 31).
-- Medido antes el 10/11 a las 10:09 UTC. Lo que tiene que pasar:
--   1. conta_gestoria_alta_trabajador existe: false → true.
--   2. conta_gestoria_baja_trabajador existe: false → true.
--   3. La columna conta_linea.empleado_documento existe: false → true.
--   4. Líneas de los clientes (todas las cuentas, hasta el corte): quieta (384).
select clave, valor from (
  select 1 o, 'conta_gestoria_alta_trabajador existe' clave,
    (to_regprocedure('public.conta_gestoria_alta_trabajador(uuid,uuid,uuid,text,date,text)') is not null)::text valor union all
  select 2, 'conta_gestoria_baja_trabajador existe',
    (to_regprocedure('public.conta_gestoria_baja_trabajador(uuid,date)') is not null)::text union all
  select 3, 'La columna conta_linea.empleado_documento existe',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_linea' and column_name = 'empleado_documento')::text union all
  select 4, 'Líneas de los clientes (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.conta_linea where created_at < timestamptz '2026-11-10 10:00:00+00')
) q order by o;
