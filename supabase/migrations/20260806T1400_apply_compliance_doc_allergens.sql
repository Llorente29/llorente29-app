-- 20260806T1400_apply_compliance_doc_allergens.sql
-- Aplicada: 2026-08-06 por MCP (apply_migration). Verificada (SECURITY DEFINER, grant a authenticated).
-- T4 del archivo documental: aplica los alérgenos leídos de una ficha (compliance_document)
-- al INGREDIENTE (recipe_item raw) que respalda, con source='manual' + source_document_id,
-- crea el enlace ficha<->ingrediente y recomputa los platos/recetas que usan el ingrediente
-- (herencia fill-only: NO pisa manual). "IA propone, humano decide": se llama SOLO tras
-- confirmación. Guardarraíl admin/manager + aislamiento de cuenta. Solo toca lo declarado.

create or replace function public.apply_compliance_doc_allergens(
  p_document_id    uuid,
  p_recipe_item_id uuid,
  p_contains       text[],
  p_may_contain    text[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_account     uuid;
  v_doc_account uuid;
  v_ref         text;
  v_supplier    text;
  v_reason      text;
  v_code        text;
  v_dish        uuid;
  v_recomputed  int := 0;
begin
  select account_id into v_account from recipe_item where id = p_recipe_item_id;
  if v_account is null then
    raise exception 'apply_compliance_doc_allergens: el ingrediente % no existe', p_recipe_item_id;
  end if;
  if not public.current_user_is_admin_or_manager_of(v_account) then
    raise exception 'apply_compliance_doc_allergens: sin acceso a la cuenta %', v_account;
  end if;

  select cd.account_id, cd.reference, s.name
    into v_doc_account, v_ref, v_supplier
  from compliance_document cd
  left join supplier s on s.id = cd.supplier_id
  where cd.id = p_document_id;
  if v_doc_account is null then
    raise exception 'apply_compliance_doc_allergens: el documento % no existe', p_document_id;
  end if;
  if v_doc_account <> v_account then
    raise exception 'apply_compliance_doc_allergens: documento e ingrediente de cuentas distintas';
  end if;

  v_reason := 'Ficha técnica' || coalesce(' ' || v_ref, '') || coalesce(' de ' || v_supplier, '');

  foreach v_code in array coalesce(p_contains, '{}'::text[]) loop
    insert into recipe_item_allergen (recipe_item_id, allergen_code, state, source, manual_reason, source_document_id)
    values (p_recipe_item_id, v_code, 'contains', 'manual', v_reason, p_document_id)
    on conflict (recipe_item_id, allergen_code) do update
      set state = 'contains', source = 'manual', manual_reason = v_reason, source_document_id = p_document_id;
  end loop;

  foreach v_code in array coalesce(p_may_contain, '{}'::text[]) loop
    insert into recipe_item_allergen (recipe_item_id, allergen_code, state, source, manual_reason, source_document_id)
    values (p_recipe_item_id, v_code, 'may_contain', 'manual', v_reason, p_document_id)
    on conflict (recipe_item_id, allergen_code) do update
      set state = 'may_contain', source = 'manual', manual_reason = v_reason, source_document_id = p_document_id;
  end loop;

  insert into compliance_document_link (document_id, entity_type, entity_id)
  values (p_document_id, 'recipe_item', p_recipe_item_id)
  on conflict do nothing;

  for v_dish in
    with recursive parents as (
      select parent_item_id as id from recipe_line where child_item_id = p_recipe_item_id
      union
      select rl.parent_item_id from recipe_line rl join parents pp on rl.child_item_id = pp.id
    )
    select distinct ri.id
    from parents pr
    join recipe_item ri on ri.id = pr.id
    where ri.type in ('dish', 'recipe')
  loop
    perform public._recompute_recipe_item_allergens(v_dish);
    v_recomputed := v_recomputed + 1;
  end loop;

  return jsonb_build_object(
    'ingredient_id',       p_recipe_item_id,
    'applied_contains',    coalesce(array_length(p_contains, 1), 0),
    'applied_may_contain', coalesce(array_length(p_may_contain, 1), 0),
    'dishes_recomputed',   v_recomputed
  );
end;
$$;

grant execute on function public.apply_compliance_doc_allergens(uuid, uuid, text[], text[]) to authenticated;

notify pgrst, 'reload schema';
