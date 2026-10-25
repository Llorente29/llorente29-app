-- scripts/conta/produccion/cuentas/pc01-e1.sql
--
-- PC01 · Entrega 1 (25/10) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta (regla 9): Foodint (51ad1792…), salvo las líneas que dicen
-- «tabla entera». La misma vara a los dos lados (regla 31): «vencida» es una
-- emitida con vencimiento pasado (hoy en Madrid) y algo por cobrar, que es lo
-- que contaban Ventas › Facturas antes y lo que cuenta conta_factura_cobro
-- después. No usa nada que cree la tanda, salvo las líneas que lo dicen (y
-- antes salen «—»).
--
-- Antes (medido el 25/10 a las 09:55 Madrid, solo leyendo): emitidas 1.286
-- (281.728,22 €); vencidas 1.284 (281.734,69 € por cobrar); por cobrar sin
-- vencer 0; cobradas 0; cobros 0; vencen el día que se emiten 1.286; recibidas
-- pagadas 4 (732,65 €); aprobadas con el pago del lote 83; pagos de recibidas
-- «—»; tiendas de Uber sin marca 9; liquidaciones cobradas 2; asientos 15.217.
-- Después: las traídas (1.196) cobradas; de las 85 de octubre, 1 cobrada, 5
-- cobradas en parte y el resto por cobrar, vencidas solo las que pasaron su día
-- de pago más el margen sin liquidación; recibidas pagadas 87 (4 + 83 del lote);
-- pagos de recibidas 87.
with f as (
  select ci.id, ci.total, ci.due_date, ci.status,
         coalesce((select sum(p.amount) from public.customer_invoice_payment p where p.invoice_id = ci.id), 0) cobrado
    from public.customer_invoice ci where ci.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and ci.status = 'emitida'
), hoy as (select (now() at time zone 'Europe/Madrid')::date d)
select clave, valor from (
  select 1 o, 'Foodint · emitidas' clave, (select count(*) || ' · ' || coalesce(sum(total), 0) from f)::text valor union all
  select 2, 'Foodint · vencidas (vencimiento pasado y algo por cobrar)',
         (select count(*) || ' · ' || coalesce(sum(total - cobrado), 0) from f, hoy where total > 0 and total - cobrado >= 0.005 and due_date < hoy.d)::text union all
  select 3, 'Foodint · por cobrar sin vencer',
         (select count(*) || ' · ' || coalesce(sum(total - cobrado), 0) from f, hoy where total > 0 and total - cobrado >= 0.005 and (due_date is null or due_date >= hoy.d))::text union all
  select 4, 'Foodint · cobradas enteras', (select count(*)::text from f where abs(total - cobrado) < 0.005 and cobrado <> 0) union all
  select 5, 'Foodint · cobradas en parte', (select count(*)::text from f where cobrado <> 0 and abs(total - cobrado) >= 0.005) union all
  select 6, 'Foodint · cobros (número · suma)', (select count(*) || ' · ' || coalesce(sum(p.amount), 0) from public.customer_invoice_payment p where p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 7, 'Foodint · emitidas que vencen el mismo día que se emiten',
         (select count(*)::text from public.customer_invoice ci where ci.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and ci.status = 'emitida' and ci.due_date = ci.issue_date) union all
  select 8, 'Foodint · recibidas pagadas (número · total)',
         (select count(*) || ' · ' || coalesce(sum(grand_total), 0) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'pagada')::text union all
  select 9, 'Foodint · recibidas aprobadas con el pago del lote (sin marcar pagadas)',
         (select count(*)::text from public.supplier_invoice si join public.journal_entry e on e.id = si.payment_entry_id and e.source_type = 'supplier_payment'
           where si.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and si.status = 'aprobada') union all
  select 10, 'Foodint · pagos de recibidas (supplier_invoice_payment; antes «—»)',
         case when to_regclass('public.supplier_invoice_payment') is null then '—'
              else (xpath('/row/c/text()', query_to_xml('select count(*) || '' · '' || coalesce(sum(amount), 0) c from public.supplier_invoice_payment where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, true, '')))[1]::text end union all
  select 11, 'Foodint · tiendas de Uber sin marca',
         (select count(*)::text from public.platform_store where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and provider = 'uber' and brand_id is null) union all
  select 12, 'Foodint · liquidaciones cobradas', (select count(*)::text from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and collected_on is not null) union all
  select 13, 'Foodint · estados de las emitidas (conta_factura_cobro; antes «—»)',
         case when to_regclass('public.conta_factura_cobro') is null then '—'
              else (xpath('/row/c/text()', query_to_xml('select string_agg(estado || '' '' || n, '', '' order by estado) c from (select estado, count(*) n from public.conta_factura_cobro where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710'' group by estado) x', false, true, '')))[1]::text end union all
  select 14, 'Tabla entera · asientos', (select count(*)::text from public.journal_entry) union all
  select 15, '(control) historial', (select coalesce(string_agg(version, ', ' order by version), '—') from supabase_migrations.schema_migrations where version like '20261025T09%\_pc01\_%')
) t order by o;
