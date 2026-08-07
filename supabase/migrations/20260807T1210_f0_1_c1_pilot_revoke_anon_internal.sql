-- Aplicada: 2026-08-07 por MCP (verificada en vivo: las 15 con anon=false, authenticated/service_role intactos)
-- F0.1 · c1 lote piloto — bloquear anon en 15 funciones DEFINER internas.
-- Enfoque: REVOKE anon (vía PUBLIC), MANTENER authenticated + service_role.
-- Cierra el acceso sin autenticar sin poder romper front/edge. El guard belongs_to_account
-- sobre authenticated va en un paso posterior (requiere grep de call-sites en el repo).
-- Recordatorio Postgres: el EXECUTE se hereda de PUBLIC → hay que revocar de PUBLIC, no solo de anon.

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

-- Guard: abortar si alguna de las 15 sigue anon-exec.
do $$
declare n int;
  names text[] := array[
   '_shop_account_free_gift','_shop_account_free_delivery','_shop_brand_best_offer',
   '_shop_brand_free_gift','_shop_item_bogo','_shop_item_offer','_shop_item_promo',
   '_shop_reprice_line','_generate_daily_count_core','recast_lastapp_sales',
   'apply_appcc_assignment_moments','onboard_account','seed_ingredient_families_for_account',
   'seed_staff_roles_for_account','seed_vacation_settings_for_account'];
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.proname = any(names)
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then
    raise exception 'c1 piloto incompleto: % siguen anon-exec', n;
  end if;
end $$;
