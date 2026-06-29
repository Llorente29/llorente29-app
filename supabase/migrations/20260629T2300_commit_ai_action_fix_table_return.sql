-- supabase/migrations/20260629T2300_commit_ai_action_fix_table_return.sql
--
-- FIX REAL del "invalid input syntax for type json".
-- Causa: classify_unmapped_product devuelve una TABLE (set de filas), no un
-- escalar. Llamarla con `select classify_unmapped_product(...) into v_result`
-- (v_result jsonb) intentaba meter el record entero en un jsonb → error de cast.
--
-- Arreglo: llamarla como tabla (FROM) y construir v_result con sus columnas.
-- También: si devuelve resultado='needs_target', NO es un fallo: significa que
-- hay que elegir entre candidatos. Lo devolvemos como estado 'needs_target' para
-- que el front lo maneje (de momento se refleja como resultado; la UI de elegir
-- candidato es un frente posterior).

create or replace function commit_ai_action(
  p_action_id   uuid,
  p_edited_args jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_act        ai_action%rowtype;
  v_args       jsonb;
  v_edited     jsonb;
  v_result     jsonb;
  -- columnas del retorno de classify_unmapped_product
  v_resultado  text;
  v_recipe_id  uuid;
  v_marcas     integer;
  v_casadas    integer;
  v_cands      jsonb;
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

  -- Merge defensivo de args (solo objeto jsonb cuenta).
  v_edited := case
    when p_edited_args is not null and jsonb_typeof(p_edited_args) = 'object'
    then p_edited_args
    else '{}'::jsonb
  end;
  v_args := coalesce(v_act.args, '{}'::jsonb) || v_edited;

  update ai_action
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
         args = v_args
   where id = p_action_id;

  begin
    if v_act.tool_name = 'assign_resale_cost' then
      -- classify_unmapped_product devuelve una TABLA: la leemos como tal.
      select c.resultado, c.recipe_item_id, c.marcas_creadas, c.lineas_casadas, c.candidatos
        into v_resultado, v_recipe_id, v_marcas, v_casadas, v_cands
      from classify_unmapped_product(
             v_act.account_id,
             (v_args->>'product_name'),
             'resale',
             (v_args->>'unit_cost')::numeric,
             nullif(v_args->>'recipe_item_id','')::uuid
           ) as c;

      v_result := jsonb_build_object(
        'resultado', v_resultado,
        'recipe_item_id', v_recipe_id,
        'marcas_creadas', coalesce(v_marcas, 0),
        'lineas_casadas', coalesce(v_casadas, 0),
        'candidatos', coalesce(v_cands, '[]'::jsonb)
      );

      -- needs_target: la función no pudo anclar sola; hay que elegir candidato.
      -- No es un fallo de ejecución; lo marcamos aparte para que el front decida.
      if v_resultado = 'needs_target' then
        update ai_action
           set status = 'proposed',   -- vuelve a proponible; falta elegir destino
               result = v_result
         where id = p_action_id;
        return jsonb_build_object('status','needs_target','result',v_result);
      end if;

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
