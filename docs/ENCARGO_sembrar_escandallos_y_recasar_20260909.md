# ENCARGO — «Sembrar escandallos y recasar»: que no siembre propias, que no siembre de junio, y que diga qué hizo

**Fecha:** 09/09/2026 · **Estado:** propuesta, sin construir · **Origen:** Julio, con el botón delante:
«¿qué hace exactamente? Qué tablas escribe y cuántas filas movería ahora mismo. No lo voy a pulsar hasta
saberlo.» De ahí salió la medición de abajo, y de la medición este encargo.

## §1 · Qué hace hoy, medido (09/09, sin escribir nada)

Son **dos RPC en cadena** detrás de un botón (`IntegrationsSection.tsx:264` → `seedAndRecast`).

### `seed_catalog_canonical(cuenta)` — escribe en 3 tablas

Lee del **espejo `external_catalog_product`** (el que llena `last-catalog-sync`), **no** del catálogo que
trae `lastapp-catalog-import`. Por cada `organization_product_id` resuelve la marca **por NOMBRE** (con el
alias «Dirty Burgers»→«Dirty Burger»); si no encuentra ya un `menu_item` con esa matrícula, crea un
`recipe_item` (`type='dish'`, `needs_review=true`) **y** un `menu_item` (`external_source='lastapp'`,
`needs_review=true`). Después revisa SIEMPRE `menu_item_override` de precio por canal.

| | cedidas | **propias** | sin marca | total |
|---|---|---|---|---|
| matrículas que mira | 208 | 193 | 18 | 419 |
| ya existen, no las toca | 179 | 128 | — | 307 |
| **`recipe_item` que crearía** | 29 | **65** | 0 | **94** |
| **`menu_item` que crearía** | 29 | **65** | 0 | **94** |
| **`menu_item_override` que crearía** | 21 | 28 | 0 | **49** |
| saltadas (marca que Folvy no tiene) | — | — | 18 | 18 |

**237 filas nuevas en tres tablas.**

### `recast_lastapp_sales(cuenta)` — esta mitad está bien

Se llama sin los otros dos argumentos → `p_incluir_bajo_conteo = false`, o sea que **respeta la regla 6**:
corta en el último conteo aprobado o en revisión.

| corte | protegidas | **reprocesa** |
|---|---|---|
| 08/09/2026 22:43 Madrid | 8.245 | **8** |

Cada una pasa por `reprocess_sale`: borra e inserta `stock_movement` de consumo, reescribe `sale_line`
(`adapt_lastapp_order` + `compute_sale_line_cost`), fija `sale.brand_id` y recalcula el stock del local.

## §2 · Los tres fallos, y por qué son de la misma familia que los de hoy

**1. No tiene la guarda de `ownership_type`.** Resuelve la marca por nombre y no mira si es cedida.
**65 de las 94 altas serían en marcas PROPIAS**, cuya fuente de verdad es Folvy, no Last. Es exactamente
el fallo que el importador tenía y que se corrigió el 08/09 — aquí sigue.

*Y muy probablemente esta función es la que dejó el cadáver que ya teníamos apuntado:* 206 platos vivos de
marcas propias con `external_source='lastapp'`. Nadie más los escribe.

**2. Siembra de un espejo rancio.** De las 94 que crearía, **sólo 8 se han visto en Last en las últimas
48 horas** — y **cero** de las 65 de propias. Diecinueve llevan más de 30 días sin aparecer y la más vieja
es del **21/06**. Crearía platos y escandallos a partir de cosas que Last ya no sirve.

**3. No dice qué hizo.** La función DEVUELVE sus contadores (`productos_base_creados`, `overrides_creados`,
`saltados_sin_marca`, `base_ya_existentes`) y la UI **no los lee**. Está escrito en el código como decisión
tomada: *«No se parsean los contadores de retorno a propósito … Surfacing de cifras = mejora menor»*
(`lastappIntegrationService.ts`). Pulsas y no sabes si creó 0 o 237 filas. Es la regla 8, y aquí no es
cosmética: es un botón que escribe en `recipe_item`.

## §3 · Lo que se construye

1. **Guarda de `ownership_type`.** Sólo se siembra sobre marcas **cedidas** (`licensed`). Una marca propia
   que aparezca en el espejo se cuenta y se lista —`saltadas_por_ser_propia`—, no se salta en silencio
   (regla 7). Misma expresión que el importador, y si es posible **la misma función**: `marca_reparte_propio`
   ya demostró que compartir la definición es la forma de que dos sitios no se desincronicen.
2. **Que el espejo tenga que estar fresco.** Ventana explícita (p. ej. `seen_in_catalog_at` de los últimos
   N días, con N como parámetro y valor por defecto dicho en pantalla). Lo que quede fuera se cuenta y se
   lista como «Last no lo sirve desde …», con su fecha. Sembrar de junio no es sembrar: es resucitar.
3. **Contadores en pantalla.** El botón dice qué hizo, con contenido, no un visto: «Creados 29 platos y 29
   escandallos en 6 marcas cedidas · 21 precios por canal · 65 saltados por ser marca propia · 18 sin marca
   en Folvy». Y si no creó nada, que lo diga también.
4. **Un ensayo antes de escribir.** Igual que el importador: `dry_run` que devuelve las mismas cifras sin
   tocar nada, para poder mirarlas antes. Hoy la única forma de saber qué haría es reproducir su lógica a
   mano en SQL, que es lo que ha habido que hacer para contestar a Julio.

**Lo que NO se toca:** el `recast`. Respeta el corte, mueve 8 ventas y hace lo que dice. Si acaso, que
también enseñe sus cifras — ya las devuelve.

## §4 · Orden y riesgo

No urge: el botón no está roto, hace lo que su código dice. Lo que pasa es que **su código no hace lo que
su nombre promete** desde que el importador crea los platos: de 419 matrículas, 307 ya existen, así que
«Sembrar escandallos» hoy sembraría 94, y 65 donde no debe.

**Mientras no se construya: no pulsarlo.** El recast por separado sí es seguro, pero hoy van juntos en el
mismo botón — separarlos es parte del §3 si Julio lo quiere antes que el resto.
