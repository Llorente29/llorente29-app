# B18 — Regenerar `database.ts`: qué pasa de verdad al hacerlo

**Fecha:** 03/09/2026 · **Tipo:** RECON + decisión pendiente · **Encargo:** ENCARGO CODE 03/09, §1

> **Estado: NO APLICADO.** `src/types/database.ts` sigue como estaba. El fichero
> regenerado existe y está verificado, pero **no se ha commiteado**, porque
> aplicarlo pone el build en rojo en 204 sitios. La decisión es de Julio.
> Se para y se pregunta, como manda el §0 del encargo.

## 1. Las tres cosas que el encargo esperaba, y que no pueden pasar

El encargo pedía enseñar el diff con «una función nueva
(`tg_sale_close_on_complete`) y dos que han cambiado de forma (`kds_board`,
`food_cost_dashboard`)». **Ninguna de las tres aparece, y es correcto que no
aparezca:**

1. **`tg_sale_close_on_complete` no saldrá nunca en `database.ts`.** Es una
   función de *trigger* (`returns trigger`). PostgREST no expone las funciones
   de trigger como RPC, así que el generador de tipos no las incluye. Existe en
   la base (comprobado en `pg_proc`), pero no es un RPC llamable.
2. **`kds_board` no ha cambiado de forma.** Antes y después:
   `Args: { p_device_token?: string; p_location_id?: string }`, `Returns: Json`.
3. **`food_cost_dashboard` tampoco.** Idéntica, cinco argumentos y `Returns: Json`.

Y es **a propósito**: B44 y B47 no reescriben las funciones, leen su
`pg_get_functiondef` y sustituyen fragmentos del **cuerpo**. La firma se
conserva por diseño — así es como esas migraciones evitan tocar lo que no deben.
**No hay firma nueva que enseñar porque no se cambió ninguna firma.**

## 2. El desfase real: 93 RPCs, no 23

| | `database.ts` en el repo | regenerado hoy |
|---|---:|---:|
| líneas | 21.340 | 24.373 |
| RPCs | 505 | 596 |

**93 RPCs que faltan** (no 23), entre ellas los siete vigías
(`edge_drift_watchdog`, `ingesta_silencio_watchdog`, `sales_unmapped_watchdog`,
`codigo_plataforma_watchdog`, `hubrise_order_stuck_watchdog`,
`availability`…), todo el bloque de personal (`propose_schedule`,
`team_compliance_scan`, `registro_jornada_mensual`, `export_gestoria_mensual`),
`receive_goods_receipt`, `upsert_pos_sale`, `kds_heartbeat`… La deuda B18 es
bastante mayor de lo que decía la ficha.

## 3. Por qué no se ha aplicado: 204 errores en 27 ficheros

Línea base comprobada primero: **con el `database.ts` actual, `npm run build`
sale VERDE.** Con el regenerado, `tsc -b` da **204 errores**:

| código | n | qué es |
|---|---:|---|
| TS2345 | 113 | argumento no asignable |
| TS2352 | 65 | conversión insegura |
| TS2353 | 16 | propiedad desconocida |
| TS2322 | 8 | tipo no asignable |
| TS2741 | 2 | falta propiedad |

**105 de los 204 mencionan `account_id`.** Los ficheros más tocados son
`goodsReceiptService.ts` (57), `supplierInvoiceService.ts` (25),
`storageAreaService.ts` (17), `inventoryCountService.ts` (16),
`lastappIntegrationService.ts` (14), `kdsService.ts` (11).

**Esto no se arregla de oficio, y menos yo solo.** Rellenar `account_id` en un
`insert` es decidir **de qué cuenta es la fila** — regla ganada nº 9, la que
mordió cinco veces el 31/08. Meter la cuenta equivocada en un albarán o un
conteo no da un número mal: escribe la fila en la cuenta de otro. Son 27
ficheros de servicio y cada uno pide su propia decisión.

## 4. Dos hallazgos que sólo aparecen al regenerar

Los dos son reales, están en producción hoy, y **no dependen de que se aplique
o no** el fichero regenerado.

### 4.1 `list_costless_sold_products` — RPC muerta, y se sigue llamando

`src/modules/kitchen/services/salesReliabilityService.ts:615` hace:

```ts
const { data, error } = await supabase!.rpc('list_costless_sold_products', { … })
```

**Esa función no existe en la base.** Buscada en `pg_proc` por todos los
esquemas: cero filas. `database.ts` la sigue declarando (línea 18.630) y por eso
el build no se queja — el tipo miente y tapa una llamada que en ejecución
devuelve `PGRST202`. Es la deuda B1 **al revés**: el repo tiene código de algo
que la base ya no tiene.

### 4.2 `set_brand_status` — dos firmas vivas (regla ganada nº 2)

En la base hay **dos** `set_brand_status`:

```
set_brand_status(p_brand_id, p_mode, p_resume_at, p_reason, p_reason_code)                 -- 5 args
set_brand_status(p_brand_id, p_mode, p_location_id, p_resume_at, p_reason, p_reason_code)  -- 6 args
```

Es la forma exacta que describe la regla nº 2: *«añadir un parámetro es DROP +
CREATE, nunca CREATE OR REPLACE; replace crea una SOBRECARGA»*. El
`database.ts` actual sólo conoce la de 5 argumentos; el regenerado la declara
como unión de las dos. Se llama desde
`src/modules/kds/services/kdsService.ts:431`. Hoy PostgREST desempata por los
nombres de los argumentos que se envían, así que funciona — pero es la misma
configuración que dejó a los siete vigías sin poder encolar el 27/08.

## 5. Lo que se propone

Tres piezas separadas, cada una con su encargo, en este orden:

1. **Las dos de arriba** — pequeñas, acotadas, independientes: decidir si
   `list_costless_sold_products` se recupera o se jubila la llamada, y hacer
   DROP + CREATE de la firma buena de `set_brand_status`.
2. **El barrido de `account_id`** — 27 ficheros de servicio, uno a uno, con la
   regla 9 delante. Es el grueso de B18 y merece su propio frente.
3. **Aplicar `database.ts` regenerado** — al final, cuando 1 y 2 lo dejen verde.

Aplicarlo antes deja el repo sin poder construir.

## Cómo se regeneró (para reproducirlo)

`npm run gen:types` **no funciona en este entorno**: invoca `supabase gen types
--linked` y la CLI no tiene credenciales (`Cannot find project ref`). Se usó el
MCP de Supabase (`generate_typescript_types`) y se le aplicó **el mismo
tratamiento que hace `scripts/gen-types.mjs`**: quitar BOM y borrar por
emparejamiento de llaves los bloques `spatial_ref_sys`, `geography_columns` y
`geometry_columns` (3/3 eliminados). Comprobado: sin BOM, `export type
Database` presente, 24.373 líneas.
