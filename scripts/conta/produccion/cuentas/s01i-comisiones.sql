-- scripts/conta/produccion/cuentas/s01i-comisiones.sql
--
-- S01i · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres.
-- Sin comas en los valores. Todo de Foodint y de antes del 01/11 00:00 UTC.
--
-- Lo que tiene que pasar:
--   1. existe la tabla de facturas de cada liquidación: de false a true;
--   2. payment_method admite compensation: de false a true;
--   3. facturas de plataformas de Foodint pagadas: suben (las ligadas y
--      aprobadas, y las de antes de su plataforma en Sumied);
--   4. con la forma de pago «compensation»: todas las de plataformas;
--   5. facturas ligadas a una liquidación (la tabla nueva): las que encajan;
--   6. liquidaciones con commission_invoice_id: las de antes más las nuevas;
--   7. recibidas de Foodint: las mismas (la tanda no crea ni borra ninguna).
select clave, valor from (
  select 1 o, 'existe channel_settlement_invoice' clave, (to_regclass('public.channel_settlement_invoice') is not null)::text valor union all
  select 2, 'payment_method admite compensation',
    (position('compensation' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'supplier_invoice_payment_method_check')) > 0)::text union all
  select 3, 'facturas de plataformas de Foodint pagadas',
    (select count(*)::text from public.supplier_invoice si
      where si.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and si.status = 'pagada' and si.created_at < timestamptz '2026-11-01 00:00+00'
        and exists (select 1 from public.party_role ps join public.party_role pl on pl.account_id = ps.account_id and pl.party_id = ps.party_id and pl.role = 'platform'
                     where ps.account_id = si.account_id and ps.role = 'supplier' and ps.supplier_id = si.supplier_id)) union all
  select 4, 'facturas de plataformas de Foodint con forma de pago compensation',
    (select count(*)::text from public.supplier_invoice si
      where si.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and si.payment_method = 'compensation' and si.created_at < timestamptz '2026-11-01 00:00+00'
        and exists (select 1 from public.party_role ps join public.party_role pl on pl.account_id = ps.account_id and pl.party_id = ps.party_id and pl.role = 'platform'
                     where ps.account_id = si.account_id and ps.role = 'supplier' and ps.supplier_id = si.supplier_id)) union all
  select 5, 'facturas de Foodint ligadas a una liquidación',
    -- quieta: la tabla es nueva; antes de la tanda no existe
    (select case when to_regclass('public.channel_settlement_invoice') is null then 'no existe'
            else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.channel_settlement_invoice where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, true, '')))[1]::text end) union all
  select 6, 'liquidaciones de Foodint con commission_invoice_id',
    (select count(*)::text from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and commission_invoice_id is not null and created_at < timestamptz '2026-11-01 00:00+00') union all
  select 7, 'recibidas de Foodint de antes del 01/11',
    (select count(*)::text from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-01 00:00+00')
) q order by o;
