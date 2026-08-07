-- Aplicada: 2026-08-07 por MCP. Verificado: anon sin EXECUTE, authenticated/service_role conservan.
-- F0.1 (lote 1 seguro) · Revoca EXECUTE de PUBLIC (anon lo heredaba) en 10 funciones puramente internas
-- (migración/onboarding-admin/mantenimiento/editor de recetas) que NINGUNA superficie sin sesión
-- (shop/tablet/agentes/courier) llama. Se re-concede a authenticated + service_role.
-- Reversible: grant execute on function <sig> to anon.
-- Lección: revocar de anon NO basta si PUBLIC tiene el grant; hay que revoke from public + re-grant.
do $$
declare r record;
  v_names text[] := array[
    'migrate_brands_and_map','migrate_kitchen_core','migrate_locations_and_staff',
    'clone_brand_catalog','seed_appcc_for_account',
    'cleanup_auth_rate_limits','force_close_long_impersonations',
    'build_course_content_snapshot','duplicate_recipe_item','materialize_recipe_session'
  ];
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(v_names)
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
