-- scripts/conta/produccion/cuentas/g05-trabajo-suelto.sql
--
-- G05 · Un trabajo suelto sumado al recibo (nº 71, punto 3) · LO QUE CUENTA LA
-- TANDA, antes y después. SOLO LEE. La misma vara a los dos lados (regla 31).
-- Medido antes el 10/11 a las 05:56 UTC. Lo que tiene que pasar:
--   1. conta_trabajo_suelto_poner existe: false → true.
--   2. conta_trabajos_sueltos existe: false → true.
--   3. Líneas «suelto» (todas las cuentas, hasta el corte): quieta (0).
select clave, valor from (
  select 1 o, 'conta_trabajo_suelto_poner existe' clave,
    (to_regprocedure('public.conta_trabajo_suelto_poner(uuid,uuid,uuid,text,numeric)') is not null)::text valor union all
  select 2, 'conta_trabajos_sueltos existe',
    (to_regprocedure('public.conta_trabajos_sueltos(uuid,uuid)') is not null)::text union all
  select 3, 'Líneas «suelto» (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.conta_linea where tipo = 'suelto' and created_at < timestamptz '2026-11-10 05:50:00+00')
) q order by o;
