-- Vuelta atrás de 20261023T2310_c11b_cerrar_las_entregadas.sql (C11b).
--
-- Devuelve cada venta de la copia a como la dejó el cierre del día (anulada),
-- su fila de sales_day_close_log a accion NULL y el coste de las líneas que
-- calculó la 2310 a NULL. Antes, borra los asientos PROPUESTOS que la 2310
-- creó para esos días (los que llevan alguna de esas ventas y siguen
-- propuestos) con su resumen; para si alguno ya se ha validado (entonces no se pisa: se
-- anula en el libro). Para también si alguna venta ha cambiado desde el cierre.
-- Sin copia (staging), no hace nada.

do $$
declare v_n int; v_validados int;
begin
  if to_regclass('public.c11b_ventas_cerradas_20261023') is null then
    raise notice 'Vuelta atrás C11b-2: no hay copia: no hay nada que devolver.';
    return;
  end if;

  if exists (select 1 from public.sale s join public.c11b_ventas_cerradas_20261023 c on c.sale_id = s.id
              where s.status <> 'closed' or s.order_status is distinct from c.order_status) then
    raise exception 'Vuelta atrás C11b-2: alguna venta ha cambiado desde el cierre. No se pisa nada.';
  end if;

  select count(*) into v_validados
    from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
   where e.status in ('borrador', 'validado') and e.created_by_name = 'Cierre del día (C11b)'
     and d.sale_ids && array(select sale_id from public.c11b_ventas_cerradas_20261023);
  if v_validados > 0 then
    raise exception 'Vuelta atrás C11b-2: % asiento(s) de esos días ya no están propuestos. Se anulan en el libro; aquí no se pisa nada.', v_validados;
  end if;

  create temporary table c11b_propuestos on commit drop as
    select e.id from public.journal_entry e join public.sales_day_summary d on d.entry_id = e.id
     where e.status = 'propuesto' and e.created_by_name = 'Cierre del día (C11b)'
       and d.sale_ids && array(select sale_id from public.c11b_ventas_cerradas_20261023);
  delete from public.sales_day_summary d where d.entry_id in (select id from c11b_propuestos);
  delete from public.journal_entry e where e.id in (select id from c11b_propuestos);   -- sus líneas, en cascada

  perform set_config('folvy.reparto_tal_cual', 'on', true);
  update public.sale s
     set status = c.status, closed_at = c.closed_at, unconfirmed_at = c.unconfirmed_at, cancelled_at = c.cancelled_at, cancel_reason = c.cancel_reason
    from public.c11b_ventas_cerradas_20261023 c where c.sale_id = s.id;
  get diagnostics v_n = row_count;
  update public.sale_line l set computed_cost = null, cost_computed_at = null
    from public.c11b_ventas_cerradas_20261023 c where l.id = any(c.lineas_sin_coste);
  update public.sales_day_close_log l set accion = null
    from public.c11b_ventas_cerradas_20261023 c where c.sale_id = l.sale_id and l.accion = 'cerrado_sin_confirmar';

  drop table public.c11b_ventas_cerradas_20261023;
  raise notice 'Vuelta atrás C11b-2: % ventas otra vez como las dejó el cierre del día.', v_n;
end $$;
