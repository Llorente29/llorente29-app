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

## §3 · Dentro de las 138, por TIPO de cerrojo — CORREGIDO dos veces

> **Este apartado se ha reescrito.** La primera versión decía «64 por sesión, 9 por parámetro». Estaba mal
> dos veces, y las dos por medir con la vara torcida:
>
> 1. El patrón `current_user_is_admin` casaba también con `current_user_is_admin_or_manager_of`, así que
>    funciones que usan la variante con parámetro se contaban como «por sesión».
> 2. Y al mirar los ayudantes de verdad, resulta que `belongs_to_account(p_account_id)` y
>    `current_user_is_admin_or_manager_of(p_account_id)` **miran `auth.uid()` por dentro**: el parámetro dice
>    QUÉ CUENTA, no QUIÉN SOY. Son cerrojo de sesión, no de parámetro.
>
> Resolviendo los ayudantes a **dos niveles** —hizo falta: `_require_manage_admins()` llama a
> `current_user_has_platform_permission()`, que es quien usa `auth.uid()`— el reparto real es:

| | funciones | qué significa |
|---|---|---|
| **cerrojo de SESIÓN** | **86** | acaban en `auth.uid()`. No se puede mentir desde fuera. |
| **token en la firma** | **26** | tablet, repartidor, cliente. Público con llave, por diseño. |
| **ni una cosa ni la otra** | **26** | ← las del triaje |

**Y la categoría «cerrojo por parámetro» es UNA sola función**, no nueve: `create_platform_admin_tx`, que
comprueba `_user_can_manage_admins(p_created_by)` — sobre el usuario que el llamador DICE ser.

## §4 · Las 26, triadas por QUIÉN LAS LLAMA

Medido en `cron.job`, en `src/` y en `supabase/functions/`. **Para Julio quedan 2 preguntas, no 39.**

| montón | n | funciones | qué se hace |
|---|---|---|---|
| **cron y nadie más** | 6 | `db_health_connection_guard`, `dispatch_watchdog_scan`, `reparto_award_quests`, `reparto_reoffer`, `reparto_weather_apply`, `reparto_weather_poll` | revocar; el cron corre como `postgres` |
| **edge function y nadie más** | 11 | `adapt_hubrise_order`, `adapt_lastapp_order`, `cancel_sale`, `close_sale`, `compliance_doc_mark_expired`, `create_platform_admin_tx`, `customer_request_login`, `customer_verify_login`, `enqueue_clockout_reminders`, `reprocess_sale`, `retire_stale_agent_shop_offers` | revocar; las edge usan `service_role` |
| **sólo otras funciones SQL** | 1 | `auto_link_goods_receipt_to_order` | revocar |
| **pantalla de gestión** | 3 | `apply_invoice_costs`, `compute_sale_line_cost`, `run_invoice_match` | quitar `anon`, **dejar `authenticated`** |
| **tienda pública — DECISIÓN** | 2 | `place_shop_order`, `register_shop_consent` | ¿la tienda sigue sin login? |
| **sin llamador conocido — CONFIRMAR** | 3 | `claim_promo_push_jobs`, `report_platform_floor`, `report_promo_push_job` | ¿los usa algo de fuera del repo? |

**Hallazgo del triaje:** el login de la tienda (`customer_request_login`, `customer_verify_login`) **no lo
llama el navegador** — lo llama la edge `shop-customer-auth`. El cliente habla con la edge, no con la RPC.
Parecían camino público y no lo son.

**`create_platform_admin_tx` merece párrafo.** Es la única con cerrojo por parámetro, y **no se puede pasar
a cerrojo de sesión**: la llama la edge `create-platform-admin` con `service_role`, donde `auth.uid()` es
NULL, y el `p_created_by` lo extrae la edge del JWT de quien llama — ahí está la autenticación de verdad. El
diseño es correcto *a condición de que sólo la edge pueda llamarla*. Hoy puede `anon`, y entonces el cerrojo
se convierte en «dime el uuid de alguien que pueda gestionar admins». Su arreglo es la revocación, no tocar
la función.

## §5 · Qué haría falta de Julio

Sólo esto:

1. **¿La tienda pública sigue funcionando sin login?** Si sí, `place_shop_order` y `register_shop_consent`
   se quedan con `anon`. Es lo único de negocio.
2. **¿Se usan `claim_promo_push_jobs`, `report_platform_floor`, `report_promo_push_job`?** No aparecen en
   cron, ni en `src/`, ni en las edge. No puedo demostrar que nadie las llame desde fuera del repositorio.

Todo lo demás va en `PENDIENTE_cerrar_funciones_de_escritura_a_anon.sql`, que cierra 21 y deja esas 5.

## §6 · Y después: que una función nueva no nazca abierta

`ALTER DEFAULT PRIVILEGES` para que `anon` y `authenticated` dejen de recibir `EXECUTE` por defecto. Cambia
el nacimiento de TODA función futura, incluidas las que el front sí llama, así que va con su medición de los
dos lados (regla 31) y detrás de este barrido. Pendiente de escribir.
