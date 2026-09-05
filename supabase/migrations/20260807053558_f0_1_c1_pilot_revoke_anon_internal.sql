do $$
declare
  r record;
  names text[] := array[
   '_shop_account_free_gift','_shop_account_free_delivery','_shop_brand_best_offer',
   '_shop_brand_free_gift','_shop_item_bogo','_shop_item_offer','_shop_item_promo',
   '_shop_reprice_line','_generate_daily_count_core','recast_lastapp_sales',
   'apply_appcc_assignment_moments','onboard_account','seed_ingredient_families_for_account',
   'seed_staff_roles_for_account','seed_vacation_settings_for_account'];
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(names)
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;