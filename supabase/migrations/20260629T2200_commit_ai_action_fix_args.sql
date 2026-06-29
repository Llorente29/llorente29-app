-- supabase/migrations/20260629T2200_commit_ai_action_fix_args.sql
--
-- FIX: commit_ai_action fallaba con "invalid input syntax for type json" al
-- confirmar una acción sin ajustes. Causa: p_edited_args llegando como texto
-- "null" desde el cliente rompía el operador || (concatenación jsonb).
--
-- Endurecemos el merge de args para que nunca falle, sea cual sea la entrada:
-- tratamos p_edited_args defensivamente (NULL o no-objeto → {} ). El resto de
-- la función es idéntica a la original.

create or replace function commit_ai_action(
  p_action_id   uuid,
  p_edited_args jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_act     ai_action%rowtype;
  v_args    jsonb;
  v_edited  jsonb;
  v_result  jsonb;
begin
  select * into v_act from ai_action where id = p_action_id;
  if not found then
    raise exception 'Acción no encontrada';
  end if;

  if not current_user_is_admin_of(v_act.account_id) then
    raise exception 'No autorizado para confirmar esta acción';
  end if;

  -- Idempotencia: si ya se ejecutó, devuelve su resultado sin re-ejecutar.
  if v_act.status = 'executed' then
    return jsonb_build_object('status','executed','already',true,'result',v_act.result);
  end if;
  if v_act.status <> 'proposed' then
    raise exception 'La acción no está en estado proponible (estado actual: %)', v_act.status;
  end if;

  -- Merge defensivo: solo aceptamos p_edited_args si es un objeto jsonb.
  -- Cualquier otra cosa (NULL, "null", escalar) se ignora → base sin ajustes.
  v_edited := case
    when p_edited_args is not null and jsonb_typeof(p_edited_args) = 'object'
    then p_edited_args
    else '{}'::jsonb
  end;
  v_args := coalesce(v_act.args, '{}'::jsonb) || v_edited;

  -- Marca confirmada antes de ejecutar (rastro aunque la ejecución falle).
  update ai_action
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
         args = v_args
   where id = p_action_id;

  -- ── DESPACHO POR TOOL ─────────────────────────────────────────────────────
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
