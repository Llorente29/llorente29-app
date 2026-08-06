-- 20260806T1500_apply_compliance_doc_allergens_complete_profile.sql
-- Aplicada: 2026-08-06 por MCP (apply_migration). Verificada.
-- Sustituye la versión de 20260806T1400: una ficha de alimento (food_spec) es una
-- declaración COMPLETA de los 14 alérgenos. Al aplicarla, el ingrediente queda con el
-- perfil ENTERO: declarado -> contains/may_contain; el resto -> free. TODO source='manual'
-- + source_document_id. Las suposiciones de IA (ai_enrich) NO sobreviven: pasan a "libre
-- según ficha" (más fuerte ante inspección que borrarlas). Guarda: solo food_spec.

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
  v_doc_family  text;
  v_ref         text;
  v_supplier    text;
  v_reason      text;
  v_code        text;
  v_state       text;
  v_dish        uuid;
  v_recomputed  int := 0;
  v_n_contains  int := coalesce(array_length(p_contains, 1), 0);
  v_n_may       int := coalesce(array_length(p_may_contain, 1), 0);
begin
  select account_id into v_account from recipe_item where id = p_recipe_item_id;
  if v_account is null then
    raise exception 'apply_compliance_doc_allergens: el ingrediente % no existe', p_recipe_item_id;
  end if;
  if not public.current_user_is_admin_or_manager_of(v_account) then
    raise exception 'apply_compliance_doc_allergens: sin acceso a la cuenta %', v_account;
  end if;

  select cd.account_id, cd.doc_family, cd.reference, s.name
    into v_doc_account, v_doc_family, v_ref, v_supplier
  from compliance_document cd
  left join supplier s on s.id = cd.supplier_id
  where cd.id = p_document_id;
  if v_doc_account is null then
    raise exception 'apply_compliance_doc_allergens: el documento % no existe', p_document_id;
  end if;
  if v_doc_account <> v_account then
    raise exception 'apply_compliance_doc_allergens: documento e ingrediente de cuentas distintas';
  end if;
  if v_doc_family is distinct from 'food_spec' then
    raise exception 'apply_compliance_doc_allergens: solo las fichas de alimento (food_spec) declaran alérgenos (familia=%)', v_doc_family;
  end if;

  v_reason := 'Ficha técnica' || coalesce(' ' || v_ref, '') || coalesce(' de ' || v_supplier, '');

  -- Perfil COMPLETO de los 14: declarado -> contiene/trazas; el resto -> libre. Todo manual + respaldo.
  for v_code, v_state in
    select a.code,
      case
        when a.code = any(coalesce(p_contains,    '{}'::text[])) then 'contains'
        when a.code = any(coalesce(p_may_contain, '{}'::text[])) then 'may_contain'
        else 'free'
      end
    from allergen a
  loop
    insert into recipe_item_allergen (recipe_item_id, allergen_code, state, source, manual_reason, source_document_id)
    values (p_recipe_item_id, v_code, v_state, 'manual', v_reason, p_document_id)
    on conflict (recipe_item_id, allergen_code) do update
      set state = excluded.state, source = 'manual', manual_reason = v_reason, source_document_id = p_document_id;
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
    'applied_contains',    v_n_contains,
    'applied_may_contain', v_n_may,
    'applied_free',        greatest(0, (select count(*) from allergen) - v_n_contains - v_n_may),
    'dishes_recomputed',   v_recomputed
  );
end;
$$;

grant execute on function public.apply_compliance_doc_allergens(uuid, uuid, text[], text[]) to authenticated;

notify pgrst, 'reload schema';
