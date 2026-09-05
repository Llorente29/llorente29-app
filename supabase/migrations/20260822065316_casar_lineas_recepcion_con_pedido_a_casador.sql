-- ENCARGO CODE (21/08) §5 — casar líneas de recepción con líneas de pedido.
-- Reglas: nunca por parecido de nombre; nunca se pisa un valor ya puesto; una
-- línea que no casa NO es un error (llegó sin pedir) y se queda a null.
-- Keyed por PEDIDO para que cualquier camino repare el pedido entero.
create or replace function public._match_order_lines_for_order(p_order_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order   purchase_order%rowtype;
  v_line    record;
  v_n       integer;
  v_pol_id  uuid;
  v_matched integer := 0;
begin
  select * into v_order from purchase_order where id = p_order_id;
  if not found then
    return 0;
  end if;
  if not public.belongs_to_account(v_order.account_id) then
    raise exception '_match_order_lines_for_order: sin acceso al pedido %', p_order_id;
  end if;

  for v_line in
    select grl.id, grl.recipe_item_id, grl.purchase_format_id
      from goods_receipt_line grl
      join goods_receipt gr on gr.id = grl.goods_receipt_id
     where gr.purchase_order_id = p_order_id
       and gr.status in ('recibido', 'confirmado')
       and grl.purchase_order_line_id is null
       and grl.recipe_item_id is not null
       and not grl.not_goods
     order by grl.created_at, grl.id
  loop
    -- 1) POR ARTÍCULO (clave fuerte). Si el pedido sólo tiene una línea de ese
    --    artículo, no hay nada que decidir. Vale aunque otra recepción ya
    --    apunte ahí: así es como se representa una entrega parcial, y
    --    recompute ya suma por purchase_order_line_id.
    select count(*), min(pol.id) into v_n, v_pol_id
      from purchase_order_line pol
     where pol.purchase_order_id = p_order_id
       and pol.recipe_item_id = v_line.recipe_item_id;

    if v_n > 1 then
      -- 2) El artículo está varias veces: desempatar por FORMATO.
      select count(*), min(pol.id) into v_n, v_pol_id
        from purchase_order_line pol
       where pol.purchase_order_id = p_order_id
         and pol.recipe_item_id = v_line.recipe_item_id
         and pol.purchase_format_id is not distinct from v_line.purchase_format_id;
    end if;

    -- v_n=1 casa · v_n=0 llegó sin pedir · v_n>1 sigue el empate: a la pantalla.
    if v_n = 1 and v_pol_id is not null then
      update goods_receipt_line
         set purchase_order_line_id = v_pol_id, updated_at = now()
       where id = v_line.id;
      v_matched := v_matched + 1;
    end if;
  end loop;

  return v_matched;
end;
$function$;

grant execute on function public._match_order_lines_for_order(uuid) to authenticated;

-- §7 · El vigía. DE MOMENTO NO LO CONSUME NADIE: hace falta colgarlo de una
-- pantalla o de un aviso, o es la cuarta pata otra vez.
create or replace function public.purchase_orders_stuck(p_days integer default 3)
 returns table(
   order_id uuid, order_code text, supplier_name text, location_name text,
   expected_date date, dias_de_retraso integer,
   recepciones_enlazadas integer, lineas_casadas integer
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select po.id, po.code, s.name, l.name, po.expected_date,
         (current_date - po.expected_date)::integer,
         (select count(*)::integer from goods_receipt gr where gr.purchase_order_id = po.id),
         (select count(*)::integer from goods_receipt_line grl
            join goods_receipt gr2 on gr2.id = grl.goods_receipt_id
           where gr2.purchase_order_id = po.id and grl.purchase_order_line_id is not null)
    from purchase_order po
    left join supplier s on s.id = po.supplier_id
    left join locations l on l.id = po.location_id
   where po.status = 'enviado'
     and po.expected_date < current_date - greatest(p_days, 0)
     and public.belongs_to_account(po.account_id)
     and exists (select 1 from goods_receipt gr where gr.purchase_order_id = po.id)
   order by po.expected_date;
$function$;

grant execute on function public.purchase_orders_stuck(integer) to authenticated;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='_match_order_lines_for_order') then
    raise exception 'A: no quedó _match_order_lines_for_order';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='purchase_orders_stuck') then
    raise exception 'C: no quedó purchase_orders_stuck';
  end if;
end $$;