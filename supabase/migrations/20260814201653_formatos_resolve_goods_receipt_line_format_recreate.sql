create or replace function public.resolve_goods_receipt_line_format(
  p_account_id uuid,
  p_ai_session_id uuid,
  p_recipe_item_id uuid,
  p_raw_text text,
  p_supplier_id uuid,
  p_created_by uuid default null,
  p_created_by_name text default null
) returns table (
  purchase_format_id uuid,
  qty_in_base_per_pack numeric,
  supplier_code text,
  doc_qty numeric,
  doc_amount numeric,
  map_source text,
  map_needs_review boolean,
  discrepancy_reason text,
  ocr_qty_in_base numeric,
  ficha_qty_in_base numeric
)
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  v_pack_size numeric;
  v_pack_unit text;
  v_format_name text;
  v_supplier_code text;
  v_doc_qty numeric;
  v_doc_amount numeric;
  v_base_abbr text;
  v_base_dim text;
  v_ocr_qty numeric;
  v_ocr_rule text;
  v_ficha_format_id uuid;
  v_ficha_qty numeric;
  v_ficha_count int;
  v_result_format_id uuid;
  v_result_qty numeric;
  v_map_source text;
  v_needs_review boolean := false;
  v_reason text := null;
begin
  if not belongs_to_account(p_account_id) then
    raise exception 'No autorizado para esta cuenta.';
  end if;

  if p_ai_session_id is not null and p_raw_text is not null and p_raw_text <> '' then
    select (ln->>'pack_size')::numeric, ln->>'pack_unit', ln->>'format_name',
           nullif(ln->>'supplier_code',''),
           coalesce((ln->>'packages')::numeric, (ln->>'quantity')::numeric),
           (ln->>'line_amount')::numeric
      into v_pack_size, v_pack_unit, v_format_name, v_supplier_code, v_doc_qty, v_doc_amount
    from goods_receipt_ai_session s
    cross join lateral jsonb_array_elements(s.parsed_result->'lines') as ln
    where s.id = p_ai_session_id and ln->>'raw_text' = p_raw_text
    limit 1;
  end if;

  if p_recipe_item_id is not null then
    select ku.abbreviation, ku.dimension into v_base_abbr, v_base_dim
    from recipe_item ri join kitchen_unit ku on ku.id = ri.base_unit_id
    where ri.id = p_recipe_item_id;
  end if;

  if v_pack_size is not null and v_base_dim is not null then
    select i.qty_in_base, i.rule_id into v_ocr_qty, v_ocr_rule
    from _interpret_pack_size(v_pack_size, v_pack_unit, coalesce(p_raw_text,''), v_base_abbr, v_base_dim) i;
    if v_ocr_rule = 'NO_RESUELTO' then v_ocr_qty := null; end if;
  end if;

  if p_supplier_id is not null and p_recipe_item_id is not null then
    if v_supplier_code is not null then
      select a.purchase_format_id into v_ficha_format_id
      from article_supplier a
      where a.recipe_item_id = p_recipe_item_id and a.supplier_id = p_supplier_id
        and a.supplier_code = v_supplier_code and a.is_active
      limit 1;
    else
      select count(*) into v_ficha_count
      from article_supplier a
      where a.recipe_item_id = p_recipe_item_id and a.supplier_id = p_supplier_id and a.is_active;
      if v_ficha_count = 1 then
        select a.purchase_format_id into v_ficha_format_id
        from article_supplier a
        where a.recipe_item_id = p_recipe_item_id and a.supplier_id = p_supplier_id and a.is_active
        limit 1;
      end if;
    end if;
    if v_ficha_format_id is not null then
      select f.qty_in_base into v_ficha_qty
      from recipe_item_purchase_format f
      where f.id = v_ficha_format_id and f.is_active;
    end if;
  end if;

  if v_ocr_qty is not null and v_ficha_qty is not null then
    if abs(v_ocr_qty - v_ficha_qty) < 0.01 then
      v_result_format_id := v_ficha_format_id; v_result_qty := v_ficha_qty; v_map_source := 'ocr_ficha_coinciden';
    else
      v_result_format_id := null; v_result_qty := null; v_map_source := 'discrepancia'; v_needs_review := true;
      v_reason := format('El documento dice %s y la ficha dice %s (unidad base).', v_ocr_qty, v_ficha_qty);
    end if;
  elsif v_ocr_qty is not null then
    select f.id into v_result_format_id
    from recipe_item_purchase_format f
    where f.account_id = p_account_id and f.item_id = p_recipe_item_id and f.is_active
      and abs(f.qty_in_base - v_ocr_qty) < 0.01
    limit 1;
    if v_result_format_id is null then
      insert into recipe_item_purchase_format (account_id, item_id, name, qty_in_base, source, needs_review, is_active, created_by, created_by_name)
      values (p_account_id, p_recipe_item_id, coalesce(nullif(v_format_name,''), 'Formato del albarán'), v_ocr_qty, 'albaran', true, true, p_created_by, p_created_by_name)
      returning id into v_result_format_id;
      v_needs_review := true;
    end if;
    v_result_qty := v_ocr_qty; v_map_source := 'ocr';
    if p_supplier_id is not null then
      update article_supplier a set
          account_id = p_account_id,
          purchase_format_id = v_result_format_id,
          supplier_code = coalesce(v_supplier_code, a.supplier_code),
          updated_at = now()
        where a.recipe_item_id = p_recipe_item_id and a.supplier_id = p_supplier_id;
      if not found then
        insert into article_supplier (account_id, recipe_item_id, supplier_id, supplier_code, purchase_format_id, is_active)
        values (p_account_id, p_recipe_item_id, p_supplier_id, v_supplier_code, v_result_format_id, true);
      end if;
    end if;
  elsif v_ficha_qty is not null then
    v_result_format_id := v_ficha_format_id; v_result_qty := v_ficha_qty; v_map_source := 'ficha';
  else
    v_result_format_id := null; v_result_qty := null; v_map_source := 'sin_formato'; v_needs_review := true;
    v_reason := 'Ni el documento ni la ficha del proveedor dicen el formato.';
  end if;

  return query select v_result_format_id, v_result_qty, v_supplier_code, v_doc_qty, v_doc_amount,
                      v_map_source, v_needs_review, v_reason, v_ocr_qty, v_ficha_qty;
end;
$$;

do $$
declare v_count int;
begin
  select count(*) into v_count from pg_proc where proname = 'resolve_goods_receipt_line_format';
  if v_count <> 1 then raise exception 'guard: se esperaba 1 funcion resolve_goods_receipt_line_format, hay %', v_count; end if;
end $$;