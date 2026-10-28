-- scripts/conta/produccion/cuentas/w10-funciones-leen-su-proyecto.sql
--
-- W10 · LO QUE CUENTA LA TANDA (1440 y 1441), antes y después. SOLO LEE, y
-- solo el catálogo (pg_proc) y el Vault por su huella: nada crece solo.
-- Antes: 23 funciones con una dirección escrita, 0 que la lean del Vault y las
-- tres nuevas sin crear. Tras la tanda: 0, 23 y 3. Tras la vuelta atrás: como
-- antes, y la huella de las 23 igual.
select clave, valor from (
  select 1 o, 'funciones con una dirección de proyecto escrita' clave,
    (select count(*) from pg_proc p where p.prokind = 'f' and pg_get_functiondef(p.oid) ~ 'https://[a-z0-9]{20}\.supabase\.co/functions/v1/')::text valor union all
  select 2, 'funciones que leen la dirección del Vault (_project_url)',
    (select count(*) from pg_proc p where p.prokind = 'f' and p.pronamespace = 'public'::regnamespace
       and p.proname not in ('_project_url', '_project_url_si_hay') and pg_get_functiondef(p.oid) ~ '_project_url')::text union all
  select 3, 'funciones nuevas (_project_url, _project_url_si_hay, _aviso_falta_en_vault)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('_project_url', '_project_url_si_hay', '_aviso_falta_en_vault'))::text union all
  select 4, 'huella de las 23 (md5 de sus md5, en orden)',
    (select left(md5(string_agg(md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)), 12) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in (
        '_set_brand_closure_core', 'conta_diez_despertar', 'conta_lote_releer_lanzar', 'conta_recibida_pdf_despertar',
        'conta_recordatorios_despertar', 'db_health_connection_guard', 'last_catalog_import_dispatch', 'last_catalog_sync_dispatch',
        'push_location_opening_hours', 'request_social_generation', 'set_location_status', 'set_location_status_by_token',
        'set_modifier_option_availability', 'set_modifier_option_availability_by_token', 'set_product_availability',
        'set_product_availability_by_token', 'set_products_availability_bulk', 'set_products_availability_bulk_by_token',
        'system_alert_queue_drain', 'tg_auto_dispatch', 'trg_sale_push_status', 'verifactu_despertar', 'verifactu_despertar_cuadre')) union all
  select 5, 'project_url en el Vault (huella corta)',
    coalesce((select left(md5(decrypted_secret), 12) from vault.decrypted_secrets where name = 'project_url'), 'no existe')
) t order by o;
