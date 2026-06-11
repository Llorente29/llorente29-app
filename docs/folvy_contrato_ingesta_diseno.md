# Folvy — Contrato único de ingesta de ventas multi-fuente

**Fecha:** 11 jun 2026
**Estado:** DISEÑO aprobado por Julio, decisión por decisión, en sesión. NADA construido.
**Sustituye a:** `folvy_ingesta_canonica_diseno.md` en su parte de "espejo del catálogo del cedente" — esa vía queda **descartada** (ver §10). Conserva y formaliza el principio rector 5 (frontera única + canónico multi-TPV) y el modelo de tres capas. No duplica `folvy_economia_plataformas_diseno.md` (liquidación/márgenes) ni `folvy_estrategia_delivery.md` (qué proveedor de delivery).
**Banco de pruebas:** Folvy Interno (`00000000-0000-0000-0000-000000000001`). **Destino:** Llorente29, ya unificado (propias y cedidas nacen idénticas).

---

## 0. Por qué este documento existe

Tras infinidad de sesiones, Folvy aún no tenía un mecanismo **único y sólido** para recibir y procesar ventas de cualquier fuente. Cada sesión tocó un trozo (webhook, casado, fiabilidad, consumo, canónico) sin cerrar el frente entero bajo un solo principio. El resultado: las marcas propias casan por un camino (columna `menu_item.external_id`), las cedidas se caían (`no_brand`), y se estaba a punto de construir un "espejo del catálogo de Last" que **ningún competidor hace** y que habría atado Folvy a Last.

**Exigencia de Julio (innegociable):** un SaaS no puede nacer agrietado en su primer paso. Todo —propias, cedidas, Last, Otter, el siguiente— debe funcionar con los **mismos principios y objetivos**. Nada que sepamos imperfecto se hereda "porque ya funciona". La identificación de "qué artículo de qué marca es cada venta" tiene que ser **100% determinista**, no por suerte ni por texto.

Este documento fija el contrato que cumple eso, con la auditoría de competencia y el RECON de la BBDD detrás.

---

## 1. Diagnóstico sobre datos reales (RECON 11/06, Folvy Interno)

**Casado actual de `sale_line`:**
- `map_source='pos'` (casada): **1.046 líneas** (~86%).
- `unmapped / no_brand`: **121 líneas** — son las **cedidas CTB**; su catálogo nunca entró y la marca no se ató.
- `unmapped / no_recipe`: **52 líneas** — platos propios cascarón sin escandallo (trabajo de Pamela, no de arquitectura).
- `unmapped / no_menu_item`: **5 líneas** — residual.

**Matrícula externa en `menu_item`:** 168 con `external_id` (`source='lastapp'`, 1:1 perfecto), 87 sin matrícula (combos, cedidas, propias sin vincular).

**Fragmentación detectada (la grieta):** hoy "el id externo de un producto" vive en **tres sitios distintos**:
- `menu_item.external_id` + `external_source` — genérico **pero de una sola fuente** (columnas singulares → no aguanta dos fuentes por plato).
- `lastapp_product_map.organization_product_id` — atado a Last.
- `lastapp_catalog_product` (`organization_product_id`, `catalog_product_id`, `lastapp_brand_name`) — atado a Last.

Esa dispersión es la causa de que propias y cedidas vayan por caminos distintos. El contrato la unifica en **un solo sitio genérico**.

**`sale_line` hoy NO tiene ningún campo de matrícula externa** (`external_product_id`, `external_brand_id`, `external_source`). Guarda `product_name`/`raw_text` (texto) pero no el id estable de la fuente → por eso el casado depende de resolver nombre/catálogo en vez de id, y por eso las cedidas se caen. Sí tiene ya la jerarquía canónica sana: `line_type`, `parent_sale_line_id`, `modifier_option_id`, `combo_slot_id`, `map_source`, `map_confidence`, `map_needs_review`, `unmapped_reason`, `computed_cost`, `cost_computed_at`.

---

## 2. La decisión raíz (Julio, 11/06)

> **El frente NO es "meter las cedidas CTB de Last". Es definir el contrato único de ingesta de ventas multi-fuente, y migrar también las propias a él, de modo que propias y cedidas nazcan idénticas y cualquier fuente futura (Otter, Glovo directo, el siguiente desconocido) entre como un adaptador, sin tocar el núcleo.**

Consecuencias asumidas explícitamente:
- Lo que hoy "ya funciona a su manera" (casado propio por columna) **se reconvierte al contrato único**, no se conserva como excepción.
- Es algo más de trabajo que parchear. Es el trabajo correcto.
- Folvy Interno es donde se deja sólido; Llorente29 lo recibe ya unificado.

---

## 3. Auditoría de competencia (11/06, fuentes con docs de desarrollador)

El patrón es **universal y consistente** en los seis sistemas auditados. Confirma el contrato y descarta el espejo.

| Sistema | Capa que recibe la venta | Clave de casado | Lo no casado |
|---|---|---|---|
| **Deliverect** | el TPV es la fuente; sincroniza productos con su id | PLU del canal contra PLU del TPV | pedido fallido + código de error, PLU a la vista |
| **HubRise** | catálogo con SKU | `sku_ref` por línea; `private_ref` mapea a tu objeto interno | sin ref → no procesa, señalado |
| **MarketMan** | item del POS | cada menu item del POS mapeado a su receta | item sin mapear |
| **R365** | menu item **autocreado del POS** | menu item autocreado del feed; operador lo mapea a receta | columna Receta en blanco = sin mapear |
| **Apicbase** | item del POS subido | el POS sube items (no recetas); el cliente enlaza item→receta | "ingresos no enlazados" + ranking sin receta **por importe** |
| **tspoon** (incumbente) | catálogo propio | id estable (`codeCustomerProduct`) + **`LAST BRAND` fijado a mano por marca** | "Productos no vinculados" (11 en Dos Coyotes) |

**Las tres verdades del mercado:**
1. **Nadie espeja el catálogo de la plataforma como autoridad aparte.** Apicbase: "las recetas son del cliente, el POS solo sube items". R365 autocrea el menu item del feed. → el espejo de Cloudtown que íbamos a construir **no existe en ningún competidor**.
2. **El casado es siempre por id estable** (PLU/SKU/product id). El nombre es el último recurso, nadie se apoya en él.
3. **Lo no casado va a una cola visible ordenada por dinero, y nadie casa el 100% automático.** La barra del sector NO es "todo case solo": es **"nada se identifica mal y nada se pierde, y todo es enlazable por importe"**. Folvy ya tiene esa cola y la supera (separa `no_recipe` de `no_menu_item`).

**Cómo gana tspoon a las cedidas (captura de su alta de cliente):** ata **tres ids** en la configuración de la marca cedida — `LAST TOKEN`, `LAST LOCATION` (`901fa62e…`), **`LAST BRAND` (`6a69838d…`)** — y marca "Usar identificadores únicos". La marca se **fija en la configuración**, no se deduce de la venta. Por eso nunca tiene `no_brand`. **Esto es el núcleo del mecanismo 100% determinista** (§6).

---

## 4. El principio único

> Toda venta, venga de donde venga, entra por **un adaptador** que traduce el formato de esa fuente a la **matrícula canónica** y la reconcilia contra el catálogo de Folvy. El núcleo no sabe qué TPV existe. Añadir una fuente = escribir su adaptador. **Cero cambios en el núcleo.**

Tres responsabilidades, separadas para siempre:

- **El adaptador** (uno por fuente): traduce el payload crudo de su TPV → matrícula canónica + jerarquía (producto/modificador/combo). Único que conoce el formato de su fuente. Last ya hace de esto de facto; se formaliza. Otter será otro adaptador.
- **El núcleo** (uno solo, jamás se toca al añadir fuentes): recibe matrículas canónicas, casa por `(source, external_product_id)`, calcula coste y consumo. Ni una línea que diga "Last" u "Otter".
- **La cola de excepciones** (una sola): lo que no casa, ordenado por importe, resoluble. Igual para toda fuente.

---

## 5. Los dos casados (encadenados, no uno)

Distinción crítica para entender qué es automático y qué es humano-una-vez:

1. **Casado de reconocimiento (automático, por id).** La línea trae `(source, external_product_id)` → se busca en `external_product_map` → devuelve el `menu_item` de Folvy. **100% automático si la matrícula está registrada.**
2. **Casado de coste (enlace humano, una vez por producto).** Ese `menu_item` debe estar ligado a un `recipe_item` con escandallo. Ese enlace lo hace una persona la primera vez que aparece el producto (propias: ya hecho; cedidas: Pamela). A partir de ahí, **todas las ventas futuras de ese producto casan y costean solas**.

Esto es exactamente el modelo de R365 ("columna receta en blanco") y Apicbase ("sin receta por importe"). El id automatiza el reconocimiento; el enlace a la receta es alta humana, una sola vez. **Ayuda de IA al enlace producto→escandallo = mejora futura, no parte de este frente.**

---

## 6. Identificación 100% determinista (el requisito innegociable)

"Qué artículo de qué marca es cada venta" se garantiza con **dos amarres, ambos por id estable, ninguno por texto**:

1. **La marca se ata en la CONFIGURACIÓN de la integración, no en la venta.** Al dar de alta una marca (propia o cedida) se define su `external_brand_id` de la fuente (el `6a69838d…` de tspoon). Toda venta que entre por esa `(source, external_location_id, external_brand_id)` **es** de esa marca, por definición. Si la línea además trae la marca, se valida; si viene `null` (como en CTB hoy), da igual: ya está atada por configuración.
2. **El artículo se casa por su id estable** `(source, external_product_id)` contra `external_product_map`.

Marca por configuración + artículo por id = **"este artículo de esta marca" al 100%, siempre, venga de Last o de Otter.**

**Por qué esta vía y no atribuir la marca por la línea de venta (`locationBrandId`):** la vía de la línea es real pero depende de un campo que **a veces viene `null`** (comprobado en las ventas CTB de Folvy Interno). Una vía que depende de un dato que no siempre llega **no puede garantizar el 100%**. La configuración-de-marca no es la única vía que existe, pero **es la única que cumple la condición de 100% determinista** que exige Julio. (Mejor: sí. Única que cumple el 100%: sí. Única en absoluto: no — ver §10.)

**Alcance honesto del "100%":** es 100% de **identificación** (nada se identifica mal, nada se pierde), que es el requisito. NO es "0 intervención humana": un producto nuevo que aparece antes de configurarse cae a la cola (visible, no perdido) y el enlace a escandallo la primera vez es humano. "100%" = "nada se identifica mal y nada se pierde", no "nada toca una mano nunca" (eso no existe en ningún competidor).

---

## 7. Modelo de datos del contrato (sobre el RECON real)

### 7.1 Se CREA

**`external_product_map`** — la tabla de alias única, el casado de reconocimiento:
- `source` (text) — `lastapp` | `otter` | `glovo` | …
- `external_product_id` (text) — id estable del producto en esa fuente.
- `external_brand_id` (text, opcional) — marca en esa fuente.
- `menu_item_id` (uuid) — el plato de Folvy.
- `account_id` (uuid), timestamps.
- **Clave única:** `(account_id, source, external_product_id)` = la clave de casado universal.
- N matrículas por `menu_item` (un plato vendido en Last y en Otter → dos filas). **Esto es lo que las columnas en `menu_item` no pueden, y por lo que se elige tabla de alias** (decisión técnica de Claude, obligatoria bajo "una sola forma para todas las fuentes").

**`external_brand_map`** (gemelo a nivel marca, la configuración de §6) — eleva a genérico lo que hoy son `lastapp_integration` + `lastapp_location_map`:
- `source`, `external_location_id` (text), `external_brand_id` (text) → `brand_id` (uuid de Folvy) + `account_id`.
- Es la tabla que representa la pantalla de alta de tspoon (`LAST LOCATION` + `LAST BRAND` → marca). Atadura determinista de marca por configuración.

### 7.2 Se AÑADE a `sale_line`

- `external_source` (text), `external_product_id` (text), `external_brand_id` (text) — que **el adaptador rellena** al entrar la venta. La línea trae su id crudo; el núcleo lo casa contra el alias.

### 7.3 Se JUBILA

- `menu_item.external_id` / `external_source` → su contenido se **migra** a `external_product_map`; las columnas quedan en desuso (o se retiran tras verificar).
- `lastapp_product_map` / `lastapp_catalog_product` → Last deja de tener tablas propias de casado; pasa a ser **un `source` más** dentro del alias. Quedan como insumo de migración o se retiran.
- **El "espejo del catálogo del cedente" no se construye.** Descartado (§10).

---

## 8. Plan de migración (unifica propias y cedidas)

El criterio: al terminar, **propias y cedidas casan por el mismo mecanismo** (id contra alias + marca por configuración).

- **Propias (Last):** las 168 matrículas de `menu_item.external_id` se vuelcan a `external_product_map` como `source='lastapp'`. Pasan a casar por id vía alias, no por columna suelta. Su marca se registra en `external_brand_map`.
- **Cedidas (Last, CTB):** se registra su `(source, external_location_id, external_brand_id)` en `external_brand_map` (la marca queda atada por configuración → adiós `no_brand`). Sus matrículas de producto se siembran en `external_product_map` desde el feed de ventas (el id que el adaptador empieza a capturar). El `menu_item` cedido se autocrea desde el feed (`needs_review`); Pamela liga escandallo.
- **Recast** de lo ya recibido: con las matrículas pobladas, se re-procesan las ventas CTB existentes → la marca de las 121 `no_brand` se resuelve retroactiva. **No se vuelve a recibir nada.**
- **Last deja de ser especial:** el núcleo ya no lee `lastapp_*`.

---

## 9. Criterio de aceptación (deuda 0, medible)

Esto toca el **casado, que es el corazón** — no es trivial. Se construye con red:
- Tras la migración, el **% de casado en Folvy Interno NO baja** respecto a hoy (1.046 `pos` como suelo; la meta es subir resolviendo las 121 CTB vía marca atada).
- Verificación contra la BBDD (`information_schema`, conteos por `map_source`/`unmapped_reason`), nunca contra "Success".
- Las funciones SECURITY DEFINER se prueban **desde la app** (con sesión), no en SQL Editor.
- Sólo cuando el casado no baja y las CTB casan → frente a HECHO → entonces se configura Llorente29.

Tamaño real (sin humo): crear dos tablas, añadir tres columnas a `sale_line`, migrar 168 filas + sembrar CTB, y reescribir el casado para leer el alias en vez de tres sitios. Acotado y medible. No es un océano.

---

## 10. Decisiones cerradas (no reabrir sin motivo) y alternativas descartadas

**Cerradas:**
1. Contrato único de ingesta multi-fuente; nada atado a un TPV; el núcleo no conoce ninguna fuente.
2. Matrícula de producto en **tabla de alias `external_product_map`** (N por plato), NO columnas en `menu_item`.
3. Marca atada por **configuración de integración** (`external_brand_map`), NO deducida de la línea de venta.
4. Propias y cedidas se **migran al mismo mecanismo**; ninguna conserva su camino viejo.
5. Dos casados: reconocimiento por id (automático) + coste por enlace producto→escandallo (humano-una-vez; IA futura).
6. "100%" = identificación determinista (nada mal identificado, nada perdido), no "0 manos".

**Descartadas, con motivo (para que nadie las reabra a ciegas):**
- **Espejar el catálogo del cedente vía API de Last** → ningún competidor lo hace; ata a Last; fue el agujero de conejo de la sesión del 11/06. Descartado.
- **Columnas `external_*` en `menu_item`** → solo aguantan una fuente por plato; romperían "una sola forma para todas las fuentes" al entrar Otter. Descartado.
- **Atribuir marca por `locationBrandId` de la línea** → viene `null` a veces (comprobado en CTB) → no garantiza el 100%. Es vía válida pero NO cumple el requisito. Descartado como mecanismo primario (se usa solo como validación opcional).
- **Sembrar el menú desde ventas con marca ambigua** (objeción 10/06) → resuelto: con la marca atada por configuración, sembrar desde ventas pasa a ser determinista, que es lo que hace el mercado (R365/Apicbase).

---

## 11. Lo que este frente NO hace (alcance y deudas declaradas)

- NO construye el adaptador de Otter (depende de la respuesta a su correo de partnership). SÍ deja el contrato listo para que Otter sea "rellenar el contrato", no reformar.
- NO resuelve los 52 `no_recipe` propios (escandallos faltantes = trabajo de Pamela, frente de datos paralelo).
- NO incluye IA de enlace producto→escandallo (mejora futura sobre el enlace humano).
- NO toca economía/liquidación cedida (comisión + consumo a precio pactado vive en `folvy_economia_plataformas_diseno.md`).

---

## 12. Próximo paso

Construcción por tramos, en Folvy Interno, un paso por turno, con verificación contra BBDD en cada uno:
1. Crear `external_product_map` + `external_brand_map` (DDL versionado, migración).
2. Añadir columnas de matrícula a `sale_line` + regenerar `database.ts`.
3. Formalizar el contrato del adaptador `lastapp` (rellena matrícula; captura `organization_product_id` + marca).
4. Reescribir el casado del núcleo para leer el alias.
5. Migrar propias (168) + sembrar/atar CTB + recast.
6. Medir: el casado no baja; las CTB casan. → HECHO → configurar Llorente29.

*Documento de diseño. Aprobado decisión por decisión. Recoge la auditoría de competencia (6 fuentes) y el RECON de la BBDD del 11/06. Sustituye la vía "espejo" de `folvy_ingesta_canonica_diseno.md`.*
