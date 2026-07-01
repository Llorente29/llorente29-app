-- supabase/migrations/20260701T1300_commit_ai_action_generate_purchase_order.sql
--
-- Capa 2 del agente Supply: añade el dispatch de 'generate_purchase_order' a
-- commit_ai_action. Al confirmar la propuesta, crea el purchase_order (borrador,
-- origin 'par') + sus purchase_order_line con lo que la write tool ya calculó
-- (líneas en args->'lines'). El código correlativo lo pone el trigger
-- set_purchase_order_code (code NULL → next_purchase_order_code); aquí NO se
-- duplica esa lógica.
--
-- create or replace de la función completa (plpgsql): el resto del despacho es
-- idéntico a 20260629T2100; solo se añade el bloque nuevo antes del else final.

create or replace function commit_ai_action(
  p_action_id   uuid,
  p_edited_args jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_act      ai_action%rowtype;
  v_args     jsonb;
  v_result   jsonb;
  v_order_id uuid;
  v_code     text;
  v_line     jsonb;
  v_n        int := 0;
begin
  select * into v_act from ai_action where id = p_action_id;
  if not found then
    raise exception 'Acción no encontrada';
  end if;

  if not current_user_is_admin_of(v_act.account_id) then
    raise exception 'No autorizado para confirmar esta acción';
  end if;

  if v_act.status = 'executed' then
    return jsonb_build_object('status','executed','already',true,'result',v_act.result);
  end if;
  if v_act.status <> 'proposed' then
    raise exception 'La acción no está en estado proponible (estado actual: %)', v_act.status;
  end if;

  v_args := coalesce(v_act.args, '{}'::jsonb) || coalesce(p_edited_args, '{}'::jsonb);

  update ai_action
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
         args = v_args
   where id = p_action_id;

  begin
    if v_act.tool_name = 'assign_resale_cost' then
      select classify_unmapped_product(
        v_act.account_id,
        (v_args->>'product_name'),
        'resale',
        (v_args->>'unit_cost')::numeric,
        nullif(v_args->>'recipe_item_id','')::uuid
      ) into v_result;

    elsif v_act.tool_name = 'reprice_menu_item' then
      update menu_item
         set price = (v_args->>'new_price')::numeric,
             updated_at = now()
       where id = (v_args->>'menu_item_id')::uuid
         and account_id = v_act.account_id;
      v_result := jsonb_build_object('menu_item_id', v_args->>'menu_item_id',
                                     'new_price', (v_args->>'new_price')::numeric);

    elsif v_act.tool_name = 'generate_purchase_order' then
      -- Crea el pedido (borrador, origin 'par'). El código lo pone el trigger.
      insert into purchase_order (
        account_id, supplier_id, location_id, status, origin,
        est_subtotal, est_total, notes, created_by
      ) values (
        v_act.account_id,
        nullif(v_args->>'supplier_id','')::uuid,
        nullif(v_args->>'location_id','')::uuid,
        'borrador', 'par',
        nullif(v_args->>'est_total','')::numeric,
        nullif(v_args->>'est_total','')::numeric,
        'Propuesto por Folvy AI (sugerencia de repedido)',
        auth.uid()
      )
      returning id, code into v_order_id, v_code;

      -- Líneas: lo que la write tool ya calculó (precio incluido; no se recalcula).
      for v_line in select * from jsonb_array_elements(coalesce(v_args->'lines','[]'::jsonb))
      loop
        insert into purchase_order_line (
          account_id, purchase_order_id, recipe_item_id, product_name,
          qty_ordered, purchase_format_id, est_unit_price, est_line_total, position
        ) values (
          v_act.account_id,
          v_order_id,
          nullif(v_line->>'recipe_item_id','')::uuid,
          coalesce(v_line->>'product_name','(sin nombre)'),
          (v_line->>'qty')::numeric,
          nullif(v_line->>'purchase_format_id','')::uuid,
          nullif(v_line->>'unit_price','')::numeric,
          nullif(v_line->>'line_total','')::numeric,
          v_n
        );
        v_n := v_n + 1;
      end loop;

      v_result := jsonb_build_object(
        'purchase_order_id', v_order_id,
        'code', v_code,
        'n_lines', v_n
      );

    else
      raise exception 'Tool no soportada por commit_ai_action: %', v_act.tool_name;
    end if;

    update ai_action
       set status = 'executed', result = v_result, executed_at = now()
     where id = p_action_id;

    return jsonb_build_object('status','executed','result',v_result);

  exception when others then
    update ai_action
       set status = 'failed', error_message = sqlerrm, executed_at = now()
     where id = p_action_id;
    return jsonb_build_object('status','failed','error',sqlerrm);
  end;
end;
$$;

grant execute on function commit_ai_action(uuid,jsonb) to authenticated;
