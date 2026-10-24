-- scripts/conta/produccion/cuentas/c11c-rehecho-a-diez.sql
--
-- C11c (24/10) · LO QUE CUENTA LA TANDA DEL REHECHO A DIEZ, antes y después.
-- SOLO LEE. TABLA ENTERA, a propósito y dicho (regla 9): los envíos a Diez de
-- todas las empresas (hoy, todos de Foodint).
--
-- Después del real: los envíos, como antes (la tanda no toca ninguno); la
-- función, puesta. Después del despliegue de conta-diez-cola: los pendientes
-- que chocaban con external_send_ext_uq, en 0.
select clave, valor from (
  select 1 o, 'envíos a Diez no rechazados' clave, (select count(*) from public.external_send where status <> 'rechazado')::text valor union all
  select 2, 'envíos pendientes que chocan con external_send_ext_uq',
         (select count(*) from public.external_send where status = 'pendiente' and last_error like '%external_send_ext_uq%')::text union all
  select 3, 'conta_diez_numero_vez puesta', (to_regprocedure('public.conta_diez_numero_vez(uuid, text)') is not null)::text
) t order by o;
