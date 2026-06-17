-- supabase/migrations/20260617T1800_al1_item_stock_views.sql
--
-- AL1 — Ficha del artículo viva: dos lecturas.
--   item_stock_by_location: saldo de UN artículo en cada local de la cuenta
--     (cantidad, WAC, valor) + el formato de compra de referencia para mostrarlo
--     legible (≈ N cajas), igual que en Existencias.
--   item_movements: histórico de UN artículo en TODOS sus locales, con el nombre
--     del local y la referencia resuelta (misma lógica que list_stock_movements).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Stock del artículo por local
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.item_stock_by_location(
  p_account uuid,
  p_recipe_item uuid
) returns jsonb
language sql
security invoker
set search_path to 'public'
as $$
with bf as (
  select pf.name, pf.qty_in_base, pf.is_piece
  from recipe_item_purchase_format pf
  where pf.item_id = p_recipe_item
    and pf.account_id = p_account
    and pf.parent_format_id is null
    and pf.is_active = true
    and pf.archived_at is null
  order by pf.qty_in_base desc
  limit 1
),
rows as (
  select l.id as location_id, l.name as location_name,
         coalesce(ril.qty_on_hand, 0) as qty,
         coalesce(ril.stock_value, 0) as value_eur,
         ril.recipe_item_id is not null as has_stock_row
  from locations l
  left join recipe_item_location_stock ril
    on ril.location_id = l.id
   and ril.recipe_item_id = p_recipe_item
   and ril.account_id = p_account
  where l.account_id = p_account
)
select jsonb_build_object(
  'unit_abbr', (select ku.abbreviation from recipe_item ri left join kitchen_unit ku on ku.id = ri.base_unit_id where ri.id = p_recipe_item),
  'buy_format_name', (select name from bf),
  'buy_format_qty_in_base', (select qty_in_base from bf),
  'total_qty', (select coalesce(sum(qty), 0) from rows),
  'total_value', (select coalesce(sum(value_eur), 0) from rows),
  'locations', coalesce((
    select jsonb_agg(jsonb_build_object(
             'location_id', r.location_id, 'location_name', r.location_name,
             'qty', r.qty, 'value_eur', r.value_eur, 'has_stock_row', r.has_stock_row
           ) order by r.value_eur desc nulls last, r.location_name asc)
    from rows r
  ), '[]'::jsonb)
);
$$;

grant execute on function public.item_stock_by_location(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Movimientos del artículo en todos los locales (con nombre de local)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.item_movements(
  p_account uuid,
  p_recipe_item uuid,
  p_limit int default 50
) returns jsonb
language sql
security invoker
set search_path to 'public'
as $$
with base as (
  select sm.id, sm.movement_type, sm.source_type, sm.source_id, sm.location_id,
         sm.qty_base, sm.unit_cost, sm.occurred_at, sm.created_by_name, sm.notes,
         l.name as location_name
  from stock_movement sm
  left join locations l on l.id = sm.location_id
  where sm.account_id = p_account
    and sm.recipe_item_id = p_recipe_item
  order by sm.occurred_at desc
  limit greatest(p_limit, 0)
),
resolved as (
  select b.*,
    case b.source_type
      when 'sale' then (
        select trim(both ' ·' from
          coalesce(sc.name, initcap(s.external_channel_text), 'Venta')
          || coalesce(' · ' || nullif((case when left(btrim(s.raw_tab),1) = '{' then s.raw_tab::jsonb->>'code' else null end), ''), ''))
        from sale_line sl
        join sale s on s.id = sl.sale_id
        left join sales_channel sc on sc.id = s.channel_id
        where sl.id = b.source_id
      )
      when 'goods_receipt_line' then (
        select coalesce(gr.code, 'Recepción') || coalesce(' · ' || nullif(gr.supplier_doc_number, ''), '')
        from goods_receipt_line grl join goods_receipt gr on gr.id = grl.goods_receipt_id
        where grl.id = b.source_id
      )
      when 'adjustment' then (select 'Ajuste · ' || sa.reason_code from stock_adjustment sa where sa.id = b.source_id)
      when 'waste' then (select 'Merma · ' || sw.reason_code from stock_waste sw where sw.id = b.source_id)
      when 'transfer' then (
        select case when st.from_location_id = b.location_id then '→ ' || coalesce(lt.name, 'otro local')
                    else '← ' || coalesce(lf.name, 'otro local') end
        from stock_transfer st
        left join locations lf on lf.id = st.from_location_id
        left join locations lt on lt.id = st.to_location_id
        where st.id = b.source_id
      )
      else null
    end as reference
  from base b
)
select coalesce((
  select jsonb_agg(jsonb_build_object(
           'id', r.id, 'movement_type', r.movement_type, 'source_type', r.source_type,
           'location_name', r.location_name, 'qty_base', r.qty_base, 'unit_cost', r.unit_cost,
           'cost_eur', round(abs(r.qty_base) * coalesce(r.unit_cost, 0), 2),
           'occurred_at', r.occurred_at, 'created_by_name', r.created_by_name,
           'reference', r.reference, 'notes', r.notes
         ) order by r.occurred_at desc)
  from resolved r
), '[]'::jsonb);
$$;

grant execute on function public.item_movements(uuid, uuid, int) to authenticated;
