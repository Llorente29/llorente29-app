-- scripts/conta/produccion/cuentas/gd-tarifa-demo.sql
--
-- GD · La tarifa de «Gestoría Demo» · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. La misma vara a los dos lados (regla 31). Solo la cuenta demo
-- (de000000-…-a0): la tanda no toca ninguna otra.
-- Medido antes el 09/11 a las 10:24 UTC (solo lectura). Y la vuelta atrás deja
-- los cinco como antes (el ensayo lo mide). Lo que tiene que pasar:
--   1. La función de la siembra: no → sí.
--   2. Servicios de la demo: 9 → 12 (Nóminas, Cuota de autónomo y Declaración
--      de la renta; los 7 del impuesto de sociedades no se juntan).
--   3. Niveles / precios / paquetes: 0 / 0 / 0 → 3 / 17 / 1.
--   4. Líneas: 67 → 76 (las 9 de la autónoma); de la gestoría mensual con nivel: 0 → 25.
--   5. Precios especiales (de un cliente): 0 → 2.
select clave, valor from (
  select 1 o, 'La función demo_gestoria_tarifa_sembrar' clave,
    (to_regprocedure('public.demo_gestoria_tarifa_sembrar(uuid)') is not null)::text valor union all
  select 2, 'Servicios de la demo',
    -- quieta: solo la cuenta demo, que en el ensayo no toca nadie más
    (select count(*)::text from public.conta_servicio where account_id = 'de000000-0000-4000-8000-0000000000a0') union all
  select 3, 'Niveles / precios / paquetes de la demo',
    -- quieta: solo la cuenta demo, que en el ensayo no toca nadie más
    concat_ws(' / ',
      (select count(*) from public.conta_servicio_nivel where account_id = 'de000000-0000-4000-8000-0000000000a0'),
      (select count(*) from public.conta_precio where account_id = 'de000000-0000-4000-8000-0000000000a0'),
      (select count(*) from public.conta_paquete where account_id = 'de000000-0000-4000-8000-0000000000a0')) union all
  select 4, 'Líneas de la demo · de la gestoría mensual con nivel',
    -- quieta: solo la cuenta demo; un aviso de GoCardless sin cambios de suscripciones no añade líneas
    concat_ws(' · ',
      (select count(*) from public.conta_linea where account_id = 'de000000-0000-4000-8000-0000000000a0'),
      (select count(*) from public.conta_linea l join public.conta_servicio s on s.id = l.servicio_id
        where l.account_id = 'de000000-0000-4000-8000-0000000000a0' and s.clave = 'gestoria_mensual' and l.nivel_id is not null)) union all
  select 5, 'Precios especiales de la demo',
    -- quieta: solo la cuenta demo, que en el ensayo no toca nadie más
    (select count(*)::text from public.conta_precio where account_id = 'de000000-0000-4000-8000-0000000000a0' and party_id is not null)
) q order by o;
