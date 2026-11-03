-- scripts/conta/produccion/cuentas/dm1-casa-lola-gastos.sql
--
-- DM1·6 (03/11) · LO QUE CUENTA LA TANDA (1525), antes y después. SOLO LEE, y solo lo de Casa Lola (su
-- account_id). Antes (la semilla de la 1350): 117 asientos validados, 0 nóminas, 18 recibidas, 0 con retención,
-- 3 movimientos sin casar, el 303 del 3T presentado y sin 111 ni 115. Después: nóminas, alquiler con retención y
-- gastos fijos; 2 sin casar; el 303, el 111 y el 115 del 3T pagados. Tras la vuelta atrás: como antes.
select clave, valor from (
  select 1 o, 'empresas de Casa Lola (antes 1, después 1)' clave,
    -- quieta: solo esta tanda crea o borra la empresa de Casa Lola
    (select count(*) from public.company where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331')::text valor union all
  select 2, 'nóminas validadas de Casa Lola (antes 0, después 4)',
    -- quieta: Casa Lola no tiene nóminas fuera de esta tanda
    (select count(*) from public.journal_entry where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and source_type = 'payroll' and status = 'validado')::text union all
  select 3, 'asientos sin validar de Casa Lola (antes 0, después 0)',
    -- quieta: la contabilidad de Casa Lola solo la escribe su semilla
    (select count(*) from public.journal_entry where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and status <> 'validado')::text union all
  select 4, 'recibidas de Casa Lola (antes 18, después 38)',
    -- quieta: Casa Lola no recibe facturas fuera de su semilla
    (select count(*) from public.supplier_invoice where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331')::text union all
  select 5, 'recibidas con retención de Casa Lola (antes 0, después 4)',
    -- quieta: como la de arriba
    (select count(*) from public.supplier_invoice where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and withholding_amount > 0)::text union all
  select 6, 'movimientos del banco de Casa Lola sin casar (antes 3, después 2)',
    -- quieta: el banco de Casa Lola solo lo escribe su semilla
    (select count(*) from public.bank_movement where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and status = 'pendiente')::text union all
  select 7, 'declaraciones de Casa Lola (antes 303 3T presentado y 4T en borrador; después 111, 115 y 303 del 3T pagados y del 4T en borrador)',
    -- quieta: sin la tanda no se calcula ni se presenta nada de Casa Lola
    coalesce((select string_agg(form_code || ' ' || period || ' ' || status, ', ' order by form_code, period) from public.tax_return
               where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331'), 'ninguna')
) t order by o;
