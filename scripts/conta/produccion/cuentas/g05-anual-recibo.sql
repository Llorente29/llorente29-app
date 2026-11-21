-- scripts/conta/produccion/cuentas/g05-anual-recibo.sql
--
-- G05 · Una anual, entera y solo en su mes (nº 89) · LO QUE CUENTA LA TANDA, antes
-- y después. SOLO LEE. La misma vara a los dos lados (regla 31). Medido antes el
-- 10/11 a las 16:22 UTC. Lo que tiene que pasar:
--   1. conta_linea_al_mes cuenta la anual en su mes: false → true.
--   2. Líneas anuales vigentes (todas las cuentas, hasta el corte): quieta.
--   3. Recibos (todas las cuentas, preparados hasta el corte): quieta (4).
select clave, valor from (
  select 1 o, 'conta_linea_al_mes cuenta la anual en su mes' clave,
    (pg_get_functiondef('public.conta_linea_al_mes(uuid,date)'::regprocedure) ~ 'v_su_mes')::text valor union all
  select 2, 'Líneas anuales vigentes (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.conta_linea where periodo = 'anio' and (hasta is null or hasta >= date '2026-11-01') and created_at < timestamptz '2026-11-10 16:20:00+00') union all
  select 3, 'Recibos (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.conta_recibo where preparado_at < timestamptz '2026-11-10 16:20:00+00')
) q order by o;
