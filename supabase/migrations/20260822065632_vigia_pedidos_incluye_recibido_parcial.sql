-- ENCARGO CODE (21/08) §7 — el vigía vigila también 'recibido_parcial'.
-- Cambian las columnas de salida, así que hay que DROP + CREATE: create or
-- replace no puede cambiar el tipo de retorno.
drop function if exists public.purchase_orders_stuck(integer);

create function public.purchase_orders_stuck(p_days integer default 3)
 returns table(
   order_id uuid, order_code text, estado text, supplier_name text, location_name text,
   expected_date date, dias_de_retraso integer,
   lineas_pedido integer, lineas_completas integer, lineas_sin_recibir integer
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with recv as (
    select grl.purchase_order_line_id as pol_id, sum(grl.qty_received) as qty_recv
      from goods_receipt_line grl
      join goods_receipt gr on gr.id = grl.goods_receipt_id
     where gr.status = 'confirmado' and grl.purchase_order_line_id is not null
     group by 1
  ),
  por_pedido as (
    select pol.purchase_order_id as po_id,
           count(*)::integer as n_lineas,
           count(*) filter (where coalesce(r.qty_recv,0) >= pol.qty_ordered)::integer as n_completas,
           count(*) filter (where coalesce(r.qty_recv,0) = 0)::integer as n_sin_recibir
      from purchase_order_line pol
      left join recv r on r.pol_id = pol.id
     group by 1
  )
  select po.id, po.code, po.status, s.name, l.name, po.expected_date,
         (current_date - po.expected_date)::integer,
         coalesce(pp.n_lineas,0), coalesce(pp.n_completas,0), coalesce(pp.n_sin_recibir,0)
    from purchase_order po
    left join supplier s on s.id = po.supplier_id
    left join locations l on l.id = po.location_id
    left join por_pedido pp on pp.po_id = po.id
   where po.status in ('enviado', 'recibido_parcial')
     and po.expected_date < current_date - greatest(p_days, 0)
     and public.belongs_to_account(po.account_id)
   order by po.expected_date;
$function$;

grant execute on function public.purchase_orders_stuck(integer) to authenticated;

do $$
begin
  perform * from public.purchase_orders_stuck(3);
end $$;