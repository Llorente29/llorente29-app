-- scripts/conta/produccion/cuentas/s1b-tpv-sala.sql
--
-- S1b del TPV de sala (subida a producción el 01/11) · LO QUE CUENTA LA TANDA,
-- antes y después. SOLO LEE. Las ventas y líneas son de TODAS las cuentas a
-- propósito: aplicar la S1b no mueve ninguna fila.
select clave, valor from (
  select 1 o, 'columnas nuevas en sale y sale_line (antes 0, después 8)' clave,
    (select count(*) from information_schema.columns where table_schema = 'public'
      and ((table_name = 'sale' and column_name in ('table_id','covers','served_by','served_by_name','bill_requested_at','table_cleared_at'))
        or (table_name = 'sale_line' and column_name in ('fire_id','voided_at'))))::text valor union all
  select 2, 'tablas nuevas sale_fire y sale_line_void (antes 0, después 2)',
    ((to_regclass('public.sale_fire') is not null)::int + (to_regclass('public.sale_line_void') is not null)::int)::text union all
  select 3, 'funciones de sala nuevas (antes 0, después 21)',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
      and (proname in ('pos_floor','pos_void_reasons') or proname like 'pos\_table\_%' or proname like '\_pos\_table\_%'
           or proname in ('_pos_enqueue_print','_pos_insert_order_line','_pos_device_for','_pos_actor_name','_pos_sala_channel_id')))::text union all
  select 4, 'firma de order_for_print (antes (text,uuid); después (text,uuid,uuid))',
    (select string_agg(oid::regprocedure::text, ' ') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'order_for_print') union all
  select 5, 'service_type admite dine_in (antes false, después true)',
    (pg_get_constraintdef((select oid from pg_constraint where conname = 'sale_service_type_check')) like '%dine_in%')::text union all
  select 6, 'ventas de antes del 01/11 00:00 UTC (igual antes y después)',
    (select count(*) from public.sale where created_at < timestamptz '2026-11-01 00:00:00+00')::text union all
  select 7, 'ventas de antes del 01/11 00:00 UTC con service_type dine_in (antes 0, después 0)',
    (select count(*) from public.sale where service_type = 'dine_in' and created_at < timestamptz '2026-11-01 00:00:00+00')::text
) t order by o;
