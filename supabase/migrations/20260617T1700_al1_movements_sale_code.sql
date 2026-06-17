-- supabase/migrations/20260617T1700_al1_movements_sale_code.sql
--
-- AL1 — Fix referencia de venta en el histórico: el número de pedido legible
-- (U356, G829…) vive en sale.raw_tab->>'code', no en external_ref (que es un
-- UUID interno). Reescribe SOLO list_stock_movements con ese cambio.

create or replace function public.list_stock_movements(
  p_account uuid,
  p_location uuid,
  p_types text[] default null,   -- filtra por movement_type; null = todos
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 200,
  p_offset int default 0
) returns jsonb
language sql
security invoker
set search_path to 'public'
as $$
with base as (
  select sm.id, sm.movement_type, sm.source_type, sm.source_id,
         sm.qty_base, sm.unit_cost, sm.occurred_at, sm.created_by_name, sm.notes,
         ri.name as item_name,
         ku.abbreviation as unit_abbr
  from stock_movement sm
  join recipe_item ri on ri.id = sm.recipe_item_id
  left join kitchen_unit ku on ku.id = ri.base_unit_id
  where sm.account_id = p_account
    and sm.location_id = p_location
    and (p_types is null or sm.movement_type = any(p_types))
    and (p_from is null or sm.occurred_at >= p_from)
    and (p_to is null or sm.occurred_at < p_to)
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
        select coalesce(gr.code, 'Recepción')
          || coalesce(' · ' || nullif(gr.supplier_doc_number, ''), '')
        from goods_receipt_line grl
        join goods_receipt gr on gr.id = grl.goods_receipt_id
        where grl.id = b.source_id
      )
      when 'adjustment' then (
        select 'Ajuste · ' || sa.reason_code from stock_adjustment sa where sa.id = b.source_id
      )
      when 'waste' then (
        select 'Merma · ' || sw.reason_code from stock_waste sw where sw.id = b.source_id
      )
      when 'transfer' then (
        select case
          when st.from_location_id = p_location then '→ ' || coalesce(lt.name, 'otro local')
          else '← ' || coalesce(lf.name, 'otro local')
        end
        from stock_transfer st
        left join locations lf on lf.id = st.from_location_id
        left join locations lt on lt.id = st.to_location_id
        where st.id = b.source_id
      )
      else null
    end as reference
  from base b
)
select jsonb_build_object(
  'total', (select count(*) from base),
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id,
             'movement_type', r.movement_type,
             'source_type', r.source_type,
             'item_name', r.item_name,
             'unit_abbr', r.unit_abbr,
             'qty_base', r.qty_base,
             'unit_cost', r.unit_cost,
             'cost_eur', round(abs(r.qty_base) * coalesce(r.unit_cost, 0), 2),
             'occurred_at', r.occurred_at,
             'created_by_name', r.created_by_name,
             'reference', r.reference,
             'notes', r.notes
           ) order by r.occurred_at desc)
    from (
      select * from resolved order by occurred_at desc
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    ) r
  ), '[]'::jsonb)
);
$$;

grant execute on function public.list_stock_movements(uuid, uuid, text[], timestamptz, timestamptz, int, int) to authenticated;
