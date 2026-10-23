-- scripts/conta/produccion/cuentas/c11-cierre-no-anula.sql
--
-- C11 (Julio, 23/10) · LO QUE CUENTA LA TANDA DEL CIERRE QUE YA NO ANULA,
-- antes y después. SOLO LEE. TABLA ENTERA, a propósito y dicho (regla 9):
-- todas las cuentas juntas; las ventas que anulaba el cierre son todas de
-- Foodint.
--
-- Después del real tiene que dar: anuladas por el cierre y entregadas = 0;
-- restauradas = las que había antes; anuladas por el cierre y no entregadas,
-- como antes; movimientos de stock de esas ventas, como antes; y
-- conta_cerrar_dias con otro md5 (el de la 2045).
select clave, valor from (
  select 1 o, 'ventas anuladas por el cierre del día · entregadas en la plataforma' clave,
         (select count(*) from public.sale where status = 'cancelled' and unconfirmed_at is not null
             and cancel_reason like 'No confirmado por la plataforma al cierre del día (%' and order_status = 'completed')::text valor union all
  select 2, 'ventas anuladas por el cierre del día · no entregadas (cancelled, rejected, delivery_failed)',
         (select count(*) from public.sale where status = 'cancelled' and unconfirmed_at is not null
             and cancel_reason like 'No confirmado por la plataforma al cierre del día (%' and order_status <> 'completed')::text union all
  select 3, 'registro del cierre · filas', (select count(*) from public.sales_day_close_log)::text union all
  select 4, 'registro del cierre · restauradas',
         (select count(*) from public.sales_day_close_log l where to_jsonb(l)->>'accion' = 'restaurado')::text union all
  select 5, 'registro del cierre · para revisar',
         (select count(*) from public.sales_day_close_log l where to_jsonb(l)->>'accion' = 'revisar')::text union all
  select 6, 'movimientos de stock de las ventas del registro del cierre',
         (select count(*) from public.stock_movement m where m.source_id in (select sale_id from public.sales_day_close_log))::text union all
  select 7, 'huella de los movimientos de stock de las ventas del registro del cierre',
         (select md5(coalesce(string_agg(m.id::text, ',' order by m.id), '')) from public.stock_movement m
           where m.source_id in (select sale_id from public.sales_day_close_log)) union all
  select 8, 'md5 de conta_cerrar_dias',
         (select md5(prosrc) from pg_proc where oid = 'public.conta_cerrar_dias(uuid, timestamptz)'::regprocedure)
) x order by o;
