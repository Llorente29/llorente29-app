-- scripts/conta/produccion/cuentas/g05-deshacer.sql
--
-- G05 · Deshacer un alta, una baja o un cambio de nivel (nº 69) · LO QUE CUENTA LA
-- TANDA, antes y después. SOLO LEE. La misma vara a los dos lados (regla 31).
-- Medido antes el 09/11 a las 23:13 UTC. Lo que tiene que pasar:
--   1. conta_linea_deshacer existe: false → true.
--   2. conta_linea_operaciones_hoy existe: false → true.
--   3. La tabla conta_linea_deshecha existe: false → true.
--   4. Líneas de los clientes (todas las cuentas, hasta el corte): quieta.
select clave, valor from (
  select 1 o, 'conta_linea_deshacer existe' clave,
    (to_regprocedure('public.conta_linea_deshacer(uuid,uuid,timestamptz)') is not null)::text valor union all
  select 2, 'conta_linea_operaciones_hoy existe',
    (to_regprocedure('public.conta_linea_operaciones_hoy(uuid,uuid)') is not null)::text union all
  select 3, 'La tabla conta_linea_deshecha existe',
    (to_regclass('public.conta_linea_deshecha') is not null)::text union all
  select 4, 'Líneas de los clientes (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.conta_linea where created_at < timestamptz '2026-11-09 00:00:00+00')
) q order by o;
