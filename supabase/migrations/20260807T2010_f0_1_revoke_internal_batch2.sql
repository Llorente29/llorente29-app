-- Aplicada: 2026-08-07 por MCP. Verificado: los 31 sin anon, authenticated/service_role conservan.
-- Total anon-exec DEFINER: 322 -> 281 (lote 1 + lote 2).
-- F0.1 (lote 2) · revoke EXECUTE de PUBLIC y de ANON (algunas tenían grant directo a anon) + re-grant
-- authenticated/service_role, en 31 funciones claramente internas: motor de coste/stock anidado (owner),
-- analítica de dashboards (authenticated), reconciliación de ventas (admin), compliance/cron.
-- Ninguna superficie sin sesión (shop/tablet/agentes/courier) las llama. Reversible: grant ... to anon.
do $$
declare r record;
  v_names text[] := array[
    'compute_sale_line_consumption','generate_sale_consumption','revert_sale_consumption',
    'explode_recipe_to_raws','fill_line_discounts','omnibus_ref_price',
    'recompute_location_stock','recompute_location_stock_core','recompute_purchase_order_status',
    'map_sales_product_to_dish','resolve_sale_brand_from_map','auto_map_exact_sales','resolve_mapping_proposals',
    'kitchen_dishes_incomplete','kitchen_raw_usage_counts','kitchen_recipe_cost_by_location','kitchen_recompute_raw_cost',
    'recipe_item_has_unmeasurable_line','recipe_item_unmeasurable_raws','ingredients_without_spec',
    'location_demand_pct','location_economics','location_labor_cost','menu_item_units_sold','sales_dashboard',
    'anomalous_brand_closures','appcc_mark_overdue','apply_compliance_doc_allergens',
    'evaluate_campaign_rules','cron_generate_daily_counts','can_operate_manual_count'
  ];
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(v_names)
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
