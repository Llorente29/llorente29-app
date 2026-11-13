-- scripts/conta/produccion/cuentas/dm1-casa-lola-ajustes.sql
--
-- DM1·8 (03/11) · LO QUE CUENTA LA TANDA (2320), antes y después. SOLO LEE, y solo lo de Casa Lola (su
-- account_id). Antes (la 1525): sin apertura, nóminas de 18 personas, una cuenta de banco, ningún pago con
-- Revolut. Después: la apertura, nóminas de 11, dos cuentas (la principal y Revolut) y un pago con Revolut pagado.
-- Tras la vuelta atrás: como antes.
select clave, valor from (
  select 1 o, 'asientos de apertura de Casa Lola (antes 0, después 1)' clave,
    -- quieta: la contabilidad de Casa Lola solo la escribe su semilla
    (select count(*) from public.journal_entry where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and source_type = 'opening' and status = 'validado')::text valor union all
  select 2, 'personas en las nóminas de Casa Lola (antes 18, después 11)',
    -- quieta: Casa Lola no tiene nóminas fuera de su semilla
    coalesce((select string_agg(distinct employees_count::text, ',') from public.payroll_summary where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331'), 'ninguna') union all
  select 3, 'cuentas de banco de Casa Lola (antes 1, después 2)',
    -- quieta: solo la semilla da de alta bancos en Casa Lola
    (select count(*) from public.treasury_account where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331')::text union all
  select 4, 'pagos con Revolut pagados de Casa Lola (antes 0, después 1)',
    -- quieta: Casa Lola no tiene Revolut conectado; solo la semilla los crea
    (select count(*) from public.conta_pago_salida where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and estado = 'pagada')::text union all
  select 5, 'asientos sin validar de Casa Lola (antes 0, después 0)',
    -- quieta: como la primera
    (select count(*) from public.journal_entry where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and status <> 'validado')::text union all
  select 6, 'declaraciones de Casa Lola (antes y después: 111, 115 y 303 del 3T pagados y del 4T en borrador)',
    -- quieta: sin la tanda no se calcula ni se presenta nada de Casa Lola
    coalesce((select string_agg(form_code || ' ' || period || ' ' || status, ', ' order by form_code, period) from public.tax_return
               where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331'), 'ninguna')
) t order by o;
