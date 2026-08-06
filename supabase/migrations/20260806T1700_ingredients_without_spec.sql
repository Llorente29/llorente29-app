-- 20260806T1700_ingredients_without_spec.sql
-- Aplicada: 2026-08-06 por MCP. Verificada (lógica interna; el guard belongs_to_account
-- se valida desde la app, no en SQL Editor sin sesión).
-- Vista inversa del archivo: ingredientes (raw) SIN ficha técnica (food_spec) enlazada,
-- con su proveedor preferente — para saber a quién reclamar la ficha.
create or replace function public.ingredients_without_spec(p_account_id uuid)
returns table (
  ingredient_id   uuid,
  ingredient_name text,
  supplier_id     uuid,
  supplier_name   text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.belongs_to_account(p_account_id) then
    raise exception 'ingredients_without_spec: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  select ri.id, ri.name, asup.supplier_id, s.name
  from recipe_item ri
  left join lateral (
    select a.supplier_id
    from article_supplier a
    where a.recipe_item_id = ri.id and coalesce(a.is_active, true)
    order by a.is_preferred desc nulls last, a.updated_at desc nulls last
    limit 1
  ) asup on true
  left join supplier s on s.id = asup.supplier_id
  where ri.account_id = p_account_id
    and ri.type = 'raw'
    and coalesce(ri.is_active, true)
    and not exists (
      select 1
      from compliance_document_link cdl
      join compliance_document cd on cd.id = cdl.document_id
      where cdl.entity_type = 'recipe_item'
        and cdl.entity_id = ri.id
        and cd.doc_family = 'food_spec'
        and cd.status <> 'superseded'
    )
  order by s.name nulls last, ri.name;
end;
$$;

grant execute on function public.ingredients_without_spec(uuid) to authenticated;

notify pgrst, 'reload schema';
