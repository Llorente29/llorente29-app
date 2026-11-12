-- scripts/conta/produccion/cuentas/gb-responsable.sql
--
-- GB · nº 24 (el 7 de Code 3) · LO QUE CUENTA LA TANDA, antes y después. SOLO
-- LEE. La misma vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. La función: false → true.
--   2. Los clientes del CRM NO cambian (la migración no llama a nada).
select clave, valor from (
  select 1 o, 'conta_portal_quien_lleva' clave,
    (to_regprocedure('public.conta_portal_quien_lleva(uuid)') is not null)::text valor union all
  select 2, 'Clientes del CRM (tabla entera, todas las cuentas, con corte de fecha)',
    (select count(*) from public.conta_gestoria_cliente where created_at < timestamptz '2026-11-10 12:00:00+00')::text
) q order by o;
