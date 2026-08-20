# `last-catalog-sync` — recuperada de producción el 19/08/2026

Esta carpeta **no existía**. La función llevaba desplegada desde el 12/08/2026
(v8, ACTIVE, `verify_jwt: false`) sin una sola línea en el repositorio.

## Lo que costó

El 19/08, buscando por qué el espejo de catálogos de Last no reflejaba los
catálogos de Glovo de Alcalá, se leyó el repositorio, se encontró únicamente
`lastapp-sync-catalog`, y se razonó durante dos horas sobre la función
equivocada. De ahí salieron tres afirmaciones falsas:

  1. «la función se llama `lastapp-sync-catalog`, no `last-catalog-sync`» —
     existen las dos, y la que corre el cron horario es esta.
  2. «toma una organización, no un local» — esta acepta `location_id`.
  3. «nada escribe `last_synced_at`, la columna está muerta» — esta la escribe
     en cada producto visto, y es justo lo que vigila el watchdog.

Peor: para «refrescar el espejo» se lanzó tres veces `lastapp-sync-catalog`,
que cachea el catálogo por id y calca el `is_enabled` de un local sobre los
demás. Dejó 35 filas marcadas como agotadas que en Last estaban a la venta.
Se reparó con esta función (`reappeared: 35`), al precio de perder el sello
`disabled_since` de esas 35.

## Quién la invoca

`cron.job` → `last-catalog-sync-hourly` (`0 12-23 * * *`) →
`public.last_catalog_sync_dispatch()` → `net.http_post` a
`/functions/v1/last-catalog-sync` con `x-internal-key`, un POST por cada
`(account_id, external_org_id)` activo de `external_integration`.

## Aviso de despliegue

Lo desplegado tiene los ficheros en la RAÍZ del bundle (`index.ts`,
`deno.json`), no en `supabase/functions/last-catalog-sync/`. Por eso el propio
código define `corsHeaders` en local en vez de importar `../_shared/cors.ts`,
y lo dice en un comentario. Si se redespliega desde estas rutas, hay que
mantener ese detalle o el import compartido seguirá sin resolverse.

## Estado de la verificación — LEER ANTES DE DESPLEGAR

`index.ts` es una **transcripción** de la v8 desplegada, hecha desde lo que
devuelve la API de gestión de Supabase. Comprobado: 563 líneas, 22 símbolos de
nivel superior, 0 CRLF, sintaxis TS válida, y presentes todos los invariantes
de comportamiento (`if (!out.has(v))`, `locationID: locationExtId`,
`last_synced_at: nowIso`, `body.location_id`, el `onConflict` de cuatro
columnas, `missing_since`, `disabled_since_known`).

**NO está verificada byte a byte.** Para eso hace falta bajarla y comparar
md5 (`supabase functions download last-catalog-sync`), y la CLI de Supabase
no está instalada en el entorno de trabajo. Instalarla es la tarea que cierra
este agujero del todo.

Consecuencia práctica: **esta copia sirve para leer y razonar, que es para lo
que hacía falta. No se despliega desde aquí sin comparar md5 antes** — si la
transcripción tuviera una errata, desplegarla cambiaría producción en
silencio, que es exactamente el fallo que esta carpeta viene a cerrar.
