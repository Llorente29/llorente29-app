-- supabase/migrations/20260617T1900_al1_item_movements_location.sql
--
-- AL1 — El historial del artículo en la ficha respeta el LOCAL activo del header.
-- Añade p_location opcional a item_movements: si viene un UUID, filtra ese local;
-- si null (header en "todos"), devuelve todos los locales. Firma nueva → regen.

create or replace function public.item_movements(
  p_account uuid,
  p_recipe_item uuid,
  p_location uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 200
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
    and (p_location is null or sm.location_id = p_location)
    and (p_from is null or sm.occurred_at >= p_from)
    and (p_to is null or sm.occurred_at < p_to)
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

-- Quita la firma anterior (sin p_location) para no dejar sobrecarga ambigua.
drop function if exists public.item_movements(uuid, uuid, timestamptz, timestamptz, int);

grant execute on function public.item_movements(uuid, uuid, uuid, timestamptz, timestamptz, int) to authenticated;
