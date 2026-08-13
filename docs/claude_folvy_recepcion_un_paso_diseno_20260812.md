---
name: folvy_recepcion_un_paso_diseno_20260812
description: DISEÑO del ciclo de recepción de Folvy — de 4 pasos a 1. Incluye el RECON medido en producción el 12/08 (87,6% del trabajo pendiente de casado es repetir lo ya hecho) y el diseño de la memoria de casado por proveedor. Leer antes de tocar goods_receipt, goods_receipt_line, el casado de artículos o el paso "Meter al stock".
sources:
  - cowork
---

# Recepción en UN paso — DISEÑO

> **Estado: RECON ✅ medido en producción 12/08 · PENDIENTE DE APROBACIÓN.**
> Julio: *"de la recepción del trabajador pasa a la confirmación, después a meter stock, después a
> casar artículos (artículos que ya se han casado en repetidas ocasiones) y al final metes en el
> almacén sin saber ni qué cantidad ni qué formato. Es muy complicado el ciclo de algo sencillo."*

---

## 1. El ciclo de hoy: 4 pasos y ninguno recuerda al anterior

```
1. RECEPCIONAR  (muelle)    → escanea el albarán, teclea cantidades   → status 'borrador'
2. CONFIRMAR    (oficina)   → revisa y confirma                        → status 'confirmado'
3. METER AL STOCK           → botón rojo aparte, otro momento
4. CASAR ARTÍCULOS          → modal "12 líneas sin meter — resuélvelas aquí"
                              con "Casar artículo" uno por uno
```

**Y "confirmado" no significa nada:** un albarán confirmado convive con *"Falta meter al stock"* en
rojo. Parece hecho y no lo está.

### Lo medido (producción, 12/08)

| | |
|---|---|
| Albaranes **atascados** | **14** (6 confirmados + 8 borradores) |
| Líneas sin casar | 97 |
| **De ellas, con texto YA casado antes** | **85 — el 87,6 %** |
| Realmente nuevas | **12** |

**El 87,6 % del trabajo pendiente es repetir lo ya hecho.** Ejemplos reales del modal que ve Julio:

| Texto del albarán | Ya casado con | Veces |
|---|---|---|
| Cebolla tierna fina manojo | Cebollino | **10** |
| Cilantro manojo | Cilantro | **10** |
| Aceite girasol 25 LT | Aceite Alto Oleico | **8** |
| Cebolla roja | Cebolla Morada | **7** |
| Servilleta master servis | Servilletas 30 x 40 | 1 |

**El sistema pregunta 10 veces lo mismo, con texto idéntico y el mismo proveedor.** Nadie guarda lo
aprendido: cada albarán empieza de cero.

### Y el paso de casar ni siquiera es alcanzable desde la recepción
Verificado en pantalla (ALB-00105): las líneas ponen `sin mapear` y **no hay ninguna forma de
casarlas ahí** — Julio: *"nada, todo es texto"*. Hay que salir a la lista, pulsar "Meter al stock" y
resolverlas en un modal aparte. Por eso hay **383 líneas marcadas para revisión y ninguna revisada**:
no es dejadez del equipo, es que el camino no existe donde se necesita.

---

## 2. Qué hace un SaaS profesional (benchmark)

| Sistema | Cómo resuelve el casado |
|---|---|
| **MarketMan** | Memoria por proveedor: el mismo texto se casa **una vez** y ya no se pregunta más |
| **Apicbase** | Catálogo de proveedor con código; el albarán casa por código, no por nombre |
| **Crunchtime** | EDI: el proveedor manda el albarán estructurado, el casado no existe |
| **R365** | Recepción contra pedido: lo esperado ya está, solo se confirma o corrige |

**Ninguno pregunta dos veces lo mismo.** Y ninguno separa "confirmar" de "entrar a stock": recibir
mercancía **es** darla de alta.

Folvy hoy hace las cuatro cosas peor a la vez. Pero tiene una ventaja que ninguno tiene: **OCR del
albarán en papel**, que es como llega el 99 % de la mercancía en hostelería española.

---

## 3. El ciclo nuevo: UN paso

```
ESCANEAR el albarán  →  REVISAR lo que Folvy ya ha resuelto  →  CONFIRMAR
                                                                  ↑
                                            entra a stock en el mismo acto
```

**"Confirmar" y "meter al stock" se fusionan.** No hay dos estados: o está confirmado y en stock, o
no está confirmado. El botón rojo "Meter al stock" desaparece.

### 3.1 Memoria de casado — la pieza que elimina el 87,6 % del trabajo

Tabla nueva `supplier_line_mapping`:

| Campo | |
|---|---|
| `account_id`, `supplier_id` | de quién viene |
| `raw_text_norm` | texto del albarán normalizado (minúsculas, sin acentos, sin dobles espacios) |
| `supplier_code` | código del proveedor, cuando viene (**33,5 % de las líneas**, verificado) |
| `recipe_item_id` | artículo de Folvy |
| `purchase_format_id` | **y su formato** — casar sin formato no sirve de nada |
| `times_used`, `last_used_at` | para ordenar y para el vigía |

**Orden de resolución al escanear, de más fiable a menos:**
1. **`supplier_code`** exacto → casa solo, sin preguntar.
2. **`raw_text_norm`** exacto del mismo proveedor → casa solo. *(Aquí caen los 85 de hoy.)*
3. **Texto parecido** (`fuzzy` ya existe) → propone, marca `needs_review`, **no bloquea**.
4. **Nada** → única línea que se pregunta.

**Se aprende en cada confirmación:** al confirmar, cada línea casada a mano escribe o actualiza su
fila. La 21ª cebolla roja no se pregunta nunca más.

⚠️ **La memoria es por proveedor, no global.** "Cebolla roja" de Cloudtown y de otro proveedor
pueden ser artículos distintos.

### 3.2 La pantalla: todo se resuelve donde se ve

Nada de modales aparte ni de salir a otra lista. En la propia línea del albarán:

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
- **Lo no reconocido es lo único que pide acción**, y con botón grande — nunca un enlace de texto.

### 3.3 Confirmar: bloqueado si algo no entraría a stock

Hoy se puede confirmar con *"0 entrarán a stock"* escrito en gris. **No debe poderse.**
- Bloqueado mientras haya líneas con cantidad y sin artículo o sin formato.
- Mensaje concreto: *"2 líneas no entrarán a stock: falta el artículo."*
- **Descartar una línea es un acto deliberado** ("no inventariar"), nunca el resultado de no hacer
  nada.

### 3.4 Criterio de personal (restricción, no preferencia)

Julio: *"las capacidades profesionales del personal son muy bajas; no les pidas lógica. O les vas
guiando paso a paso o les bloqueas. Si hay decisión, hay error."*

→ **Lo que se puede deducir, se deduce.** Lo que no, se pregunta con botones grandes y opciones
visualmente distintas. Nada que exija interpretar. Y si algo no cuadra, se bloquea y se avisa al
encargado — nunca una salida ambigua.

---

## 4. Qué NO cambia (y por qué)

- **El OCR se queda.** Es la ventaja competitiva: el albarán llega en papel.
- **El enlace pedido↔recepción se queda** (recién arreglado hoy, PR #54). Cuando hay pedido, el
  formato y lo esperado ya vienen dados: es la mejor defensa contra el error de formato, mejor que
  cualquier validación posterior.
- **`receipt_approval='oficina'` se respeta** si el cliente lo quiere. Pero **el borrador ya lleva
  todo resuelto**: la oficina revisa y confirma, no completa datos que no puede conocer.
  ⚠️ Quien ve la mercancía es el del muelle. La oficina no sabe si llegaron 6 cajas o 480 panes.

---

## 5. Fases

| Fase | Contenido | Riesgo | Valor |
|---|---|---|---|
| **R1** | `supplier_line_mapping` + **siembra desde el histórico** (681 líneas ya casadas) + resolución automática al escanear | bajo, solo lectura al escanear | **Elimina el 87,6 % del casado desde el primer albarán** |
| **R2** | Casado y formato **en la propia línea**; fuera el modal aparte | medio: pantalla en uso diario | Se acaba el "todo es texto" |
| **R3** | **Fusionar confirmar + meter al stock**; fuera el botón rojo | medio: toca el flujo | Un albarán confirmado está en stock. Sin limbo |
| **R4** | Aprender en cada confirmación (escribir/actualizar la memoria) | bajo | No vuelve a preguntarse lo resuelto |

**R1 es la que más devuelve por lo que cuesta**, y no toca la operación: se siembra del histórico y
empieza a resolver sola.

⚠️ **Los 14 albaranes atascados de hoy**: tras R1, la mayoría se resolverán solos al reabrirlos
(85 de 97 líneas tienen casado conocido). Los 12 realmente nuevos se hacen a mano una vez.

---

## 6. Por qué esto importa más que casi todo

Sin recepción fiable no hay coste fiable; sin coste no hay escandallo, ni food cost, ni AvT, ni T7,
ni pedidos automáticos. **Es el cimiento del diferencial de Folvy** — inventario perpetuo con coste
real— y hoy es el paso donde el dato se pierde o se corrompe.

Y para vender: **ningún competidor combina OCR de albarán en papel + memoria de casado + entrada a
stock en un solo acto.** Los que tienen memoria (MarketMan) no tienen OCR; los que evitan el casado
(Crunchtime) exigen EDI, que el proveedor español pequeño no tiene. **Ese hueco es real y está
vacío.**

---

## 7. Pendiente de Julio

1. Aprobar el diseño y el orden de fases.
2. **Decisión:** ¿la memoria de casado casa **sola** en coincidencia exacta de texto (recomendado),
   o propone y espera confirmación la primera vez de cada proveedor?
3. **Decisión:** al fusionar confirmar+stock, ¿se mantiene el borrador para el flujo de dos pasos de
   `receipt_approval='oficina'`, o se elimina también ese paso para clientes que no lo necesiten?
