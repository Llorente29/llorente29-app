-- scripts/conta/produccion/cuentas/c11b-cerrar-sin-confirmar.sql
--
-- C11b (Julio, 23/10) · LO QUE CUENTA LA TANDA QUE CIERRA LOS NO CONFIRMADOS,
-- antes y después. SOLO LEE. TABLA ENTERA, a propósito y dicho (regla 9):
-- todas las cuentas juntas; las ventas del cierre del día son todas de Foodint.
--
-- Después del real: anuladas por el cierre y entregadas = 0; cerradas sin
-- confirmar = las de antes + esas; los movimientos de stock de las ventas del
-- registro del cierre, los mismos; asientos de ventas propuestos, más (los
-- días que no tenían asiento); los validados, como antes; y conta_cerrar_dias
-- con el md5 de la 2300.
select clave, valor from (
  select 1 o, 'ventas anuladas por el cierre del día · entregadas en la plataforma' clave,
         (select count(*) from public.sale where status = 'cancelled' and unconfirmed_at is not null
             and cancel_reason like 'No confirmado por la plataforma al cierre del día (%' and order_status = 'completed')::text valor union all
  select 2, 'ventas anuladas por el cierre del día · no entregadas',
         (select count(*) from public.sale where status = 'cancelled' and unconfirmed_at is not null
             and cancel_reason like 'No confirmado por la plataforma al cierre del día (%' and order_status <> 'completed')::text union all
  select 3, 'registro del cierre · cerradas sin confirmar',
         (select count(*) from public.sales_day_close_log l where to_jsonb(l)->>'accion' = 'cerrado_sin_confirmar')::text union all
  select 4, 'registro del cierre · para revisar',
         (select count(*) from public.sales_day_close_log l where to_jsonb(l)->>'accion' = 'revisar')::text union all
  select 5, 'huella de los movimientos de stock de las ventas del registro del cierre',
         (select md5(coalesce(string_agg(m.id::text, ',' order by m.id), '')) from public.stock_movement m
           where m.source_id in (select sale_id from public.sales_day_close_log)) union all
  select 6, 'líneas sin coste calculado de las ventas del registro del cierre',
         (select count(*) from public.sale_line sl where sl.sale_id in (select sale_id from public.sales_day_close_log)
             and coalesce(sl.line_type, 'product') = 'product' and sl.cost_computed_at is null)::text union all
  select 7, 'asientos de ventas · propuesto', (select count(*) from public.journal_entry where source_type = 'sales_day' and status = 'propuesto')::text union all
  select 8, 'asientos de ventas · validado',  (select count(*) from public.journal_entry where source_type = 'sales_day' and status = 'validado')::text union all
  select 9, 'md5 de conta_cerrar_dias',
         (select md5(prosrc) from pg_proc where oid = 'public.conta_cerrar_dias(uuid, timestamptz)'::regprocedure)
) x order by o;
