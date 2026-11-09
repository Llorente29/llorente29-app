-- scripts/conta/produccion/cuentas/g05-apuntar-pendiente.sql
--
-- G05 · Apuntar el pago pendiente y la cuenta de Stripe en Ajustes · LO QUE
-- CUENTA LA TANDA, antes y después. SOLO LEE. La misma vara a los dos lados
-- (regla 31). Todas las cuentas a propósito (la tanda es de la estructura).
-- Medido antes el 09/11 a las 19:30 UTC (solo lectura). Lo que tiene que pasar:
--   1. conta_cobro_cuenta_stripe_poner existe: false → true.
--   2. conta_recibo_apuntar_pendiente existe: false → true.
--   3. conta_cobro_cuenta_stripe_leer existe: false → true.
--   6. conta_cobro_apuntar_pendientes existe: false → true.
--   4. Incidencias de «Falta la cuenta de Stripe en Ajustes» (todas las cuentas): 0 → 0.
--   5. Empresas con la cuenta de Stripe puesta (todas las cuentas): 1 → 1 (Gestoría Demo, S.L.).
select clave, valor from (
  select 1 o, 'conta_cobro_cuenta_stripe_poner existe' clave,
    (to_regprocedure('public.conta_cobro_cuenta_stripe_poner(uuid,text)') is not null)::text valor union all
  select 2, 'conta_recibo_apuntar_pendiente existe',
    (to_regprocedure('public.conta_recibo_apuntar_pendiente(uuid)') is not null)::text union all
  select 3, 'conta_cobro_cuenta_stripe_leer existe',
    (to_regprocedure('public.conta_cobro_cuenta_stripe_leer(uuid)') is not null)::text union all
  select 4, 'Incidencias de «Falta la cuenta de Stripe en Ajustes» (todas las cuentas)',
    -- quieta: solo las escribe un pago con tarjeta desde el portal (aún no hay ninguno); la tanda no las toca
    (select count(*)::text from public.conta_gestoria_diferencia where tipo = 'falta_cuenta_stripe') union all
  select 5, 'Empresas con la cuenta de Stripe puesta (todas las cuentas)',
    -- quieta: la pone una persona en Ajustes del cobro (aún no hay pantalla); la tanda no la toca
    (select count(*)::text from public.conta_gestoria_ajustes where cuenta_stripe is not null) union all
  select 6, 'conta_cobro_apuntar_pendientes existe',
    (to_regprocedure('public.conta_cobro_apuntar_pendientes(uuid)') is not null)::text
) q order by o;
