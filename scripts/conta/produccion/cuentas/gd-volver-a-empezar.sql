-- scripts/conta/produccion/cuentas/gd-volver-a-empezar.sql
--
-- GD · «Volver a empezar», la parte de Sumied · LO QUE CUENTA LA TANDA, antes y
-- después. SOLO LEE. La misma vara a los dos lados (regla 31). Solo la cuenta
-- demo (de000000-…-a0).
-- Medido antes el 09/11 a las 16:20 UTC (solo lectura). Lo que tiene que pasar:
--   1. Las funciones _gd_se_queda / demo_gestoria_volver_a_empezar: false / false → true / true.
--   2. Lo de la demo NO cambia (la migración no la llama): clientes / líneas / subcuentas igual antes y después.
-- Y la vuelta atrás deja todo como antes (el ensayo lo mide).
select clave, valor from (
  select 1 o, 'Las funciones _gd_se_queda / demo_gestoria_volver_a_empezar' clave,
    concat_ws(' / ', (to_regprocedure('public._gd_se_queda()') is not null)::text,
                     (to_regprocedure('public.demo_gestoria_volver_a_empezar(uuid)') is not null)::text) valor union all
  select 2, 'Clientes / líneas / subcuentas de la demo',
    -- quieta: solo la cuenta demo, que en el ensayo no toca nadie más
    concat_ws(' / ',
      (select count(*) from public.party where account_id = 'de000000-0000-4000-8000-0000000000a0'),
      (select count(*) from public.conta_linea where account_id = 'de000000-0000-4000-8000-0000000000a0'),
      (select count(*) from public.company_account where account_id = 'de000000-0000-4000-8000-0000000000a0'))
) q order by o;
