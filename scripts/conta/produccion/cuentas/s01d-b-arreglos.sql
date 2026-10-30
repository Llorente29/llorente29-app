-- scripts/conta/produccion/cuentas/s01d-b-arreglos.sql
--
-- S01d-b · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. De Foodint
-- (regla 9), sin nombres ni importes. Sin comas en los valores.
--
-- Lo que tiene que pasar:
--   1. bank_contrato_guardar acepta un cuadro parcial: de false a true;
--   2. los contratos de Foodint: los mismos antes y después (la tanda no da ninguno de alta).
select clave, valor from (
  select 1 o, 'alta de contrato con cuadro parcial' clave,
    (to_regprocedure('public.bank_contrato_guardar(uuid,jsonb)') is not null
     and position('v_pendiente' in pg_get_functiondef('public.bank_contrato_guardar(uuid,jsonb)'::regprocedure)) > 0)::text valor union all
  select 2, 'contratos de Foodint',
    -- quieta: solo los da de alta «Subir el cuadro» (Bancos › Préstamos y aplazamientos); el de la TGSS no se puede guardar hasta esta tanda
    (select count(*)::text from public.recurring_contract where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
) q order by o;
