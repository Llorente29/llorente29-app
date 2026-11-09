-- scripts/conta/produccion/cuentas/g05-t3-cobro.sql
--
-- G05 · T3 · El cobro del mes y su factura · LO QUE CUENTA LA TANDA, antes y
-- después. SOLO LEE. La misma vara a los dos lados (regla 31). Todas las
-- cuentas a propósito (la tanda es de la estructura, no de los datos de nadie),
-- con un corte fijo (antes del 09/11 a las 00:00 UTC) en lo que se cuenta.
-- Medido antes el 09/11 a las 09:40 UTC (solo lectura). Lo que tiene que pasar:
--   1. Las tablas del cobro (conta_recibo, conta_cobro_mes, conta_recibo_evento): false → true.
--   2. conta_venta_emitir lee el formato de la serie: false → true.
--   3. Facturas de venta emitidas (todas las cuentas, hasta el corte): 1343 → 1343.
--   4. Asientos (todas las cuentas, hasta el corte): 15786 → 15786.
--   5. Clientes del cobro (todas las cuentas, hasta el corte): 313 → 313.
--   6. El despertador de las pruebas de las demos, función / cron: false / false → true / true.
--   7. «Pendiente de revisar» por falta de código de cliente (todas las cuentas): 0 → 0.
select clave, valor from (
  select 1 o, 'Las tablas del cobro (conta_recibo, conta_cobro_mes, conta_recibo_evento)' clave,
    (to_regclass('public.conta_recibo') is not null and to_regclass('public.conta_cobro_mes') is not null and to_regclass('public.conta_recibo_evento') is not null)::text valor union all
  select 2, 'conta_venta_emitir lee el formato de la serie',
    (select (p.prosrc like '%_conta_numero_con_formato%')::text from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.conta_venta_emitir(uuid,text)')) union all
  select 3, 'Facturas de venta emitidas (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.customer_invoice where status <> 'borrador' and created_at < timestamptz '2026-11-09 00:00:00+00') union all
  select 4, 'Asientos (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.journal_entry where created_at < timestamptz '2026-11-09 00:00:00+00') union all
  select 5, 'Clientes del cobro (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.conta_cobro_cliente where updated_at < timestamptz '2026-11-09 00:00:00+00') union all
  select 6, 'El despertador de las pruebas de las demos: función / cron',
    concat_ws(' / ', (to_regprocedure('public.verifactu_despertar_demos()') is not null)::text,
      (select exists (select 1 from cron.job where jobname = 'verifactu-despertar-demos'))::text) union all
  select 7, '«Pendiente de revisar» por falta de código de cliente (todas las cuentas)',
    -- quieta: solo las crea el cobro (conta_cobro_guardar y conta_cobro_seguir), que nadie llama hasta fusionar y desplegar conta-cobro; la tanda no crea ninguna
    (select count(*)::text from public.conta_gestoria_diferencia where tipo = 'falta_codigo_cliente')
) q order by o;
