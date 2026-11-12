-- scripts/conta/produccion/cuentas/gd-banco-demo.sql
--
-- GD · El banco de la demo termina como la cuenta de abono del sandbox · LO QUE
-- CUENTA LA TANDA, antes y después. SOLO LEE. La misma vara a los dos lados
-- (regla 31). Solo la cuenta demo (de000000-…-a0).
-- Medido antes el 09/11 a las 14:08 UTC (solo lectura). Lo que tiene que pasar:
--   1. La función de la siembra: no → sí.
--   2. En qué termina el banco por defecto de la sociedad / el de la autónoma: 01 / 02 → 56 / 02.
-- Y la vuelta atrás deja los dos como antes (el ensayo lo mide).
-- (El aviso naranja del abono lo quita la próxima lectura de GoCardless, no la tanda.)
select clave, valor from (
  select 1 o, 'La función demo_gestoria_banco_sembrar' clave,
    (to_regprocedure('public.demo_gestoria_banco_sembrar(uuid)') is not null)::text valor union all
  select 2, 'En qué termina el banco de la sociedad / el de la autónoma',
    -- quieta: solo la cuenta demo, que en el ensayo no toca nadie más
    concat_ws(' / ',
      (select right(iban, 2) from public.treasury_account where company_id = 'de000000-0000-4000-8000-0000000000a9' and kind = 'bank' and is_default),
      (select right(iban, 2) from public.treasury_account where company_id = 'de000000-0000-4000-8000-0000000000b9' and kind = 'bank' and is_default))
) q order by o;
