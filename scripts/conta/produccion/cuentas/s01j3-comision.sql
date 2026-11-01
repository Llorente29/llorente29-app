-- scripts/conta/produccion/cuentas/s01j3-comision.sql
--
-- S01j·3 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres.
-- Lo que tiene que pasar: las de Just Eat de Foodint con la comisión del revés
-- (factura negativa y comisión igual a ella), de 5 a 0; las que cuadran (ventas
-- + comisión + otros = neto), de 28 a 33; y ninguna liquidación nueva ni borrada.
select clave, valor from (
  select 1 o, 'Just Eat de Foodint con la comisión del revés' clave,
    (select count(*)::text from public.channel_settlement cs
       join public.supplier_invoice si on si.account_id = cs.account_id
        and si.id = coalesce((select k.supplier_invoice_id from public.channel_settlement_invoice k where k.settlement_id = cs.id and k.account_id = cs.account_id order by k.created_at limit 1), cs.commission_invoice_id)
      where cs.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and cs.source = 'correo_justeat'
        and si.grand_total < 0 and cs.commission = si.grand_total and cs.created_at < timestamptz '2026-11-01 15:45+00') valor union all
  select 2, 'Just Eat de Foodint que cuadran',
    (select count(*)::text from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source = 'correo_justeat'
        and abs(coalesce(gross_sales, 0) + coalesce(commission, 0) + coalesce(other_cost, 0) - coalesce(net_payout, 0)) < 0.005
        and created_at < timestamptz '2026-11-01 15:45+00') union all
  select 3, 'Just Eat de Foodint',
    (select count(*)::text from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source = 'correo_justeat' and created_at < timestamptz '2026-11-01 15:45+00') union all
  select 4, 'Glovo del Excel de Foodint que cuadran',
    (select count(*)::text from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source = 'excel_glovo'
        and abs(coalesce(gross_sales, 0) + coalesce(commission, 0) + coalesce(other_cost, 0) - coalesce(net_payout, 0)) < 0.005
        and created_at < timestamptz '2026-11-01 15:45+00')
) q order by o;
