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
select clave, valor from (
  select 1 o, 'conta_recibo_pagado_portal existe' clave,
    (to_regprocedure('public.conta_recibo_pagado_portal(uuid,text,numeric,text)') is not null)::text valor union all
  select 2, 'conta_cobro_cuenta_cambiada existe',
    (to_regprocedure('public.conta_cobro_cuenta_cambiada(uuid,uuid,text,text,text[],text)') is not null)::text union all
  select 3, 'conta_gestoria_ajustes.cuenta_stripe existe',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gestoria_ajustes' and column_name = 'cuenta_stripe')::text union all
  select 4, 'Cobros apuntados por otra vía (todas las cuentas)',
    (select count(*)::text from public.conta_gc_cobro_otra_via) union all
  select 5, 'La 57200003 «Plataforma Stripe» en las cuentas de demostración',
    (select count(*)::text from public.company_account x join public.company c on c.id = x.company_id join public.accounts a on a.id = c.account_id and a.is_demo
      where x.code = '57200003') union all
  select 6, 'Ajustes de la gestoría (todas las cuentas)',
    (select count(*)::text from public.conta_gestoria_ajustes)
) q order by o;
