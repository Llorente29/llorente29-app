# Inventario de edge functions: desplegado vs repo (deudas B1 y B37)

**Fecha:** 03/09/2026 · **Tipo:** inventario, no arreglo · **Encargo:** ENCARGO CODE 03/09, §3

> Sólo el inventario. Los arreglos van después, uno a uno, cada uno con su encargo.

## Titular: el caso conocido ya no lo es

El encargo parte de que **`last-catalog-sync` está desplegada y sin código en el
repo**. **Ya no.** La carpeta existe, con `index.ts` (24.264 bytes), `deno.json`
y un `RECUPERADA.md` que fecha el rescate el **19/08/2026**. Lo mismo con
`catcher-probe`, rescatada el 27/08 por `edge-drift-watchdog`.

**Desplegadas sin código en el repo: 0 de 64.** Ese agujero concreto está
cerrado. Lo que queda abierto es el otro, más silencioso: **saber si el código
que hay en el repo es el que está corriendo.**

## Lo que sí se puede afirmar y lo que no

- **«¿Existe en el repo?»** — comprobado entero, para las 64. Fiable.
- **«¿Coincide?»** — sólo se puede afirmar en las **4 desplegadas por CI**, que
  por construcción salen del repo. Para las otras 60 **no es comprobable en
  esta sesión**: hace falta `supabase functions download <slug>` y comparar
  md5, y la CLI de este entorno **no tiene credenciales** (`supabase db push
  --dry-run --linked` → `Cannot find project ref`). Es exactamente el agujero
  que ya describía `last-catalog-sync/RECUPERADA.md` en agosto.
- **El historial de git no sirve de señal aquí:** el clon es *shallow* (51
  commits, el más antiguo del 02/09/2026), así que «última vez que se tocó en
  el repo» no se puede comparar con «última vez que se desplegó».

## La señal que sí queda: cómo se desplegó cada una

`entrypoint_path` delata la forma del bundle subido, y con ella el método:

- `…/source/supabase/functions/<slug>/index.ts` → CLI desde la raíz del repo.
- `…/source/index.ts` → **suelta**: se subió sólo la carpeta de la función, sin
  el árbol. Es la forma del despliegue a mano o por MCP, el que **no deja
  rastro en git** — la deuda B1 en estado puro (regla ganada nº 1).
- `file:///home/runner/work/llorente29-app/…` → GitHub Actions.

### Las 11 «sueltas» — la lista de vigilancia

Todas están en el repo, pero su último despliegue **no salió de él**:

| función | v | último deploy |
|---|---:|---|
| `social-agent` | 27 | 2026-09-02 |
| `last-catalog-sync` | 11 | 2026-08-27 |
| `system-alert` | 48 | 2026-08-15 |
| `hubrise-oauth-callback` | 15 | 2026-08-15 |
| `hubrise-connection-health` | 7 | 2026-08-15 |
| `hubrise-location-disconnect` | 6 | 2026-08-15 |
| `hubrise-oauth-start` | 13 | 2026-08-15 |
| `manage-employee` | 69 | 2026-08-14 |
| `suggest-course-hook` | 6 | 2026-08-05 |
| `catcher-webhook` | 38 | 2026-07-24 |
| `customer-notify` | 19 | 2026-07-19 |

Son las primeras a las que mirar cuando se abra el encargo de comparación.
`last-catalog-sync` es la más delicada de las once: su `RECUPERADA.md` dice
que el `index.ts` del repo es una **transcripción de la v8**, *«NO verificada
byte a byte»*, y producción va por **v11** (27/08). Comprobación de hoy: los
marcadores propios de la v11 desplegada —`watch_organization_product_id`,
`external_channels`, `disabled_since_known`, `first_sync_disabled_unknown`,
`_debug_catalog_discovery`, el comentario `ACUMULA (19/08)`— **están los ocho
en el fichero del repo**. Indicio fuerte de que la copia está al día; no es
prueba de igualdad byte a byte.

### Las 2 que están en el repo y no desplegadas

- **`otter-webhook`** — esqueleto **a propósito**: su cabecera dice «NO
  DESPLEGAR todavía», espera el alta de Otter y `OTTER_WEBHOOK_SECRET`.
- **`catcher-probe`** — sólo `RESCATADA.md`, sin `index.ts`. Estuvo desplegada
  (v17, 19/07) y **hoy ya no aparece entre las activas**. El rescate documentó
  el caso pero no dejó el código.

## Tabla completa

| función | v desplegada | último deploy | ¿en el repo? | ¿coincide? | cómo se desplegó |
|---|---:|---|---|---|---|
| `account-email` | 53 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `availability-dispatch` | 47 | 2026-09-01 | sí | **sí** | CI (GitHub Actions, desde el repo) |
| `availability-watchdog` | 11 | 2026-09-01 | sí | **sí** | CI (GitHub Actions, desde el repo) |
| `catcher-dispatch` | 56 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `catcher-webhook` | 38 | 2026-07-24 | sí | no comprobable | **suelta** (ruta `functions/…`) |
| `check-account-status` | 55 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `clockout-reminder` | 6 | 2026-08-05 | sí | no comprobable | CLI con el árbol del repo |
| `compliance-doc-notify` | 6 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `connector-credentials` | 48 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `courier-proof-upload` | 17 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `create-account` | 57 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `create-platform-admin` | 44 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `customer-notify` | 19 | 2026-07-19 | sí | no comprobable | **suelta** (solo la carpeta de la función) |
| `edge-drift-watchdog` | 7 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `enrich-ingredient` | 53 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `extract-recipe` | 55 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `folvy-ai` | 65 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `hubrise-brand-connect` | 11 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `hubrise-callback-ensure` | 16 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `hubrise-catalog-create` | 5 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `hubrise-catalog-publish` | 51 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `hubrise-connection-health` | 7 | 2026-08-15 | sí | no comprobable | **suelta** (solo la carpeta de la función) |
| `hubrise-location-disconnect` | 6 | 2026-08-15 | sí | no comprobable | **suelta** (solo la carpeta de la función) |
| `hubrise-location-dispatch` | 9 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `hubrise-oauth-callback` | 15 | 2026-08-15 | sí | no comprobable | **suelta** (solo la carpeta de la función) |
| `hubrise-oauth-start` | 13 | 2026-08-15 | sí | no comprobable | **suelta** (solo la carpeta de la función) |
| `hubrise-order-status` | 45 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `hubrise-webhook` | 56 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `ingestion-synthetic-ping` | 48 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `last-catalog-probe` | 6 | 2026-08-19 | sí | no comprobable | CLI con el árbol del repo |
| `last-catalog-sync` | 11 | 2026-08-27 | sí | no comprobable | **suelta** (solo la carpeta de la función) |
| `lastapp-backfill-sales` | 51 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `lastapp-catalog-import` | 52 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `lastapp-set-price` | 22 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `lastapp-sync-catalog` | 66 | 2026-08-19 | sí | no comprobable | CLI con el árbol del repo |
| `lastapp-webhook` | 72 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `manage-employee` | 69 | 2026-08-14 | sí | no comprobable | **suelta** (solo la carpeta de la función) |
| `map-products` | 55 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `menu-photos-repatriate` | 1 | 2026-09-02 | sí | **sí** | CI (GitHub Actions, desde el repo) |
| `ocr-albaran` | 48 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `ocr-compliance-doc` | 7 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `offers-agent` | 54 | 2026-09-02 | sí | **sí** | CI (GitHub Actions, desde el repo) |
| `order-advance` | 43 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `payroll-extract` | 26 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `payroll-inbound` | 21 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `propose-count-reasons` | 44 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `propose-modifier-impacts` | 44 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `send-email` | 60 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `shop-customer-auth` | 26 | 2026-07-02 | sí | no comprobable | CLI con el árbol del repo |
| `shop-payment-intent` | 35 | 2026-07-01 | sí | no comprobable | CLI con el árbol del repo |
| `social-agent` | 27 | 2026-09-02 | sí | no comprobable | **suelta** (solo la carpeta de la función) |
| `social-dress` | 18 | 2026-07-06 | sí | no comprobable | CLI con el árbol del repo |
| `social-image-next` | 21 | 2026-07-06 | sí | no comprobable | CLI con el árbol del repo |
| `social-image-sink` | 22 | 2026-07-06 | sí | no comprobable | CLI con el árbol del repo |
| `social-publish` | 20 | 2026-07-05 | sí | no comprobable | CLI con el árbol del repo |
| `sports-events` | 20 | 2026-07-08 | sí | no comprobable | CLI con el árbol del repo |
| `stripe-connect-onboard` | 31 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `stripe-webhook` | 32 | 2026-07-01 | sí | no comprobable | CLI con el árbol del repo |
| `suggest-course-hook` | 6 | 2026-08-05 | sí | no comprobable | **suelta** (solo la carpeta de la función) |
| `suggest-item` | 46 | 2026-08-28 | sí | no comprobable | CLI con el árbol del repo |
| `system-alert` | 48 | 2026-08-15 | sí | no comprobable | **suelta** (solo la carpeta de la función) |
| `training-notify` | 6 | 2026-08-05 | sí | no comprobable | CLI con el árbol del repo |
| `uber-promo-push` | 21 | 2026-07-05 | sí | no comprobable | CLI con el árbol del repo |
| `weather-events` | 21 | 2026-07-05 | sí | no comprobable | CLI con el árbol del repo |

Desplegadas: **64** · carpetas en `supabase/functions/` (sin `_shared`): **66**
Desplegadas sin código en el repo: **0**
En el repo sin desplegar: **2** — `catcher-probe`, `otter-webhook`

## Lo que cierra este agujero del todo

Credenciales de la CLI de Supabase en el entorno (token de acceso + `supabase
link`). Con eso: `supabase functions download <slug>` para las 60, md5 contra
el repo, y la columna «¿coincide?» deja de tener «no comprobable». Es la misma
tarea que `RECUPERADA.md` señalaba el 19/08 y sigue pendiente.
