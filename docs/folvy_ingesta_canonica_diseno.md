# Folvy — Ingesta canónica: Folvy como fuente de verdad, TPV/plataformas como adaptadores reconciliados

**Fecha:** 10 jun 2026
**Estado:** DISEÑO conceptual aprobado por Julio (decisión por decisión, en sesión). NO construido. Pendiente de su tramo técnico.
**Corona a:** `folvy_fiabilidad_casado_diseno.md` (7 jun) — aquel define *qué hacer con lo que no casa* (cola de excepciones, señal de fiabilidad, alarmas); **este** define *por qué algo llega sin casar y cómo se estructura la ingesta para que el 100 % sea estructural, no un parche*. La fiabilidad es la red de seguridad **dentro** de esta arquitectura.
**No duplica:** `folvy_economia_plataformas_diseno.md` (liquidación/márgenes) ni `folvy_arquitectura_reconciliada.md`. Aquí: **ingesta y atribución de la venta a su artículo**, no la economía del canal.

---

## 0. El problema (diagnóstico de la sesión 10/06)

Hoy Folvy **depende de descargar el catálogo del TPV** (Last) para atribuir marca y artículo a cada venta. Eso hace la fiabilidad estructuralmente frágil:

- Si el catálogo no entra (marcas cedidas de Cloudtown: catálogo **por canal**, sin "default" → el importador busca "default" y trae 0).
- Si entra incompleto o **desactualizado** (el catálogo propio se importó el 28/05 y nunca se refrescó: foto estática).
- Si cada TPV organiza su catálogo distinto (Last por canal; Otter, Square, Deliverect, Glop… cada uno a su manera) → cada integración nueva multiplica los puntos de fallo.

Medición real (cuenta Folvy Interno, 10/06): **426 líneas casadas / 76 sin casar ≈ 87 %**. Por importe: 7.662 € casado vs ~1.144 € sin casar. El grueso del fallo (`no_brand`, 56 líneas, 803 €) son las cedidas, cuyo catálogo no entró.

**Exigencia innegociable (Julio):** *"Folvy tiene la obligación de garantizar que todo artículo que entre de cualquier tipo de venta se registre. Es la base, junto a las compras, de todo el sistema. Si no hay fiabilidad 100 %, Folvy es inútil."* El 100 % no es una feature: es el cimiento del MRP II (consumo → inventario → compras → food cost). Si la ingesta miente al 1 %, todo lo de arriba miente.

---

## 1. El giro arquitectónico: **Folvy es la verdad; el TPV se reconcilia contra ella**

Hoy está invertido: el TPV es la verdad y Folvy intenta copiarla. Se le da la vuelta:

> **El catálogo de artículos vive en Folvy y es la única fuente de verdad de "qué se vende y de qué es". Cada TPV/plataforma es un ADAPTADOR que trae ventas y las RECONCILIA contra el catálogo de Folvy por un identificador estable (su "matrícula externa"). Lo que casa, casa. Lo que no, va a una cola de excepciones — nunca se pierde, nunca se inventa. Añadir un TPV = un adaptador + matrículas, cero cambios en el núcleo.**

Esto es exactamente el principio que ya estaba anotado como rector ("FRONTERA ÚNICA + CANÓNICO multi-TPV"), llevado hasta el final: la **verdad** también es de Folvy, no solo el formato canónico.

**Por qué resuelve el ejemplo de Julio (cliente con Otter de agregador + Square de TPV + Folvy de gestión):** ninguno de los tres "posee" el catálogo. Folvy lo posee. Square aporta sus ventas con sus matrículas; Otter las suyas con las suyas; Folvy las reconcilia **todas** contra su catálogo. El inventario/coste/compras se calculan sobre **el artículo de Folvy**, una sola verdad, vengan de donde vengan las ventas.

**Concordancia con el líder (tspoon):** tspoon **no** trata el catálogo del TPV como verdad — mantiene su propio catálogo de platos/artículos (`13_platos_detalle`) y casa las ventas contra él por id estable (`codeCustomerProduct`, UUID con el mismo formato que `organizationProductId`/`catalogProductId` de Last). Julio llegó a esta arquitectura por instinto de operador; coincide con el competidor de referencia. Señal fuerte de que es el camino.

---

## 2. Las tres capas (separación que el 100 % exige)

| Capa | Qué es | Dónde vive hoy | Verdad de… |
|---|---|---|---|
| **Artículo físico** | la cosa que se cocina: coste, stock, escandallo, alérgenos | `recipe_item` (+ `recipe_item_*`) | **Folvy, SIEMPRE** |
| **Presentación comercial** | cómo se ofrece: nombre, foto, precio, por marca×canal | `menu_item` (+ `menu_item_override`) | propias=Folvy / cedidas=cedente |
| **Matrícula externa** | el id con el que cada fuente llama a esa presentación | `menu_item.external_id` + `external_source` (¡ya existe!) | de la fuente |

**Regla de oro:** un artículo físico, N presentaciones, N matrículas. La Coca-Cola es **un** `recipe_item` (un coste, un stock). En Big Mike's se presenta "Coca-Cola" 2,50 €; en Dos Coyotes "Refresco Cola" 2,20 € con otra foto (`menu_item` + `override`). Cada presentación×canal tiene su matrícula externa (`catalogProductId` distinto en Last), pero **todas descuentan la misma lata**. El inventario vive en el artículo; el nombre/precio en la presentación; el id en la matrícula.

Esto ya está modelado (`recipe_item` ↔ `menu_item` ↔ `menu_item.external_id`). El rediseño **lo completa y lo usa como eje del casado**, no lo inventa.

---

## 3. Los DOS REGÍMENES (decisión Julio 10/06: propias ≠ cedidas)

La propiedad del catálogo decide quién manda. Por marca, vía `catalog_source` (`'folvy'` | `'pos'`):

### 3.A — Marcas PROPIAS → **Folvy es la verdad**
El operador crea/cura su catálogo en Folvy. Las fuentes se reconcilian contra esa verdad; si difieren, **manda Folvy**. A futuro Folvy *publica* hacia el TPV (Fase 2, `catalog_source='folvy'`).

### 3.B — Marcas CEDIDAS (modelo Cloudtown/CTB) → **Folvy ESPEJA, no toca**
El catálogo de la cedida **es del cedente**. Folvy **no lo edita** (no cambia nombre/precio/carta del cedente): lo **refleja** (vía `catalog:updated`) para poder casar y costear. `catalog_source='pos'`: la verdad del catálogo entra, nunca sale.

**Pero lo que NO cambia entre regímenes:** el **inventario, consumo, escandallo y coste** son **verdad de Folvy SIEMPRE**, en ambos. La cocina física es una (decisión cerrada: marcas cedidas JUNTAS en la cuenta, `ownership_type='licensed'`). El cedente dice "La Doble se vende a 10,90 €"; Folvy dice "a mí me cuesta 3,20 € de mis ingredientes". **Catálogo del cedente; coste de Folvy.** Lo permite `menu_item` (presentación, puede venir del cedente) vs `recipe_item` (escandallo, siempre de Folvy).

**Economía de la cedida (Julio 10/06, enlaza con `folvy_economia_plataformas_diseno.md`):** el propietario de la marca paga al operador **comisión por venta + consumo a precio pactado** de los productos necesarios. Liquidación distinta de las propias (margen directo). Infraestructura ya empezada: `brand_licensing_agreement`, `brand_channel_rate`, `flow_type='licensed'`.

**Comportamiento ante producto nuevo en una cedida (decisión (a), Julio):** Folvy lo añade a su espejo como `pending_review` y a la cola; el operador (Llorente29) le asigna **escandallo propio** (porque, aunque el catálogo sea del cedente, quien cocina y cuesta es el operador). "No tocar el catálogo" = no alterar la carta del cedente; sí espejar y costear.

---

## 4. El mecanismo del casado (el 100 %, capa a capa)

### 4.1 Siembra del catálogo (arranque) — decisión Julio (1)
El catálogo se **siembra desde una fuente** (Last/Glovo/Uber/cualquiera) para no partir de cero; **después, trabajo humano de curación** ("ver que lo creado es correcto y no falta nada"). Nace de una fuente pero **deja de depender de ella** al curarse: pasa a ser verdad de Folvy (propias) o espejo curado (cedidas).

### 4.2 Catálogo VIVO, no foto — `catalog:updated` (CONFIRMADO con OpenAPI Last v2.0.0)
Last emite el webhook **`catalog:updated`**. **Payload real** (`schemas.catalog-2`): NO manda el catálogo entero ni el delta — manda **`data.catalogIds[]`** (ids de catálogos que cambiaron) + **`data.locationId`** opcional. Es una **notificación ligera**: recibes "cambió el catálogo X" → lo buscas con **`GET /catalogs/{catalogId}`** → actualizas el espejo. Eficiente (solo lo que cambió), mata la foto estática. El cambio del cedente llega solo.

### 4.3 Producto nuevo → se añade, pero `pending_review` — decisión Julio (2)
Lo nuevo (de `catalog:updated` o de una venta con id desconocido) **se añade solo** (no se pierde) **pero queda pendiente de aceptación humana** (no se da por verdad). Estado `pending_review`: funciona provisional, marcado hasta que un humano lo confirma. Es la filosofía anti-invención aplicada al catálogo ("la fuente propone, el humano decide").

### 4.4 Casado por matrícula externa multi-fuente
Cada venta entra por su adaptador → línea canónica → se busca su artículo por **`(external_source, external_id)`** contra `menu_item`. Hoy el casado dominante ya es por id (`map_source='pos'`: 1015 de 1166 líneas). El rediseño: (a) generalizar la matrícula a multi-fuente (el `external_source` ya existe en `menu_item`); (b) **poblar las matrículas que faltan** (168 de 255 menu_items tienen `external_id` → 87 sin matrícula = casado que se cae).

**Identificadores reales que trae cada línea de venta de Last (CONFIRMADO, OpenAPI `tab-2.data.products[]`):**
| Campo | Qué es | Uso para casar |
|---|---|---|
| `organizationProductId` | id del producto a nivel ORGANIZACIÓN (transversal a canales) | **clave estable preferida** — el mismo producto comparte este id en Glovo/Uber/JustEat |
| `catalogProductId` | id del producto en un catálogo concreto (por canal) | clave por-canal; cambia entre Glovo/Uber |
| `externalId` | id externo adicional de la línea | puente alternativo |
| `locationBrandId` | la **marca** del producto | atribución de marca directa (sin parsear sufijos) |

**Hallazgo crítico (10/06):** en el ejemplo oficial `locationBrandId` viene **poblado**. En las ventas CTB de Folvy Interno venía `null` → NO es que Last no lo mande, es que **se perdió en la ingesta de esas ventas** (backfill histórico o el adaptador no lo extrajo). **Acción RECON del tramo:** verificar por qué el webhook/adaptador no guardó `locationBrandId`/`organizationProductId`; si se capturan, el casado de marca es **determinista** (por id, no por nombre ni sufijo) y resuelve los `no_brand`. La clave estable a usar como primaria es **`organizationProductId`** (transversal a canal); `catalogProductId` como secundaria.

### 4.5 Lo no reconocido → cola de excepciones (= el 100 %)
Lo que no case por matrícula **no se pierde ni se adivina**: cae en la cola de excepciones de `folvy_fiabilidad_casado_diseno.md` (estados `no_recipe`/`no_menu_item`/`no_brand`/`ambiguous`/`ignored`/`delisted`), visible y resoluble. **El 100 % no es que todo case automático: es que nada se pierda en silencio.** Cada fuente nueva, lo que no reconoce, cae en la misma red → añadir fuentes **no degrada** la fiabilidad.

---

## 5. Qué EXISTE ya y qué FALTA (RECON 10/06, fuente primaria)

**Existe (≈70 % de la arquitectura):**
- `recipe_item` (+ familia) = artículo físico. ✅
- `menu_item` + `menu_item_override` = presentación + variación por marca/canal. ✅
- `menu_item.external_id` + `external_source` = matrícula externa multi-fuente. ✅ (infrautilizada)
- `brand`, `brand_channel`, `sales_channel`, `brand_channel_rate`, `channel_rate`, `brand_licensing_agreement` = capa marca×canal + licencia. ✅
- `sale` / `sale_line` con `map_source`, `unmapped_reason`, `computed_cost` = ingesta canónica + razón del no-casado. ✅
- `lastapp_product_map`, `lastapp_catalog_product` = mapa/espejo (de momento solo Last).
- Casado por id ya dominante: `map_source='pos'` 1015/1166.

**Falta (lo que lleva del 87 % al 100 %):**
1. **Generalizar** `lastapp_product_map` → `external_product_map` con `source` (last|square|otter|glovo…), o usar directamente `menu_item.(external_source, external_id)` como puente único. *(Decisión técnica del tramo: una tabla de alias vs columnas en menu_item. Probable: columnas en menu_item para la matrícula 1:1 + tabla de alias solo si una presentación necesita varias matrículas.)*
2. **Poblar las matrículas que faltan** (87 menu_items sin `external_id`).
3. **Catálogo vivo**: suscribir/procesar `catalog:updated` (hoy no se escucha) → mantener el espejo y disparar `pending_review`.
4. **Estado `pending_review`** en el catálogo (hoy `needs_review` existe en `menu_item`; verificar que cubre el flujo de aceptación).
5. **Cerrar la cola de excepciones** y la señal de fiabilidad de `folvy_fiabilidad_casado_diseno.md` (diseñada, no construida).
6. **`catalog_source` por marca** (folvy|pos) para separar los dos regímenes en el comportamiento de escritura.
7. **Adaptador como capa explícita** (hoy el webhook de Last hace de adaptador; formalizar el contrato `fuente → sale_line canónica` para que Otter/Square/Glovo sean "otro adaptador").

---

## 6. Benchmark (para golear, no empatar)

- **tspoon**: catálogo propio + casado por id estable (`codeCustomerProduct`) + pantalla de excepciones por marca (5 estados). Folvy iguala el enfoque y **golea**: separa `no_recipe` de `no_menu_item` (acción distinta), propone el match con IA (no solo lista), y suma **catálogo vivo** (`catalog:updated`) que tspoon no tiene confirmado.
- **Agregadores (Otter, Deliverect)**: consolidan pedidos, pero no son sistema de verdad de catálogo/coste. Folvy los usaría como **una fuente más**, no como dueños del dato.
- **Apicbase/R365/meez**: catálogo propio + margen teórico, pero **no reconcilian multi-fuente con cola de excepciones que garantice el 100 %** ni separan régimen propio/cedido. Hueco de Folvy.

---

## 7. Plan por capas (cada una usable sola; principio MRP II)

1. **Contrato del adaptador** `fuente → sale_line canónica` formalizado (Last = primer adaptador, ya de facto). Sin tocar core.
2. **Casado por `(external_source, external_id)`** como vía primaria + poblar matrículas faltantes. Sube fiabilidad sin esperar al resto.
3. **`catalog_source` por marca** + comportamiento de escritura (propias: Folvy manda; cedidas: espejo read-only).
4. **`catalog:updated` vivo** → espejo + `pending_review`. Mata la "foto estática".
5. **Cola de excepciones + señal de fiabilidad** (construir lo de `folvy_fiabilidad_casado_diseno.md`). Aquí se cierra el 100 %.
6. **Segundo adaptador real** (Otter o Glovo directo) → valida que "añadir TPV = un adaptador". 
7. **Visión** (no esta semana): Glovo/Uber **directo** (Folvy = verdad del delivery, sin TPV intermedio) → **TPV propio** (Folvy = verdad total sala+delivery). Cada uno, un adaptador más sobre este cimiento. *Esto es lo que el trabajo de ahora habilita: por eso merece hacerse bien.*

---

## 8. Lo MÍNIMO para que Llorente29 entre al 100 % (esta semana)

Separar lo urgente de lo profundo. Para el onboarding inmediato de Llorente29:

- **Marcas PROPIAS**: entran **ya** con el mecanismo actual (su catálogo tiene "default", como los 439 de Folvy Interno). El import normal funciona. **No bloquean.** → dar de alta integración propia + importar + sembrar + recasar, como se validó hoy con la pantalla de Integraciones.
- **Marcas CEDIDAS (Cloudtown)**: su catálogo es **por canal sin default** → el import no las trae. Para que entren al 100 % sin tocar la carta del cedente, la vía limpia es **mínimo de capa 4** (procesar el catálogo por canal del cedente como espejo) **o**, como puente inmediato, sembrar el espejo desde el `catalog:updated`/catálogo por-canal del cedente y casar por `catalogProductId`. **No** sembrar desde ventas (marca null/ambigua, descartado 10/06). **No** export CSV (estático, frágil a cambios — objeción válida de Julio).
- **Cola de excepciones mínima**: que las cedidas no casadas queden **visibles y resolubles**, no perdidas. Aunque sea la versión 1 de la pantalla de excepciones.

**Decisión pendiente para cerrar el alcance Llorente29:** ¿se ataca capa 4 (catálogo vivo por-canal) ahora —solución buena y definitiva, algo más de trabajo— o un puente mínimo para esta semana y capa 4 después? Recomendación: si Llorente29 es esta semana, **puente mínimo** que garantice "nada se pierde" (cola) + casar lo que traiga `catalogProductId`; capa 4 como tramo siguiente.

---

## 9. Decisiones cerradas en esta sesión (no reabrir sin motivo)

1. Folvy es la verdad del catálogo (propias); espeja sin tocar (cedidas). Régimen por marca (`catalog_source`).
2. Tres capas: artículo físico (Folvy siempre) / presentación (cedente en cedidas) / matrícula externa (de la fuente).
3. Inventario/consumo/coste = Folvy SIEMPRE, ambos regímenes (cocina única; cedidas JUNTAS, `licensed`).
4. Catálogo se siembra de una fuente y se cura (humano). No depende de la fuente tras curar.
5. Producto nuevo: se añade `pending_review`, no se pierde ni se da por verdad.
6. Casado por id estable multi-fuente; lo no reconocido → cola de excepciones (= 100 %).
7. Económico cedido: comisión por venta + consumo a precio pactado (≠ margen de propias).
8. Visión: multi-TPV → Glovo/Uber directo → TPV propio, cada uno un adaptador sobre este cimiento.

---

*Documento de diseño. Nada construido. Próximo paso cuando se ataque el tramo: RECON técnico fino de `menu_item.external_id`/`external_source` (relleno y unicidad), decisión "columnas vs tabla de alias" para la matrícula, y contrato del adaptador. Corona a `folvy_fiabilidad_casado_diseno.md`; no duplica `folvy_economia_plataformas_diseno.md`.*
