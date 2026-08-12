---
name: folvy_recepcion_un_paso_diseno_20260812
description: DISEÑO del ciclo de recepción de Folvy — de 4 pasos a 1, con el stock entrando en el momento de recibir. Incluye el RECON medido en producción el 12/08 (87,6% del casado pendiente ya está aprendido en article_supplier y NO se consulta) y las decisiones de Julio sobre revisión de oficina. Leer antes de tocar goods_receipt, goods_receipt_line, learn_from_receipt, confirm_goods_receipt o el casado de artículos.
sources:
  - cowork
---

# Recepción en UN paso — DISEÑO

> **Estado: RECON ✅ medido en producción 12/08 · DECISIONES DE JULIO INCORPORADAS · PENDIENTE DE CONSTRUIR.**
> Julio: *"de la recepción del trabajador pasa a la confirmación, después a meter stock, después a
> casar artículos (artículos que ya se han casado en repetidas ocasiones) y al final metes en el
> almacén sin saber ni qué cantidad ni qué formato. Es muy complicado el ciclo de algo sencillo."*

---

## 1. 🔴 EL HALLAZGO QUE CAMBIA TODO EL DISEÑO

**La memoria de casado YA EXISTE, ya aprende, y NADIE la consulta.**

`learn_from_receipt(p_receipt_id)` está en producción y, al confirmar un albarán, escribe en
`article_supplier`:

| Campo | Qué guarda |
|---|---|
| `supplier_item_name` | **el texto tal cual viene en el albarán** |
| `supplier_code` | código del proveedor |
| `purchase_format_id` | **y su formato de compra** |
| `last_price` | €/unidad base (canónico, vía `_eur_base_from_format`) |

**Y está poblada** (cuenta Llorente29, verificado por MCP):

| | |
|---|---|
| Filas | **248** |
| Con el texto del albarán | 140 |
| Con código de proveedor | 173 |
| **Con formato** | **240** |
| Con precio | 238 |

**Comprobación decisiva:** de las líneas hoy sin casar, **TODAS** están ya en `article_supplier`
**con el mismo proveedor**. "Cebolla roja", "Cilantro manojo", "Sobre americano AY MAMITA caja 250
ud"… todas.

> **El sistema aprende bien y luego no lee lo aprendido.** No falta memoria: falta la consulta.

Esto **elimina la fase R1 que se había diseñado** (crear tabla + sembrar del histórico): sobra
entera. El trabajo real es una consulta al escanear.

⚠️ **Patrón repetido en la sesión del 12/08 — cuatro veces:** `negotiated_price`,
`price_drift_for`, `autoclose_daily_count` y ahora `learn_from_receipt`. **Folvy tiene mucho más
construido de lo que parece; lo que falla es que las piezas no se llaman entre sí.** RECON antes de
diseñar, siempre.

---

## 2. El ciclo de hoy: 4 pasos y ninguno recuerda al anterior

```
1. RECEPCIONAR  (muelle)  → escanea el albarán, teclea cantidades  → 'borrador'
2. CONFIRMAR    (oficina) → revisa y confirma                      → 'confirmado'
3. METER AL STOCK         → botón rojo aparte, otro momento
4. CASAR ARTÍCULOS        → modal "12 líneas sin meter — resuélvelas aquí", una por una
```

**Y "confirmado" no significa nada:** convive con *"Falta meter al stock"* en rojo. Parece hecho y
no lo está.

### Lo medido (producción, 12/08)

| | |
|---|---|
| Albaranes **atascados** | **14** (6 confirmados + 8 borradores) |
| Líneas sin casar | 97 |
| **Con texto YA casado antes** | **85 — el 87,6 %** |
| Realmente nuevas | **12** |

Ejemplos reales del modal que ve Julio:

| Texto del albarán | Ya casado con | Veces |
|---|---|---|
| Cebolla tierna fina manojo | Cebollino | **10** |
| Cilantro manojo | Cilantro | **10** |
| Aceite girasol 25 LT | Aceite Alto Oleico | **8** |
| Cebolla roja | Cebolla Morada | **7** |

### Y el casado no es alcanzable desde la recepción
Verificado en pantalla (ALB-00105): las líneas ponen `sin mapear` y **no hay forma de casarlas
ahí** — Julio: *"nada, todo es texto"*. Hay que salir a la lista, pulsar "Meter al stock" y
resolverlas en un modal aparte. Por eso hay **383 líneas marcadas para revisión y ninguna
revisada**: no es dejadez, es que el camino no existe donde se necesita.

---

## 3. Benchmark

| Sistema | Cómo resuelve el casado |
|---|---|
| **MarketMan** | Memoria por proveedor: se casa **una vez** y no se pregunta más |
| **Apicbase** | Catálogo de proveedor con código; casa por código, no por nombre |
| **Crunchtime** | EDI: el proveedor manda el albarán estructurado; el casado no existe |
| **R365** | Recepción contra pedido: lo esperado ya está, solo se confirma o corrige |

**Ninguno pregunta dos veces lo mismo**, y ninguno separa "confirmar" de "entrar a stock".

**El hueco de mercado, y está vacío:** los que tienen memoria (MarketMan) no tienen OCR; los que
evitan el casado (Crunchtime) exigen EDI, que el proveedor español pequeño no tiene. **Nadie
combina OCR de albarán en papel + memoria de casado + entrada a stock en un solo acto.** Aquí Folvy
puede liderar, no alcanzar.

---

## 4. El ciclo nuevo — DECISIONES DE JULIO (12/08)

```
ESCANEAR el albarán  →  Folvy resuelve lo que ya sabe  →  RECIBIR
                                                            ↓
                                        EL STOCK ENTRA EN ESE MOMENTO
                                                            ↓
                                     Oficina REVISA después (obligatorio, no bloquea)
```

### 4.1 El stock entra al RECIBIR, no al confirmar *(decisión de Julio)*
> *"Lo adecuado es meter el stock en el momento de la recepción y posteriormente solo se modifica
> si se detecta un error."*

La mercancía está físicamente en el almacén desde que llega. Esperar a que oficina confirme es
**tener el almacén mintiendo durante horas** — y si nadie confirma, mintiendo para siempre (hoy:
14 albaranes atascados).

**Es la misma decisión que se tomó hoy con las ventas** (descontar al vender y revertir si se
cancela) y con el autoinventario (asentar al contar, no al aprobar). Mismo principio:
**el dato existe cuando ocurre el hecho físico, no cuando alguien lo valida.**

⚠️ **Consecuencia técnica obligatoria:** si la revisión encuentra un error después, la corrección
**ajusta la diferencia**, no vuelve a sumar. Idempotencia + `occurred_at` real, igual que
`generate_sale_consumption`. Y **no puede escribir por detrás de un recuento de inventario
aprobado** (frontera).

### 4.2 Casado automático en coincidencia exacta *(decisión de Julio)*
> *"Siempre que coincida, mejor casado automático, pero con la opción de modificarlo a voluntad."*

Orden de resolución, de más fiable a menos:
1. **`supplier_code`** exacto → casa solo. *(173 filas lo tienen)*
2. **`supplier_item_name`** exacto del mismo proveedor, normalizado → casa solo. **Aquí caen los 85
   pendientes de hoy.**
3. **Texto parecido** (`fuzzy`, ya existe) → propone, marca revisión, **no bloquea**.
4. **Nada** → única línea que se pregunta.

Lo casado automáticamente **siempre se puede cambiar** desde la propia línea. Y arrastra el
**formato** (`purchase_format_id`, 240 filas lo tienen), que es lo que evita el error de conversión.

⚠️ **La memoria es por proveedor.** "Cebolla roja" de dos proveedores pueden ser artículos
distintos.

### 4.3 La revisión de oficina es obligatoria — **por ahora** *(decisión de Julio)*
> *"La revisión es obligatoria para detectar los errores hasta confirmar que todo casa correctamente
> en artículo, cantidad, formato y precio. Una vez asegurado ya sí se podrá quitar."*

- **No bloquea el stock** (§4.1). Es un repaso posterior.
- Obligatoria **mientras el casado automático no se haya ganado la confianza**.
- **Métrica de salida —construirla desde el principio—:** % de líneas que la revisión corrige.
  Si oficina lleva N líneas seguidas sin corregir nada, el sistema se ha ganado el derecho a que se
  le quite el paso. Si corrige el 30 %, no. **Es lo que convierte "ya se podrá quitar" en una
  decisión con dato en vez de una sensación.**

### 4.4 La pantalla: todo se resuelve donde se ve

Nada de modales aparte ni de salir a otra lista:

```
┌──────────────────────────────────────────────────────────┐
│ Servilleta master servis                    ✓ reconocido │
│ → Servilletas 30 x 40 · Caja (4.500 ud)      [Cambiar]   │
│ Recibido [ 2 ] cajas    41,51 €   →  0,0092 €/ud         │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ SALSERA PP+ TAPA BISABRA 2 OZ           ⚠ sin reconocer  │
│ [ Buscar artículo ]  o  [ Crear artículo nuevo ]         │
└──────────────────────────────────────────────────────────┘
```

- **Lo reconocido se ve resuelto**, no en gris ni con un "—".
- **El coste unitario resultante siempre visible.** Es la mejor defensa contra el error de formato:
  un `0,0037 €/ud` de pan se ve mal a simple vista.
- **Lo no reconocido es lo único que pide acción**, con botón grande — nunca un enlace de texto.

### 4.5 Criterio de personal (restricción, no preferencia)
Julio: *"las capacidades profesionales del personal son muy bajas; no les pidas lógica. O les vas
guiando paso a paso o les bloqueas. Si hay decisión, hay error."*

→ Lo que se puede deducir, se deduce. Lo que no, con botones grandes y opciones visualmente
distintas. Nada que exija interpretar. Si algo no cuadra, se bloquea y se avisa al encargado.

---

## 5. Qué NO cambia (y por qué)

- **El OCR se queda.** Es la ventaja competitiva: el albarán llega en papel.
- **El enlace pedido↔recepción se queda** (arreglado hoy, PR #54). Cuando hay pedido, el formato y
  lo esperado ya vienen dados: mejor defensa que cualquier validación posterior.
- **`learn_from_receipt` se queda tal cual.** Funciona. Solo hay que **leerla**.

---

## 6. Fases (revisadas tras el hallazgo del §1)

| Fase | Contenido | Riesgo | Valor |
|---|---|---|---|
| **R1** | ~~Crear tabla de memoria~~ **ELIMINADA** — ya existe y está poblada | — | — |
| **R1'** | **Consultar `article_supplier` al escanear** (código → texto exacto → fuzzy) y casar automáticamente, arrastrando formato | bajo | **Elimina el 87,6 % del casado desde el primer albarán** |
| **R2** | Casado y formato **en la propia línea**; fuera el modal aparte | medio: pantalla de uso diario | Se acaba el "todo es texto" |
| **R3** | **El stock entra al recibir**; fuera el botón "Meter al stock"; corrección posterior por diferencia | medio-alto: toca el motor de stock | Un albarán recibido está en stock. Sin limbo |
| **R4** | Panel de revisión de oficina + **métrica de tasa de corrección** (§4.3) | bajo | Permite decidir con dato cuándo quitar el paso |
| **R5** | **Puntos de pedido autocalculados** (§9) — consumo × plazo + colchón, en formato de proveedor | medio | Cierra el ciclo: MRP II real. **Exige R1' y R3 hechos** |

**R1' es lo que más devuelve por lo que cuesta** y no toca la operación: solo lee.

⚠️ **Los 14 albaranes atascados de hoy:** tras R1', la mayoría se resuelven solos al reabrirlos
(85 de 97 líneas tienen casado conocido). Los **12 realmente nuevos** se hacen a mano una vez.

---

## 7. Por qué esto importa más que casi todo

Sin recepción fiable no hay coste fiable; sin coste no hay escandallo, ni food cost, ni AvT, ni T7,
ni pedidos automáticos. **Es el cimiento del diferencial de Folvy** —inventario perpetuo con coste
real— y hoy es justo el paso donde el dato se pierde o se corrompe.

Caso rector: el **Pan de Pita**. 480 unidades tratadas como 480 cajas → coste ×80 abajo → toda la
carta de Meraki descuadrada, y la Pita Mixta aparentando un 91 % de margen. Medido: **27 de 129
artículos** con factores de conversión inconsistentes y **12 con el coste variando ×10 o más**.

---

## 8. Pendiente

1. Aprobar las fases revisadas.
2. **Definir el umbral de la métrica de §4.3**: cuántas líneas seguidas sin corrección bastan para
   poder quitar la revisión obligatoria.
3. Encargo de R1' a Code — es la fase con mejor relación valor/riesgo y **no toca la operación**.

---

## 9. R5 · Puntos de pedido autocalculados — la continuación natural

> Julio: *"con el autoaprendizaje se deberían regular los formatos solos, en especial el que se usa
> para los pedidos a proveedor, y así poder mantener un stock mínimo en función de, entre otros, ese
> parámetro. Es decir, empezar a trabajar en los puntos de pedido."*

**Es la conexión que da sentido a todo lo anterior.** El formato habitual no sirve solo para casar
bien: es lo que convierte un cálculo en un pedido ejecutable. *"Pide 37,4 kg de cebolla"* no vale —
el proveedor vende sacos. *"Pide 2 sacos de 20 kg"* sí.

### 9.1 La estructura YA EXISTE y está VACÍA (sexta vez en la sesión)

`stock_level` tiene `reorder_point`, `safety_qty` y `lead_time_days`. Estado real (verificado por
MCP, cuenta Llorente29):

| | |
|---|---|
| Filas | 36 (de un catálogo de ~129 artículos comprables) |
| Locales cubiertos | **1 de 2** |
| **Con punto de pedido** | **0** |
| **Con stock de seguridad** | **0** |
| **Con plazo de entrega** | **0** |

**Nadie va a rellenar a mano 129 artículos × 2 locales × 3 parámetros.** Ese es exactamente el muro
por el que estas tablas se quedan vacías en todos los sistemas del sector — y por el que está vacía
aquí.

### 9.2 Pero los datos para calcularlo solo YA ESTÁN

| Dato | De dónde sale | Cobertura medida |
|---|---|---|
| **Consumo diario** | `stock_movement` tipo `consumo`, 90 días | **249 artículos**; 144 con historial sólido (10+ días con movimiento) |
| **Plazo / ritmo de entrega** | intervalo real entre recepciones del mismo artículo | **186 artículos** |
| **Formato de pedido** | `article_supplier.purchase_format_id` | **240 de 248 filas** |

**Ninguno de los tres hay que teclearlo.** Todos salen del histórico que Folvy ya tiene.

### 9.3 La cadena, cerrada

```
consumo diario  ×  plazo de entrega  +  colchón de seguridad  =  PUNTO DE PEDIDO
                                                                        ↓
                        formato habitual del proveedor (article_supplier)
                                                                        ↓
                                         "Pide 2 sacos", no "pide 37,4 kg"
```

Y se cierra con lo que ya existe: `pending_receptions_report` sabe **lo que está en camino**, así
que el cálculo descuenta lo ya pedido y **no duplica pedidos** — que era el objetivo del sistema
tipo MRP II que motivó cancelar los 30 pedidos en junio.

### 9.4 🔴 Dependencia dura, declarada

**El punto de pedido se alimenta del consumo, y el consumo hoy NO es fiable.** Si se calcula sobre
recepciones mal convertidas (27 de 129 artículos con factor inconsistente, 12 con coste ×10),
**pedirá mal con toda la confianza del mundo**.

→ **R1' y R3 van antes. No es preferencia: es que R5 sobre datos sucios produce pedidos erróneos
automáticos**, que es peor que no tener pedidos automáticos.

### 9.5 Y se declara desconocido lo que no se sabe
Artículo sin historial suficiente (menos de 10 días con consumo, o menos de 2 recepciones) →
**no se le inventa un punto de pedido**. Se muestra como *"aún sin datos suficientes"*.
Misma regla que en T7 y en `disabled_since_known`: **un dato derivado que no se puede conocer se
declara desconocido, no se rellena con un valor plausible.**

---

## 10. 🔴 LA LECCIÓN DE LA SESIÓN — por qué esto no puede quedarse "pendiente"

> Julio: *"dejarlo pendiente es lo que no me convence absolutamente nada. Al final, siempre que se
> dejan buenas ideas, mueren o no se conectan. Es el gran mal y defecto de Folvy. A estas alturas
> debería ser tremendamente sólido; tú lo estás viendo, cómo muere en las conexiones de la info."*

**Tiene razón, y hay prueba medida.** En una sola sesión (12/08) aparecieron **seis** piezas
construidas, correctas y **desconectadas**:

| Pieza | Estado | Qué le faltaba |
|---|---|---|
| `negotiated_price` | existe, 44 artículos poblados | no alimenta `computed_cost`: solo pinta un badge |
| `price_drift_for` | existe y calcula bien | solo avisa, nunca bloquea |
| `autoclose_daily_count` | existe y funciona | **nadie la llamaba** — conteos parados >20 h |
| `learn_from_receipt` | existe, 248 filas aprendidas | **nadie la consulta** — se pregunta 10 veces lo mismo |
| P1 ciclo de compra | backend mergeado el 10/08 | el enlace no se ofrecía donde se confirma |
| `stock_level` | tabla correcta | **vacía**: 0 puntos de pedido |

**Folvy no falla por falta de piezas. Falla en las conexiones**, y la causa raíz es siempre la
misma: **se construye, se mergea, y nadie verifica que se USE.**

### La regla que sale de aquí
> **Ninguna pieza se da por terminada hasta que algo la consume y se ha verificado con datos
> reales que la consume.** Un `create function` verde no es una entrega: la entrega es la primera
> vez que otro proceso la llama y el resultado se comprueba en producción.

Es la extensión natural de la regla de las tres patas (*en caliente · barrido · vigía*): **falta la
cuarta — quién la usa.**

**Aplicado a este diseño:** R1', R2, R3, R4 y R5 son **un solo frente**, no cinco ideas. Si se
construye R1' y no se conecta a la pantalla, no se ha hecho nada. El criterio de terminado de cada
fase es **la siguiente fase funcionando encima**, y la de R5 es un pedido real hecho por el sistema
y aceptado por Julio.

---

## 11. Nota de Code (12/08) — RECON propio antes de guardar

Antes de subir este documento, re-verifiqué por MCP (cuenta Foodint /
`51ad1792-6629-4ef7-833a-b57b09a86710`) las cifras decisivas del §1 y del §9.1:

- **§1, tabla de `article_supplier`**: 248 / 140 / 173 / 240 / 238 — **exacto**, coincide dígito a
  dígito.
- **§2, "14 atascados (6 confirmados + 8 borradores)" y "97 líneas sin casar"**: **exacto**.
- **§2, "85 ya casadas antes — 87,6 %"**: mi propia consulta (código exacto O
  `supplier_item_name` exacto normalizado, mismo proveedor) da **83 de 97 (85,6 %)** — 2 líneas por
  debajo del número del documento. Diferencia mínima, probablemente por una heurística de
  normalización ligeramente distinta a la del cowork (acentos/espacios, o si también prueba contra
  `product_name` además de `raw_text`). **No cambia la conclusión**: siga en 83 o en 85, la cifra
  que importa —la mayoría abrumadora del casado pendiente ya está aprendida y no se consulta— se
  sostiene.
- **§9.1, `stock_level`**: 36 filas / 1 local / 0 punto de pedido / 0 stock de seguridad / 0
  plazo — **exacto**.

⚠️ **Punto que NO he resuelto yo y que sí necesita tu decisión antes de tocar código:** el §4.1 de
este documento ("el stock entra al **recibir**, la revisión de oficina nunca bloquea") y el §4
("Fases corregidas") de
[`folvy_coste_recepcion_blindaje_diseno_20260812.md`](folvy_coste_recepcion_blindaje_diseno_20260812.md)
(R3: "bloqueo real... antes de que la línea entre a stock") describen el mismo instante — la
entrada a stock de una recepción — con dos filosofías que hoy no encajan: uno dice que nada bloquea
la entrada física, el otro diseña un bloqueo justo ahí. Antes de encargar R1' (que no toca esto)
esto no urge; antes de encargar R3 de cualquiera de los dos documentos, sí hace falta que digas
cuál manda.
