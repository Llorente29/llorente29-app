-- ENCARGO CODE (21/08) — arreglo: min(uuid) no existe en Postgres. Se usa
-- (array_agg(id))[1], que con count=1 es exactamente esa única fila.
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
    -- 1) POR ARTÍCULO (clave fuerte). Vale aunque otra recepción ya apunte
    --    ahí: así se representa una entrega parcial, y recompute suma por
    --    purchase_order_line_id.
    select count(*), (array_agg(pol.id))[1] into v_n, v_pol_id
      from purchase_order_line pol
     where pol.purchase_order_id = p_order_id
       and pol.recipe_item_id = v_line.recipe_item_id;

    if v_n > 1 then
      -- 2) El artículo está varias veces: desempatar por FORMATO.
      select count(*), (array_agg(pol.id))[1] into v_n, v_pol_id
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

-- La verificación EJECUTA la función, no comprueba sólo que exista: la versión
-- anterior usaba min(uuid) y pasó la comprobación de existencia tan campante.
do $$
declare v_n integer;
begin
  v_n := public._match_order_lines_for_order('00000000-0000-0000-0000-000000000000');
  if v_n <> 0 then
    raise exception 'con un pedido inexistente debería devolver 0 y devolvió %', v_n;
  end if;
  perform * from public.purchase_orders_stuck(3);
end $$;