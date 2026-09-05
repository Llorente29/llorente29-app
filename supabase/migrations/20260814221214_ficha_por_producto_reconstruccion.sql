do $$
declare
  v_account_id uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  rec record;
  v_format_id uuid;
begin
  create temp table _reconstruccion on commit drop as
  with lineas as (
    select gr.supplier_id, grl.supplier_code, grl.recipe_item_id, grl.qty_in_base, grl.raw_text, grl.qty_received
    from goods_receipt_line grl
    join goods_receipt gr on gr.id = grl.goods_receipt_id
    where gr.account_id = v_account_id
      and grl.supplier_code is not null and grl.supplier_code <> ''
      and gr.supplier_id is not null and grl.recipe_item_id is not null
      and grl.qty_in_base is not null and grl.qty_received is not null and grl.qty_received > 0
  ),
  por_codigo_articulo as (
    select supplier_id, supplier_code, recipe_item_id, count(*) as n
    from lineas group by supplier_id, supplier_code, recipe_item_id
  ),
  dominante as (
    select distinct on (supplier_id, supplier_code)
      supplier_id, supplier_code, recipe_item_id as articulo_dominante, n as n_lineas_dominante
    from por_codigo_articulo order by supplier_id, supplier_code, n desc
  ),
  qty_dominante as (
    select d.supplier_id, d.supplier_code, d.articulo_dominante, d.n_lineas_dominante,
      percentile_cont(0.5) within group (order by l.qty_in_base / l.qty_received) as qty_por_base_mediana
    from dominante d
    join lineas l on l.supplier_id=d.supplier_id and l.supplier_code=d.supplier_code and l.recipe_item_id=d.articulo_dominante
    group by d.supplier_id, d.supplier_code, d.articulo_dominante, d.n_lineas_dominante
  ),
  ficha_actual as (
    select supplier_id, supplier_code, recipe_item_id from article_supplier where supplier_code is not null
  )
  select q.*
  from qty_dominante q
  left join ficha_actual fa on fa.supplier_id=q.supplier_id and fa.supplier_code=q.supplier_code
  where fa.recipe_item_id is null;

  create temp table _reconstruccion_interprete on commit drop as
  with raw_repr as (
    select distinct on (c.supplier_id, c.supplier_code)
      c.supplier_id, c.supplier_code, c.articulo_dominante, c.qty_por_base_mediana, grl.raw_text
    from _reconstruccion c
    join goods_receipt_line grl on grl.recipe_item_id = c.articulo_dominante and grl.supplier_code = c.supplier_code
    join goods_receipt gr on gr.id = grl.goods_receipt_id and gr.supplier_id = c.supplier_id
    where grl.raw_text is not null
    order by c.supplier_id, c.supplier_code, grl.created_at desc
  ),
  sesion_pack as (
    select distinct on (rr.supplier_id, rr.supplier_code)
      rr.supplier_id, rr.supplier_code, rr.articulo_dominante, rr.qty_por_base_mediana, rr.raw_text,
      (ln.value->>'pack_size')::numeric as pack_size, ln.value->>'pack_unit' as pack_unit
    from raw_repr rr
    join goods_receipt gr2 on gr2.supplier_id = rr.supplier_id
    join goods_receipt_ai_session s on s.id = gr2.ai_session_id
    cross join lateral jsonb_array_elements(s.parsed_result->'lines') as ln
    where ln.value->>'raw_text' = rr.raw_text and (ln.value->>'pack_size') is not null
  )
  select sp.supplier_id, sp.supplier_code, sp.articulo_dominante, sp.qty_por_base_mediana,
    i.qty_in_base as interprete_resultado, i.rule_id
  from sesion_pack sp
  join recipe_item ri on ri.id = sp.articulo_dominante
  join kitchen_unit ku on ku.id = ri.base_unit_id
  cross join lateral _interpret_pack_size(sp.pack_size, sp.pack_unit, sp.raw_text, ku.abbreviation, ku.dimension) i;

  for rec in
    select r.supplier_id, r.supplier_code, r.articulo_dominante, r.qty_por_base_mediana
    from _reconstruccion r
    where r.supplier_code in (
      select supplier_code from _reconstruccion_interprete
      where rule_id <> 'NO_RESUELTO' and abs(interprete_resultado - qty_por_base_mediana) < 0.01
    ) or (r.n_lineas_dominante >= 3 and r.supplier_code not in (select supplier_code from _reconstruccion_interprete))
  loop
    select id into v_format_id
    from recipe_item_purchase_format
    where account_id = v_account_id and item_id = rec.articulo_dominante and is_active
      and abs(qty_in_base - rec.qty_por_base_mediana) < 0.01
    limit 1;

    if v_format_id is null then
      insert into recipe_item_purchase_format (account_id, item_id, name, qty_in_base, source, needs_review, is_active)
      values (v_account_id, rec.articulo_dominante, 'Formato reconstruido', rec.qty_por_base_mediana, 'albaran', true, true)
      returning id into v_format_id;
    end if;

    insert into article_supplier (account_id, recipe_item_id, supplier_id, supplier_code, purchase_format_id, is_active, source)
    values (v_account_id, rec.articulo_dominante, rec.supplier_id, rec.supplier_code, v_format_id, true, 'albaran')
    on conflict do nothing;
  end loop;
end $$;