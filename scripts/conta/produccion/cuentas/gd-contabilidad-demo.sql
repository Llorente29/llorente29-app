-- scripts/conta/produccion/cuentas/gd-contabilidad-demo.sql
--
-- GD · La contabilidad de «Gestoría Demo» · LO QUE CUENTA LA TANDA, antes y
-- después. SOLO LEE. La misma vara a los dos lados (regla 31). Solo la cuenta
-- demo (de000000-…-a0): la tanda no toca ninguna otra.
-- Medido antes el 09/11 a las 11:15 UTC (solo lectura). Lo que tiene que pasar
-- (el «después», medido en staging con la misma siembra):
--   1. La función de la siembra: no → sí.
--   2. Subcuentas / enlaces del plan: 0 / 0 → unas 1.250 / unos 50 (el plan de
--      pymes de 8 cifras de las dos empresas, más las 3 de GoCardless).
--   3. Las subcuentas de QBO en la sociedad (57200000, 57200002, 70500000,
--      47700021, 40000015 y 62900007): 0 → 6.
--   4. Ejercicios 2026 abiertos / actividades / series «1»: 0 / 0 / 0 → 2 / 2 / 2.
--   5. Modelos: vacíos → los de QBO (sociedad 9, autónoma 5).
--   6. Ajustes de cobro con el código «lo pone Sumied» y la serie «1»: 0 → 2.
--   7. Asientos de la demo: 0 → 0 (la siembra no asienta nada).
-- Y la vuelta atrás deja los siete como antes (el ensayo lo mide).
select clave, valor from (
  select 1 o, 'La función demo_gestoria_contabilidad_sembrar' clave,
    (to_regprocedure('public.demo_gestoria_contabilidad_sembrar(uuid)') is not null)::text valor union all
  select 2, 'Subcuentas / enlaces del plan de la demo',
    -- quieta: solo la cuenta demo, que en el ensayo no toca nadie más
    concat_ws(' / ', (select count(*) from public.company_account where account_id = 'de000000-0000-4000-8000-0000000000a0'),
                     (select count(*) from public.company_account_link where account_id = 'de000000-0000-4000-8000-0000000000a0')) union all
  select 3, 'Las subcuentas de QBO en la sociedad',
    -- quieta: solo la cuenta demo, que en el ensayo no toca nadie más
    (select count(*)::text from public.company_account where company_id = 'de000000-0000-4000-8000-0000000000a9'
      and code in ('57200000', '57200002', '70500000', '47700021', '40000015', '62900007')) union all
  select 4, 'Ejercicios 2026 abiertos / actividades / series «1»',
    -- quieta: solo la cuenta demo, que en el ensayo no toca nadie más
    concat_ws(' / ', (select count(*) from public.fiscal_year where account_id = 'de000000-0000-4000-8000-0000000000a0' and code = '2026' and status = 'open'),
                     (select count(*) from public.company_activity where account_id = 'de000000-0000-4000-8000-0000000000a0'),
                     (select count(*) from public.invoice_series where account_id = 'de000000-0000-4000-8000-0000000000a0' and code = '1')) union all
  select 5, 'Modelos de la sociedad / de la autónoma',
    -- quieta: solo la cuenta demo, que en el ensayo no toca nadie más
    concat_ws(' / ', (select cardinality(tax_forms) from public.company_tax_profile where company_id = 'de000000-0000-4000-8000-0000000000a9'),
                     (select cardinality(tax_forms) from public.company_tax_profile where company_id = 'de000000-0000-4000-8000-0000000000b9')) union all
  select 6, 'Ajustes de cobro con el código «lo pone Sumied» y la serie «1»',
    -- quieta: solo la cuenta demo, que en el ensayo no toca nadie más
    (select count(*)::text from public.conta_gestoria_ajustes where account_id = 'de000000-0000-4000-8000-0000000000a0' and codigo_cliente_modo = 'sumied' and serie_cobro = '1') union all
  select 7, 'Asientos de la demo',
    -- quieta: solo la cuenta demo, que nadie asienta en el ensayo
    (select count(*)::text from public.journal_entry where account_id = 'de000000-0000-4000-8000-0000000000a0')
) q order by o;
