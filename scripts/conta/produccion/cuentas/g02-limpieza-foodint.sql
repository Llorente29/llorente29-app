-- scripts/conta/produccion/cuentas/g02-limpieza-foodint.sql
--
-- G02 · Quitar de Foodint las dos empresas de prueba de QBO · LO QUE CUENTA LA
-- TANDA, antes y después. SOLO LEE. La misma vara a los dos lados (regla 31).
-- Medido antes el 06/11 a las 12:30 UTC. Lo que tiene que pasar:
--   1. Empresas de Foodint (dadas de alta antes de las 12:00 del 06/11): 3 → 1.
--   2 a 17. Lo de las dos empresas de prueba, tabla a tabla: lo medido → 0.
--   18. Foodint, marcada como asesoría: «2026-11-06 11:26:20.49281+00» → «—».
--   19 a 23. La empresa real de Foodint: sus recibidas (387), documentos (387),
--      emitidas (1.334), plan de cuentas (801) y esperados (27), como antes.
--   24 y 25. «Asesoría QBO»: sus 2 empresas y su plan de cuentas, como antes.
select clave, valor from (
  select 1 o, 'Foodint · empresas dadas de alta antes del 06/11 12:00 UTC' clave,
    (select count(*)::text from public.company c
      where c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and c.created_at < timestamptz '2026-11-06 12:00+00') valor union all
  select 2, 'Empresas de prueba · company',
    -- quieta: dos empresas fijas por su id; solo las borra esta tanda (y las devuelve su vuelta atrás)
    (select count(*)::text from public.company x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 3, 'Empresas de prueba · company_account (plan de cuentas)',
    -- quieta: el plan de dos empresas de prueba que nadie usa; solo lo toca esta tanda
    (select count(*)::text from public.company_account x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 4, 'Empresas de prueba · company_account_link',
    -- quieta: los enlaces del plan de dos empresas de prueba que nadie usa; solo los toca esta tanda
    (select count(*)::text from public.company_account_link x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 5, 'Empresas de prueba · company_account_log',
    -- quieta: dos empresas de prueba que nadie usa; solo lo toca esta tanda
    (select count(*)::text from public.company_account_log x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 6, 'Empresas de prueba · ai_action_log',
    -- quieta: dos empresas de prueba que nadie usa; solo lo toca esta tanda
    (select count(*)::text from public.ai_action_log x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 7, 'Empresas de prueba · ai_data_origin',
    -- quieta: dos empresas de prueba que nadie usa; solo lo toca esta tanda
    (select count(*)::text from public.ai_data_origin x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 8, 'Empresas de prueba · bank_activity_log',
    -- quieta: dos empresas de prueba sin banco; solo lo toca esta tanda
    (select count(*)::text from public.bank_activity_log x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 9, 'Empresas de prueba · bank_agent_run',
    -- quieta: dos empresas de prueba sin banco; solo lo toca esta tanda
    (select count(*)::text from public.bank_agent_run x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 10, 'Empresas de prueba · company_doubt',
    -- quieta: dos empresas de prueba que nadie usa; solo lo toca esta tanda
    (select count(*)::text from public.company_doubt x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 11, 'Empresas de prueba · company_tax_facts',
    -- quieta: dos empresas de prueba que nadie usa; solo lo toca esta tanda
    (select count(*)::text from public.company_tax_facts x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 12, 'Empresas de prueba · company_tax_profile (y sus modelos)',
    -- quieta: dos empresas de prueba que nadie usa; solo lo toca esta tanda
    (select count(*)::text || ' · ' || coalesce(string_agg(array_to_string(x.tax_forms, '/'), ' | ' order by x.company_id), '—')
      from public.company_tax_profile x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 13, 'Empresas de prueba · tax_obligation',
    -- quieta: dos empresas de prueba que nadie usa; solo lo toca esta tanda
    (select count(*)::text from public.tax_obligation x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 14, 'Empresas de prueba · conta_programa_anterior y su registro',
    -- quieta: dos empresas de prueba que nadie usa; solo lo toca esta tanda
    (select (select count(*) from public.conta_programa_anterior x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
              and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1'))::text
       || ' · ' || (select count(*) from public.conta_programa_anterior_registro x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
              and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1'))::text) union all
  select 15, 'Empresas de prueba · fiscal_year',
    -- quieta: dos empresas de prueba que nadie usa; solo lo toca esta tanda
    (select count(*)::text from public.fiscal_year x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 16, 'Empresas de prueba · sales_day_proposal_log (antes del 06/11 12:30 UTC)',
    (select count(*)::text from public.sales_day_proposal_log x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')
      and x.first_at < timestamptz '2026-11-06 12:30+00') union all
  select 17, 'Empresas de prueba · supplier_expected_invoice (los 4 esperados)',
    -- quieta: dos empresas de prueba que nadie usa; solo lo toca esta tanda
    (select count(*)::text from public.supplier_expected_invoice x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id in ('ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1')) union all
  select 18, 'Foodint · marcada como asesoría desde',
    -- quieta: la marca de una cuenta fija; solo la cambia esta tanda (o Ajustes, a mano)
    (select coalesce(a.tax_advisor_since::text, '—') || ' · ' || coalesce(a.tax_advisor_by::text, '—') from public.accounts a
      where a.id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 19, 'Empresa real · facturas recibidas (antes del 06/11 12:00 UTC)',
    (select count(*)::text from public.supplier_invoice x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and x.created_at < timestamptz '2026-11-06 12:00+00') union all
  select 20, 'Empresa real · documentos recibidos (antes del 06/11 12:00 UTC)',
    (select count(*)::text from public.document_inbox x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and x.created_at < timestamptz '2026-11-06 12:00+00') union all
  select 21, 'Empresa real · facturas emitidas (antes del 06/11 12:00 UTC)',
    (select count(*)::text from public.customer_invoice x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and x.created_at < timestamptz '2026-11-06 12:00+00') union all
  select 22, 'Empresa real · plan de cuentas (antes del 06/11 12:00 UTC)',
    (select count(*)::text from public.company_account x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and x.created_at < timestamptz '2026-11-06 12:00+00') union all
  select 23, 'Empresa real · documentos esperados (antes del 06/11 12:00 UTC)',
    (select count(*)::text from public.supplier_expected_invoice x where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and x.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and x.created_at < timestamptz '2026-11-06 12:00+00') union all
  select 24, 'Asesoría QBO · sus 2 empresas',
    -- quieta: dos empresas fijas por su id, de otra cuenta; esta tanda no las toca
    (select count(*)::text from public.company x where x.account_id = 'f4e8032d-510a-4e57-914c-4b67732d8655'
      and x.id in ('58e574ec-012a-4483-9f5b-3501cc023ba4', 'dc43e21d-2992-4eb3-a378-c867f86d6644')) union all
  select 25, 'Asesoría QBO · plan de cuentas de sus 2 empresas (antes del 06/11 12:30 UTC)',
    (select count(*)::text from public.company_account x where x.account_id = 'f4e8032d-510a-4e57-914c-4b67732d8655'
      and x.company_id in ('58e574ec-012a-4483-9f5b-3501cc023ba4', 'dc43e21d-2992-4eb3-a378-c867f86d6644')
      and x.created_at < timestamptz '2026-11-06 12:30+00')
) q order by o;
