-- Vuelta atrás de 20261023T2050_c11_restaurar_ventas_entregadas.sql (C11).
--
-- Devuelve cada venta de la copia a como estaba antes (anulada por el cierre
-- del día) y su fila de sales_day_close_log a accion NULL. Para si alguna ha
-- cambiado de estado desde la restauración (otra cosa la ha movido: entonces
-- no se pisa) o si la copia no existe. Sin Foodint (staging), no hace nada.

do $$
declare v_n int; v_movidas int;
begin
  if to_regclass('public.c11_ventas_restauradas_20261023') is null then
    raise notice 'Vuelta atrás C11-2: no hay copia: no hay nada que devolver.';
    return;
  end if;

  select count(*) into v_movidas
    from public.sale s join public.c11_ventas_restauradas_20261023 c on c.sale_id = s.id
   where s.status <> 'open' or s.order_status is distinct from c.order_status;
  if v_movidas > 0 then
    raise exception 'Vuelta atrás C11-2: % venta(s) han cambiado desde la restauración. No se pisa nada.', v_movidas;
  end if;

  perform set_config('folvy.reparto_tal_cual', 'on', true);
  update public.sale s
     set status = c.status, unconfirmed_at = c.unconfirmed_at, cancelled_at = c.cancelled_at, cancel_reason = c.cancel_reason
    from public.c11_ventas_restauradas_20261023 c
   where c.sale_id = s.id;
  get diagnostics v_n = row_count;

  update public.sales_day_close_log l set accion = null
    from public.c11_ventas_restauradas_20261023 c
   where c.sale_id = l.sale_id and l.accion = 'restaurado';

  drop table public.c11_ventas_restauradas_20261023;
  raise notice 'Vuelta atrás C11-2: % ventas, otra vez como las dejó el cierre del día.', v_n;
end $$;
