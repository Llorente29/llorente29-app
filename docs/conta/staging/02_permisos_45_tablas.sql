-- docs/conta/staging/02_permisos_45_tablas.sql
--
-- Corrección tras la copia con pg_dump: en 45 tablas, producción NO da ningún
-- permiso a anon (y a veces tampoco a authenticated), pero en la rama quedaban
-- con Dxtm (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN), heredados de los
-- privilegios por defecto de la rama, que el REVOKE del volcado no quitaba.
-- Generado desde producción (aclexplode de relacl) el 01/10/2026. ALL en PG17
-- = DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE.
-- Solo para staging-conta.
do $$
declare
  t text;
  todas text[] := array['_a1_anuladas','_a2_cache_antes','_a3_antes','_a3_cola','_backup_a5_sellado_20260903',
    '_backup_article_supplier_20260810','_backup_article_supplier_20260815','_backup_article_supplier_ctb_20260811',
    '_backup_b49_julio_contaminado_20260903','_backup_kds_fn_20260811','_backup_kds_fn_20260811_pre0901',
    '_backup_permission_set_assignments_20260814','_backup_permission_sets_20260814','_backup_purchase_format_20260810',
    '_backup_purchase_order_20260810','break_policy','channel_publish_route','count_cadence','customer_otp',
    'customer_session','edge_function_deploy_state','external_webhook_log','football_team_city','holiday_calendar',
    'home_card_account','home_card_catalog','home_layout','home_role_default','hubrise_oauth_state',
    'hubrise_writer_connection','label_token','lastapp_webhook_log','menu_item_override_history','parte_plataformas',
    'platform_api_token','pos_ticket_counter','price_operation','sale_capture','sale_consumption_skip',
    'sale_verification','sales_hourly_agg','secret_expiry','social_n2_usage','system_alert_queue','weather_poll'];
  auth_todo text[] := array['break_policy','channel_publish_route','count_cadence','holiday_calendar','home_card_account',
    'home_card_catalog','home_layout','home_role_default','parte_plataformas','sales_hourly_agg'];
  auth_select text[] := array['menu_item_override_history','price_operation','sale_consumption_skip'];
begin
  foreach t in array todas loop
    execute format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated, service_role', t);
    execute format('GRANT ALL ON TABLE public.%I TO service_role', t);
  end loop;
  foreach t in array auth_select loop execute format('GRANT SELECT ON TABLE public.%I TO authenticated', t); end loop;
  -- El ORDEN de las concesiones cuenta para que el ACL quede idéntico al de
  -- producción (anon → authenticated → service_role): se rehacen en ese orden.
  foreach t in array auth_todo loop
    execute format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated, service_role', t);
    execute format('GRANT ALL ON TABLE public.%I TO authenticated', t);
    execute format('GRANT ALL ON TABLE public.%I TO service_role', t);
  end loop;
  execute 'REVOKE ALL ON TABLE public.football_team_city FROM anon, authenticated, service_role';
  execute 'GRANT MAINTAIN, SELECT ON TABLE public.football_team_city TO anon';
  execute 'GRANT MAINTAIN, SELECT ON TABLE public.football_team_city TO authenticated';
  execute 'GRANT ALL ON TABLE public.football_team_city TO service_role';
end $$;
-- Comprobado: huella de permisos de tablas c5d780308b89f235e981c886d2a5d4c4 en
-- producción y en la rama tras aplicarlo.
