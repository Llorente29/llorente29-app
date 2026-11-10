-- scripts/conta/produccion/cuentas/gd-sumied-por-tandas.sql
--
-- GD · «Volver a empezar» por tandas (nº84) · LO QUE CUENTA LA TANDA, antes y
-- después. SOLO LEE. La misma vara a los dos lados (regla 31). Solo la cuenta
-- demo (de000000-…-a0).
-- Lo que tiene que pasar:
--   1. La función demo_gestoria_volver_a_empezar_tanda: false → true; la de la 1731 sigue: true → true.
--   2. Lo de la demo NO cambia (la migración no la llama): clientes / líneas / subcuentas igual antes y después.
-- Y la vuelta atrás deja todo como antes (el ensayo lo mide).
select clave, valor from (
  select 1 o, 'Las funciones demo_gestoria_volver_a_empezar_tanda / demo_gestoria_volver_a_empezar' clave,
    concat_ws(' / ', (to_regprocedure('public.demo_gestoria_volver_a_empezar_tanda(uuid, integer)') is not null)::text,
                     (to_regprocedure('public.demo_gestoria_volver_a_empezar(uuid)') is not null)::text) valor union all
  select 2, 'Clientes / líneas / subcuentas de la demo',
    -- quieta: solo la cuenta demo, que en el ensayo no toca nadie más
    concat_ws(' / ',
      (select count(*) from public.party where account_id = 'de000000-0000-4000-8000-0000000000a0'),
      (select count(*) from public.conta_linea where account_id = 'de000000-0000-4000-8000-0000000000a0'),
      (select count(*) from public.company_account where account_id = 'de000000-0000-4000-8000-0000000000a0'))
) q order by o;
