# RECON · Permisos de las funciones de `public` — el corte accionable

**Fecha:** 09/09/2026 · **Escribe:** nada. Lectura pura sobre `pg_proc`, `pg_depend` y las ACL.
**Origen:** la migración `20260909081014` declaró un permiso que no consiguió (`REVOKE FROM PUBLIC` no
quita los GRANT explícitos a `anon`/`authenticated`), Julio lo cazó y midió el patrón. Esto afina el corte.

## §1 · Las 3 sin `search_path` NO son nuestras — y ese frente está limpio

Preguntado a `pg_depend`, no al dueño:

| función | lenguaje | dueño | extensión |
|---|---|---|---|
| `st_estimatedextent(text,text,text,boolean)` | `c` | `supabase_admin` | **postgis** |
| `st_estimatedextent(text,text,text)` | `c` | `supabase_admin` | **postgis** |
| `st_estimatedextent(text,text)` | `c` | `supabase_admin` | **postgis** |

Son las tres sobrecargas de una función de PostGIS. **No se tocan:** `ALTER FUNCTION … SET search_path`
exige ser el dueño (lo es `supabase_admin`) y, aunque se pudiera, se perdería en la siguiente actualización
de la extensión. Un `ALTER` sobre objeto de extensión es deuda que vuelve sola.

**Y la consecuencia buena, que es el titular de verdad de este apartado:** quitando las de extensiones,
quedan **560 funciones `SECURITY DEFINER` nuestras, y las 560 llevan `search_path` fijo**. Ahí no hay nada
que arreglar. Lo que parecía «lo accionable ya son las 3» resulta ser «no hay accionable»: el frente del
`search_path` está cerrado.

## §2 · El corte que sí ordena: las que ESCRIBEN

De las 560 `SECURITY DEFINER` nuestras:

| | |
|---|---|
| llamables por `anon` | **301** |
| llamables por `authenticated` | 450 |
| **`anon` + ESCRIBEN** (`insert`/`update`/`delete`) | **138** |
| `authenticated` + escriben | 208 |

Leer sin permiso es un problema; **escribir** saltándose RLS es otro. Las 138 son el orden natural del
barrido.

## §3 · Y dentro de las 138, por TIPO de cerrojo

Porque una ACL abierta no es una puerta abierta si la función lleva cerrojo dentro:

| | funciones | qué significa |
|---|---|---|
| **A · cerrojo por SESIÓN** | **64** | `auth.uid()`, `current_user_is_admin*`, `_require_*()`. No se puede mentir desde fuera. |
| **B · cerrojo por PARÁMETRO** | **9** | `belongs_to_account(p_account)`, `_user_can_manage_admins(p_created_by)`. **Confía en que quien llama diga la verdad sobre quién es.** |
| **C · por TOKEN en la firma** | **26** | tablet, repartidor, cliente. Camino público con llave, por diseño. |
| **D · sin cerrojo reconocible** | **39** | ← lo que hay que mirar |

**La categoría B merece nombre propio.** `create_platform_admin_tx` comprueba
`_user_can_manage_admins(p_created_by)`: el permiso se verifica sobre el usuario que el LLAMADOR dice ser,
no sobre la sesión. No es lo mismo que un cerrojo por sesión, y hoy están mezcladas.

## §4 · Las 39, y por qué son CANDIDATAS y no un veredicto

> `_match_order_lines_for_order`, `adapt_hubrise_order`, `adapt_lastapp_order`, `add_ingredient_to_recipes`,
> `apply_invoice_costs`, `auto_link_goods_receipt_to_order`, `build_inventory_count`, `cancel_sale`,
> `claim_promo_push_jobs`, `close_inventory_count`, `close_sale`, `compliance_doc_mark_expired`,
> `compute_sale_line_cost`, `customer_request_login`, `customer_verify_login`, `db_health_connection_guard`,
> `delete_campaign`, `dispatch_watchdog_scan`, `enqueue_clockout_reminders`, `learn_from_receipt`,
> `migrate_supplier_articles`, `place_shop_order`, `queue_ctb_order_claim`, `receive_goods_receipt`,
> `register_shop_consent`, `remove_ingredient_from_recipes`, `reparto_award_quests`, `reparto_reoffer`,
> `reparto_weather_apply`, `reparto_weather_poll`, `report_platform_floor`, `report_promo_push_job`,
> `reprocess_sale`, `request_clock_correction`, `retire_stale_agent_shop_offers`, `run_invoice_match`,
> `substitute_ingredient_in_recipes`, `swap_mirror`, `toggle_campaign`

**Mi detector ya ha demostrado que sobre-avisa, y lo digo antes de que nadie actúe sobre la lista.** La
primera versión daba 50 e incluía `set_platform_admin_role`, `create_platform_admin_tx` y `set_stock_level`.
Las tres tienen cerrojo — vía `_require_manage_admins()`, `_user_can_manage_admins(p_created_by)` y
`belongs_to_account(p_account)`— que mi expresión no conocía. Se validó la cabeza de la lista ANTES de
entregarla, y por eso la lista de arriba tiene 39 y no 50.

Que haya fallado una vez significa que puede fallar otra: **quedan 39 para mirar UNA A UNA**, no 39
agujeros. Varias tienen pinta de no ser alcanzables por `anon` aunque la ACL lo permita (funciones de cron
como `dispatch_watchdog_scan` o `reparto_weather_poll`, o internas como `compute_sale_line_cost`), y otras
son camino público legítimo (`place_shop_order`, `customer_request_login`). El trabajo es decidir cuál es
cuál, y eso lo decide Julio, no un regex.

## §5 · Qué haría falta de Julio

1. **Qué debe ser público a propósito:** tienda (`place_shop_order`, `customer_*`, `register_shop_consent`),
   seguimiento por token, tablet y repartidor. Con esa lista, todo lo demás se revoca de `anon` y
   `authenticated` **por nombre** —que es la lección de hoy— y lo que se rompa aparece enseguida.
2. **Si la categoría B (9) le parece aceptable** o hay que pasarlas a cerrojo por sesión.
3. Nada de esto es urgente por sí solo, pero **el valor por defecto de la casa es abrir**, así que cada
   función nueva nace en el lado malo. Lo barato es cambiar el defecto (`ALTER DEFAULT PRIVILEGES`) y
   conceder por nombre; lo caro es revisar 1.446 una a una cada seis meses.

**Este documento no propone ninguna migración.** Es el mapa para decidir; el barrido va detrás de la lista
del §5.1.
