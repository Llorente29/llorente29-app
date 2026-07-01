-- ============================================================================
-- suggest_purchase_qty — Motor de sugerencia de repedido (To-Par MRP II)
-- ----------------------------------------------------------------------------
-- Para cada artículo del catálogo de un proveedor, calcula cuánto pedir para
-- cubrir un horizonte (default 7 días), redondeado AL ALZA al formato de compra
-- preferente (article_supplier.purchase_format_id). Cascada de confianza (para
-- en la primera fuente con señal):
--   1) par manual (stock_level.par_qty)          -> source 'par',       alta
--   2) consumo real x horizonte (ledger 'consumo', 30d) -> 'consumo',   alta
--   3) histórico de pedidos (media semanal, 60d) -> source 'historico', media
--   4) sin señal                                 -> source 'none' + NULL
-- Reglas: nunca negativo; techo (ceil) al formato; cubrir >= horizonte.
-- Solo LECTURA. Cantidades devueltas en FORMATO DE COMPRA (cajas), no base.
-- Verificado con datos reales (Plaza Castilla) el 01/07/2026: bug de formato
-- corregido (usa el preferente de compra, no "el más pequeño").
-- ============================================================================
create or replace function suggest_purchase_qty(
  p_account     uuid,
  p_supplier    uuid,
  p_location    uuid,
  p_horizon_days int  default 7,
  p_hist_days    int  default 60,
  p_consumo_days int  default 30
)
returns table (
  recipe_item_id  uuid,
  suggested_qty   numeric,
  source          text,
  confidence      text,
  format_qty_base numeric,
  needed_base     numeric
)
language sql
security definer
set search_path = public
as $$
  with cat as (
    select distinct a.recipe_item_id
    from article_supplier a
    where a.account_id = p_account
      and a.supplier_id = p_supplier
      and a.is_active = true
  ),
  fmt as (
    -- formato PREFERENTE de compra de este proveedor
    -- (article_supplier.purchase_format_id), NO "el más pequeño". Es el mismo
    -- formato por el que se pide y que ve el comprador ("Caja 18 kg"). Fallback:
    -- si el preferente no tiene qty_in_base válido, base = 1 (pide en base).
    select
      a.recipe_item_id as item_id,
      coalesce(nullif(f.qty_in_base, 0), 1)::numeric as qty_base
    from article_supplier a
    left join recipe_item_purchase_format f
      on f.id = a.purchase_format_id and f.account_id = p_account
    where a.account_id = p_account
      and a.supplier_id = p_supplier
      and a.is_active = true
  ),
  stock as (
    select s.recipe_item_id, coalesce(s.qty_on_hand, 0)::numeric as on_hand
    from recipe_item_location_stock s
    where s.account_id = p_account and s.location_id = p_location
  ),
  par as (
    select l.recipe_item_id, l.par_qty::numeric as par_qty
    from stock_level l
    where l.account_id = p_account and l.location_id = p_location
      and l.par_qty is not null and l.par_qty > 0
  ),
  consumo as (
    select m.recipe_item_id,
           sum(abs(m.qty_base)) / nullif(p_consumo_days, 0)::numeric as diario_base
    from stock_movement m
    where m.account_id = p_account
      and m.location_id = p_location
      and m.movement_type = 'consumo'
      and m.occurred_at >= now() - make_interval(days => p_consumo_days)
    group by m.recipe_item_id
    having sum(abs(m.qty_base)) > 0
  ),
  hist as (
    select pol.recipe_item_id,
           sum(pol.qty_ordered)::numeric
             / nullif(p_hist_days, 0)::numeric * 7 as semanal_fmt
    from purchase_order_line pol
    join purchase_order po on po.id = pol.purchase_order_id
    where pol.account_id = p_account
      and po.location_id = p_location
      and po.status not in ('cancelado', 'borrador')
      and po.order_date >= (now() - make_interval(days => p_hist_days))::date
      and pol.recipe_item_id is not null
    group by pol.recipe_item_id
    having sum(pol.qty_ordered) > 0
  )
  select
    c.recipe_item_id,
    case
      when p.par_qty is not null then
        greatest(0, ceil( greatest(p.par_qty - coalesce(st.on_hand,0), 0) / f.qty_base ))
      when co.diario_base is not null then
        greatest(0, ceil( greatest(co.diario_base * p_horizon_days - coalesce(st.on_hand,0), 0) / f.qty_base ))
      when h.semanal_fmt is not null then
        greatest(0, ceil( greatest(
          h.semanal_fmt * (p_horizon_days::numeric / 7) - coalesce(st.on_hand,0) / f.qty_base
        , 0) ))
      else null
    end as suggested_qty,
    case
      when p.par_qty  is not null then 'par'
      when co.diario_base is not null then 'consumo'
      when h.semanal_fmt is not null then 'historico'
      else 'none'
    end as source,
    case
      when p.par_qty is not null then 'alta'
      when co.diario_base is not null then 'alta'
      when h.semanal_fmt is not null then 'media'
      else null
    end as confidence,
    f.qty_base as format_qty_base,
    case
      when p.par_qty is not null then greatest(p.par_qty - coalesce(st.on_hand,0), 0)
      when co.diario_base is not null then greatest(co.diario_base * p_horizon_days - coalesce(st.on_hand,0), 0)
      else null
    end as needed_base
  from cat c
  left join fmt f  on f.item_id = c.recipe_item_id
  left join stock st on st.recipe_item_id = c.recipe_item_id
  left join par p  on p.recipe_item_id = c.recipe_item_id
  left join consumo co on co.recipe_item_id = c.recipe_item_id
  left join hist h on h.recipe_item_id = c.recipe_item_id;
$$;

grant execute on function suggest_purchase_qty(uuid, uuid, uuid, int, int, int) to authenticated;
