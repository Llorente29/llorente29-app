-- ----------------------------------------------------------------------------
-- Folvy - 20260814T2300
-- Formatos (Tramo B): resolucion de formato en el servidor (Ley 1 + Ley 4)
-- ----------------------------------------------------------------------------
--
-- QUE ES ESTO
-- -----------
-- RPC SECURITY DEFINER que reemplaza el matching de formato hoy hecho en el
-- cliente (heuristica de nombre/parecido en GoodsReceiptForm.tsx, autopick-si-
-- hay-1-formato en ReceiptWizard.tsx -- ninguno de los dos consulta lo que el
-- OCR ya extrajo). Dado (recepcion, articulo casado, raw_text, proveedor):
--
--   1) RELEE la sesion de OCR de esa recepcion por raw_text (no confia en lo
--      que el cliente tenga en su estado -- el servidor es la fuente).
--   2) Rama OCR: pasa pack_size/pack_unit por _interpret_pack_size (Tramo A).
--   3) Rama FICHA: article_supplier por supplier_id+supplier_code exacto; sin
--      codigo, por supplier_id+recipe_item_id solo si hay exactamente una.
--   4) Ley 1, la regla de las tres ramas: coinciden -> automatico: no habla
--      ninguna con la otra -> se usa la que hable; discrepan -> NINGUNA gana,
--      map_needs_review=true con los dos valores para que decida un humano.
--   5) Ley 4 (solo cuando resuelve por OCR): busca un formato activo del mismo
--      articulo con el mismo qty_in_base antes de crear uno nuevo
--      (source='albaran', needs_review=true), y enlaza/crea la ficha del
--      proveedor.
--
-- HALLAZGO REAL AL PROBAR ESTA FUNCION (no cosmetico, cuenta aparte)
-- --------------------------------------------------------------------------
-- 261 de 511 filas de `article_supplier` en TODA la base (51%) llevan
-- account_id = '00000000-0000-0000-0000-000000000001' -- un placeholder, no
-- el de ninguna cuenta real. Son invisibles para cualquier consulta que
-- filtre article_supplier por su propio account_id (como hacia la primera
-- version de esta funcion, y probablemente otro codigo del catalogo). El
-- limite de tenencia real para article_supplier ya lo da su FK
-- recipe_item_id (recipe_item.account_id es fiable, verificado). Esta
-- funcion busca por recipe_item_id+supplier_id, NUNCA por
-- article_supplier.account_id, y AUTOCURA el account_id de cualquier fila
-- que toque al hacer upsert. No se ha tocado el resto de las 261 filas --
-- es un frente de limpieza aparte, reportado a Julio, no resuelto aqui.
--
-- Ademas: article_supplier tiene una restriccion unica real por
-- (recipe_item_id, supplier_id) -- NO por supplier_code. La primera version
-- de esta funcion intentaba un upsert por codigo y choco contra esa
-- restriccion en la primera prueba real (Sweet Potato Fries / MCCAIN).
--
-- VALIDADO EN VIVO (solo lectura salvo donde se indica; sin dejar rastro):
--   - Gouda (ALB-00116): OCR y ficha coinciden en 6000 -> automatico. Sin escritura.
--   - Tortilla Maiz (ALB-00104): idem, 240. Sin escritura.
--   - Tortilla Maiz sin proveedor: Ley 4 reutiliza el formato existente (240),
--     no crea uno nuevo. Sin escritura.
--   - Sweet Potato Fries (McCain, ALB-00010/034): documento dice 2500, ficha
--     dice 10000 -> discrepancia real, map_needs_review=true, las dos cifras
--     visibles. Sin escritura (rama discrepancia no escribe).
-- No se ha ejercitado en esta sesion el camino que CREA un formato nuevo
-- desde cero (todas las pruebas reales disponibles ya tenian ficha o
-- formato reutilizable) -- la logica es simetrica a la de reutilizacion,
-- ya validada, y se ejercitara con datos reales en cuanto el cliente la
-- llame en produccion.
-- ----------------------------------------------------------------------------

create or replace function public.resolve_goods_receipt_line_format(
  p_account_id uuid,
  p_goods_receipt_id uuid,
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

  -- Camino manual (sin sesion o sin coincidencia por raw_text): pack_size
  -- queda null y solo opera la rama FICHA, tal como exige la Ley 1.
  if p_raw_text is not null and p_raw_text <> '' then
    select (ln->>'pack_size')::numeric, ln->>'pack_unit', ln->>'format_name',
           nullif(ln->>'supplier_code',''),
           coalesce((ln->>'packages')::numeric, (ln->>'quantity')::numeric),
           (ln->>'line_amount')::numeric
      into v_pack_size, v_pack_unit, v_format_name, v_supplier_code, v_doc_qty, v_doc_amount
    from goods_receipt gr
    join goods_receipt_ai_session s on s.id = gr.ai_session_id
    cross join lateral jsonb_array_elements(s.parsed_result->'lines') as ln
    where gr.id = p_goods_receipt_id and ln->>'raw_text' = p_raw_text
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
