# Allowlist `anon` EXECUTE — ampliada (07/08/2026)

## Hallazgo clave
El grep del repo (`.rpc(` en `src` + `supabase/functions`) es **necesario pero NO suficiente** para la
allowlist. Varias funciones se invocan con la **anon key desde fuera del repo** o desde superficies
**por-token** que no aparecen como `.rpc('nombre')` en `src`:
- **Agentes externos** (procesos Node fuera del repo, usan la publishable/anon key):
  - Impresión (`C:\folvy-print-agent`): `claim_print_jobs`, `report_print_job`, `order_for_print`,
    `enqueue_print_job`, `fiscal_for_print`, `report_device_app_version`, `report_platform_floor`.
  - Promo (`folvy-promo-agent`): `claim_promo_push_jobs`, `report_promo_push_job`, `get_promo_push_job_status`.
  - Imagen (`folvy-image-agent`): `claim_next_image_job`, `finish_image_job`, `fail_image_job`.
- **KDS / estación** (tablet con token de dispositivo): `kds_board`, `kds_bump`, `kds_unbump`,
  `kds_mark_line`, `kds_ack_alarm`, `kds_alarms`, `kds_authorize`, `kds_recipe`, `kds_set_default_station`,
  `kitchen_day_banner`, `location_status`, `brand_status`.
- **Tienda pública**: `resolve_delivery_zone`, `is_brand_open`, `closed_brands`, `brands_for_closure`,
  `adapt_folvy_shop_order`.
- **Reparto / courier**: `reparto_*`, `resolve_dispatch`, `location_surge_pct`, `location_surge_reason`,
  `sale_delivery_distance_km`, `upsert_courier`, `set_track_base_url`.
- **Notificaciones/despacho**: `enqueue_customer_notification`, `enqueue_training_notice`,
  `availability_notices`, `availability_ack_notice`, `set_customer_notify`.

Revocar `anon` de cualquiera de esas **rompe producción** (impresión, robots, KDS, tienda, reparto).

## Allowlist definitiva (CONSERVAR `anon`)
1. Las **161** del grep del repo.
2. Las **30 `*_by_token`** (auditadas: atan token→cuenta).
3. Las **9 funciones usadas en políticas RLS** (se ejecutan como el rol que consulta → anon las necesita).
4. Los **~30 nombres de arriba** (agentes externos + KDS + tienda + reparto + notificaciones).
5. Prefijos públicos `shop_*`, `customer_*`, `courier*`.

## Revocable de verdad (candidatas — CONFIRMAR superficie por superficie antes de tocar)
Tras quitar todo lo anterior, quedan funciones que parecen puramente internas (migraciones, seeds,
recomputos anidados, mantenimiento): `migrate_*`, `clone_brand_catalog`, `seed_appcc_for_account`,
`cleanup_auth_rate_limits`, `force_close_long_impersonations`, `materialize_recipe_session`,
`recompute_*`, `recost_*`, `revert_sale_consumption`, `generate_sale_consumption`,
`compute_sale_line_consumption`, `explode_recipe_to_raws`, `map_sales_product_to_dish`, etc.
Estas se ejecutan **anidadas (como owner)** o por **cron (service_role)**, así que en principio anon no las
necesita — pero antes de revocar hay que confirmar que ningún agente externo ni edge las llama con la anon
key. **No revocar a ciegas.**

## Procedimiento seguro recomendado (sesión dedicada)
1. Revisar los 3 agentes externos (`C:\folvy-print-agent`, `folvy-promo-agent`, `folvy-image-agent`) y
   apuntar TODA función que llamen por la anon key.
2. Revisar el cliente KDS/estación y el de courier: toda `.rpc`/`fetch` a `/rest/v1/rpc/...`.
3. Con la allowlist ya completa, revocar `anon` de las candidatas **en lotes pequeños**, verificando
   `has_function_privilege('anon', oid, 'EXECUTE')` y con **prueba de humo** de impresión + KDS + tienda +
   reparto tras cada lote. Reversible con `grant execute ... to anon`.

## Estado
El grep sirvió para acotar (de 322 anon-exec, ~200 son claramente allowlist). Pero el cierre de F0.1
necesita además el inventario de los agentes externos. Hasta entonces, **no se revoca nada** — la superficie
está entendida y documentada, que es lo que hacía falta para no romper producción.
