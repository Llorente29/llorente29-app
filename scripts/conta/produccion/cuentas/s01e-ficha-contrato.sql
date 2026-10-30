-- scripts/conta/produccion/cuentas/s01e-ficha-contrato.sql
--
-- S01e · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. De Foodint
-- (regla 9), sin nombres ni importes. Sin comas en los valores.
--
-- Lo que tiene que pasar:
--   1. bank_match sabe qué fila del cuadro paga un cargo: de false a true;
--   2. «Subir un cuadro nuevo» sabe sustituir las cuotas pendientes: de false a true;
--   3. los contratos de Foodint: los mismos antes y después (la tanda no da ninguno de alta);
--   4. los cargos casados de Foodint: los mismos (la tanda no casa ni deshace nada).
select clave, valor from (
  select 1 o, 'bank_match con contrato y fila' clave,
    (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bank_match' and column_name = 'contract_due_date')
     and position('v_contrato' in pg_get_functiondef('public.bank_casar(uuid,jsonb,text,text,jsonb,text,uuid)'::regprocedure)) > 0)::text valor union all
  select 2, 'sustituir las cuotas pendientes',
    (position('sustituir' in pg_get_functiondef('public.bank_contrato_guardar(uuid,jsonb)'::regprocedure)) > 0)::text union all
  select 3, 'contratos de Foodint',
    -- quieta: solo los da de alta «Subir el cuadro» (Bancos › Préstamos y aplazamientos)
    (select count(*)::text from public.recurring_contract where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 4, 'cargos casados de Foodint',
    -- quieta: la tanda no casa nada
    (select count(*)::text from public.bank_match where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'vivo')
) q order by o;
