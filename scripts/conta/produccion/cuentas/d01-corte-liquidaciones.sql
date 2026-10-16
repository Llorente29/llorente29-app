-- scripts/conta/produccion/cuentas/d01-corte-liquidaciones.sql
--
-- D01 · LO QUE CUENTA LA TANDA DEL CORTE POR FECHA (0100 del 15) Y DE LAS 7 DE
-- AGOSTO (0110 del 15), antes y después. SOLO LEE. Recuentos de Foodint (regla
-- 9); ningún nombre, tienda ni importe.
-- La columna is_reference y la tabla de la copia las crea la propia tanda:
-- ANTES no existen, y Postgres resuelve tablas y columnas al analizar la
-- consulta (ensayo #89 de E05), así que se cuentan con query_to_xml, que solo
-- analiza su texto si se llega a llamar.
-- Lo esperado: de referencia 0 → 7; facturas de comisión 8 → 1 (la de octubre);
-- de antes del corte 7 → 0; solapes por aclarar 2 → 2; copia «sin tabla» → 7.
select clave, valor from (
  select 1 o, 'liquidaciones de Foodint leídas de un correo' clave,
    (select count(*) from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source like 'correo\_%')::text valor union all
  select 2, 'de ellas, que acaban antes del 01/10',
    (select count(*) from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source like 'correo\_%' and period_to < date '2026-10-01')::text union all
  select 3, 'de ellas, de referencia', case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'channel_settlement' and column_name = 'is_reference') then 'sin columna'
    else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.channel_settlement where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710'' and source like ''correo\_%'' and is_reference', false, true, '')))[1]::text end union all
  select 4, 'de ellas, con factura de comisión',
    (select count(*) from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source like 'correo\_%' and commission_invoice_id is not null)::text union all
  select 5, 'de ellas, por aclarar porque se solapan',
    (select count(*) from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source like 'correo\_%' and review_note like '%Se solapa con%')::text union all
  select 6, 'facturas de comisión de liquidaciones (todas / de antes del 01/10)',
    (select count(*) || ' / ' || count(*) filter (where invoice_date < date '2026-10-01') from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source = 'liquidacion') union all
  select 7, 'facturas guardadas en la copia de la tanda', case when to_regclass('public.conta_respaldo_liquidacion_factura') is null then 'sin tabla'
    else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.conta_respaldo_liquidacion_factura', false, true, '')))[1]::text end union all
  select 8, 'la función del corte (_conta_corte)', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_conta_corte')::text
) t order by o;
