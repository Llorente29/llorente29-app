-- scripts/conta/produccion/cuentas/s01d-bancos-retenciones.sql
--
-- S01d · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. De Foodint
-- (regla 9), sin nombres, NIF ni importes. Sin comas en los valores (el
-- workflow parte cada línea por la última coma).
--
-- Lo que tiene que pasar:
--   1. las funciones nuevas (pago de un modelo · lo pagado · alta de contrato): de false a true;
--   2. el modelo de las dos subcuentas de la 4751 de Foodint: de «no está» a 111 · 115;
--   3. los contratos de Foodint: 0 antes y después (la tanda no da ninguno de alta).
select clave, valor from (
  select 1 o, 'funciones nuevas (pago de un modelo · lo pagado · alta de contrato)' clave,
    concat_ws(' · ', (to_regprocedure('public.conta_apunte_pago_modelo(uuid,int,text,text)') is not null)::text,
                     (to_regprocedure('public.conta_modelo_pagado(uuid,text,text)') is not null)::text,
                     (to_regprocedure('public.bank_contrato_guardar(uuid,jsonb)') is not null)::text) valor union all
  select 2, 'modelo de 47510000 · 47510019',
    -- quieta: la columna nace con la 0855 y solo la escribe la 0901 (no hay pantalla que la cambie todavía)
    case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_account' and column_name = 'withholding_model') then 'no está'
         else (select concat_ws(' · ', coalesce(max(to_jsonb(a) ->> 'withholding_model') filter (where a.code = '47510000'), '—'),
                                      coalesce(max(to_jsonb(a) ->> 'withholding_model') filter (where a.code = '47510019'), '—'))
                 from public.company_account a where a.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and a.code in ('47510000', '47510019')) end union all
  select 3, 'contratos de Foodint',
    -- quieta: solo los da de alta «Subir el cuadro» (bank_contrato_guardar), que nace con la 0935 y no tiene pantalla en producción hasta fusionar
    (select count(*)::text from public.recurring_contract where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
) q order by o;
