-- scripts/conta/produccion/cuentas/g05-portal-pagos.sql
--
-- G05 · Portal · el pago de un devuelto desde el portal y el cambio de cuenta ·
-- LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La misma vara a los dos
-- lados (regla 31). Todas las cuentas a propósito (la tanda es de la estructura).
-- Medido antes el 09/11 a las 17:27 UTC (solo lectura). Lo que tiene que pasar:
--   1. conta_recibo_pagado_portal existe: false → true.
--   2. conta_cobro_cuenta_cambiada existe: false → true.
--   3. conta_gestoria_ajustes.cuenta_stripe existe: false → true.
--   4. Cobros apuntados por otra vía (todas las cuentas): 0 → 0.
--   5. La 57200003 «Plataforma Stripe» en las cuentas de demostración: 0 → 1.
--   6. Ajustes de la gestoría (todas las cuentas): 2 → 2.
--   7. Empresas con la cuenta de Stripe puesta en la 57200003 (las de demostración): 0 → 1 (Gestoría Demo, S.L.).
--   8. Incidencias de «Falta la cuenta de Stripe en Ajustes» (todas las cuentas): 0 → 0.
select clave, valor from (
  select 1 o, 'conta_recibo_pagado_portal existe' clave,
    (to_regprocedure('public.conta_recibo_pagado_portal(uuid,text,numeric,text)') is not null)::text valor union all
  select 2, 'conta_cobro_cuenta_cambiada existe',
    (to_regprocedure('public.conta_cobro_cuenta_cambiada(uuid,uuid,text,text,text[],text)') is not null)::text union all
  select 3, 'conta_gestoria_ajustes.cuenta_stripe existe',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gestoria_ajustes' and column_name = 'cuenta_stripe')::text union all
  select 4, 'Cobros apuntados por otra vía (todas las cuentas)',
    -- quieta: solo la escribe «Cobrado por otra vía» a mano en la gestoría (0 filas en toda su vida); la tanda solo amplía su CHECK
    (select count(*)::text from public.conta_gc_cobro_otra_via) union all
  select 5, 'La 57200003 «Plataforma Stripe» en las cuentas de demostración',
    -- quieta: nadie más crea esa subcuenta; solo esta tanda (0 → 1)
    (select count(*)::text from public.company_account x join public.company c on c.id = x.company_id join public.accounts a on a.id = c.account_id and a.is_demo
      where x.code = '57200003') union all
  select 6, 'Ajustes de la gestoría (todas las cuentas)',
    -- quieta: una fila por empresa con cobro, se crea al activarlo a mano; la tanda solo añade una columna vacía
    (select count(*)::text from public.conta_gestoria_ajustes) union all
  select 7, 'Empresas con la cuenta de Stripe puesta en la 57200003 (las de demostración)',
    -- quieta: solo esta tanda la pone (en la demo con cobro); sin la columna, 0
    (select case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gestoria_ajustes' and column_name = 'cuenta_stripe')
       then (select count(*)::text from public.conta_gestoria_ajustes g join public.accounts a on a.id = g.account_id and a.is_demo where to_jsonb(g)->>'cuenta_stripe' = '57200003')
       else '0' end) union all
  select 8, 'Incidencias de «Falta la cuenta de Stripe en Ajustes» (todas las cuentas)',
    -- quieta: solo las escribe un pago con tarjeta desde el portal (aún no hay ninguno)
    (select count(*)::text from public.conta_gestoria_diferencia where tipo = 'falta_cuenta_stripe')
) q order by o;
