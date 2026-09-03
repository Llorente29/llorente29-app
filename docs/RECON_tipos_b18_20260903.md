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

### 4.1 `list_costless_sold_products` — retirada de la base, y la pantalla se cayó con ella

`src/modules/kitchen/services/salesReliabilityService.ts:615` llama a una RPC
que **ya no existe**: la retiró a propósito la migración
**`20260902204305_retirar_list_costless_sold_products`**, el 02/09 a las 20:43
UTC. La retirada llevaba guardas — comprobaba que ninguna otra función de
Postgres y ningún cron la nombraran — pero **ninguna guarda podía ver el código
del cliente**, y el cliente sí la usaba.

El daño no era el que yo dije al principio. **No es que «el tipo tape un
PGRST202»: es que la vista General de `SalesExceptionsPage` se quedaba entera
en un recuadro rojo.** Las tres lecturas iban en un mismo `Promise.all`, así
que el rechazo de ésta se llevaba por delante la señal de fiabilidad y los
grupos de ventas sin casar. Rota desde el 02/09 a las 20:43 — el último commit
del repo es de esa misma tarde a las 16:50, o sea que la retirada ocurrió
**después** y la UI nunca se enteró.

**Arreglado el 03/09:** la lectura de «casado sin coste» se separa del
`Promise.all` y tiene su propio error. La pantalla vuelve a funcionar y, si esa
lectura falla, **lo dice en un aviso ámbar en vez de callarse** (reglas 7 y 8).
La migración de la retirada está ya en `supabase/migrations/`.

**Queda por decidir** (no es de código): si se recrea la RPC —su definición
sigue en `supabase/migrations/20260608T2000_list_costless_sold_products.sql`— o
si se jubila la sección «Casado pero sin coste» con su `CostlessRow`, que son
~200 líneas de UI que funcionan. Ver §5.

### 4.2 `set_brand_status` — dos firmas, y NO es el fallo de la regla 2

**Corrección de lo que dije en la primera versión de esta ficha.** Escribí que
esto era «la regla ganada nº2 exactamente» y que había que hacer DROP + CREATE.
**Es al revés: tocarlo empeoraría las cosas.**

Las dos firmas existen **a propósito**. La de 5 argumentos no es un residuo: su
cuerpo entero es una lápida deliberada.

```
raise exception 'set_brand_status: esta version cierra la marca en TODOS los
                 locales y esta retirada desde el 01/09/2026. Actualiza la
                 aplicacion: ahora hay que indicar el local. Desde la tablet de
                 cocina no hace falta hacer nada.';
```

Es la red que atrapa a una app vieja que aún llame sin local — el fallo que el
29/08 apagó Meraki Pita en Alcalá cuando se cerró Carabanchel. **Borrarla
convertiría ese mensaje en castellano en un `PGRST202` genérico.**

Y **no hay ambigüedad**, que es lo que la regla 2 castiga. Comprobado contra
producción, no razonado:

```
select public.set_brand_status('000…000'::uuid, 'closed');
ERROR:  P0001: set_brand_status: esta version cierra la marca en TODOS los locales…
        CONTEXT: PL/pgSQL function set_brand_status(uuid,text,timestamptz,text,text) line 3
```

`P0001` —el mensaje de la propia lápida—, **no `42725`**. Postgres resuelve
limpio porque `p_location_id` **no tiene DEFAULT** en la firma de 6: una
llamada que no lo pase sólo puede casar con la de 5. El cliente
(`kdsService.ts:431`) ya pasa `p_location_id` y es obligatorio sin default, con
el porqué escrito encima.

**No se toca.** Lo que sí es cierto es que el `database.ts` actual sólo conoce
la firma de 5 y el regenerado las declara como unión — un detalle a tener
presente cuando se aplique, no un fallo que arreglar.

## 5. Lo que se propone

Tres piezas separadas, cada una con su encargo, en este orden:

1. **Decidir qué pasa con «Casado pero sin coste»** (§4.1): recrear la RPC
   —la definición está en la migración del 08/06— o jubilar la sección y su
   `CostlessRow`. La pantalla ya no se cae mientras tanto.
   **`set_brand_status` (§4.2) NO entra: no hay nada que arreglar ahí.**
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
