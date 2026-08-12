---
name: folvy_coste_recepcion_blindaje_diseno_20260812
description: DISEÑO para arreglar la raíz de que los costes de Folvy se corrompan solos en cada recepción. RECON del 12/08 (27 de 129 artículos con factor de conversión inconsistente, 12 con coste variando ×10 o más) + RECON adicional del mismo día que corrige el alcance: negotiated_price y price_drift_for YA EXISTEN y ya están cableados en GoodsReceiptForm.tsx como avisos — el trabajo real no es construir el cálculo, es convertir el aviso en bloqueo y moverlo al servidor. Leer antes de tocar goods_receipt_line, qty_in_base, computed_cost, negotiated_price o confirm_goods_receipt.
sources:
  - cowork
  - claude (RECON adicional 12/08, mismo día: confirma qué de la solución propuesta ya existe en producción y corrige el alcance de las fases)
---

# Blindaje del coste de recepción — DISEÑO

> **Estado: RECON ✅ medido en producción 12/08 (dos rondas, la segunda corrige el alcance) ·
> PENDIENTE DE APROBACIÓN CON LAS FASES YA CORREGIDAS.**
> Julio: *"hay algo que está destrozando a Folvy y dejándolo sin ninguna fiabilidad, las
> recepciones destrozan los costes y es una y otra y otra vez, no hay forma de arreglarlo"*.
> **Tiene razón, y no es un dato mal metido: es un fallo de diseño que se repite solo.**
>
> **Corrección sobre la primera versión de este documento:** la primera ronda de RECON diagnosticó
> bien el síntoma pero no comprobó qué maquinaria ya existía. Hay una segunda ronda, el mismo 12/08,
> que sí lo hizo: **buena parte de "Capa 3 / Vigía" y de "coste de referencia" ya está construida y
> en producción.** No hace falta levantarla desde cero. El diseño de abajo ya viene con las fases
> corregidas a partir de eso — es lo que hay que aprobar.

---

## 1. El caso que lo destapó — Pan de Pita

| Recepción | `qty_received` | `qty_in_base` | `unit_cost` | Coste/ud resultante |
|---|---|---|---|---|
| 19/06 · ALB-00019 | **6** (cajas) | 480 uds | 26,40 € (caja) | 0,33 € ✅ |
| 23/06 · ALB-00025 | **4** (cajas) | 320 uds | 26,40 € | 0,33 € ✅ |
| **05/08 · ALB-00090** | **480** (¡unidades!) | **38.400** | 0,30 € (unidad) | **0,0037 €** 🔴 |

El 5 de agosto alguien recepcionó **en unidades** en vez de en cajas. El sistema **aplicó igualmente
el factor ×80 del formato**, dando 38.400 panes, y con el precio unitario el coste se desplomó 80
veces.

**Efecto en cascada:** la Pita Mixta pasó a costar 2,17 € y a aparentar un 91 % de margen. Al
corregir el pan a 0,30 €, el plato subió a 2,46 € (17,7 % de food cost) y **toda la carta de Meraki
se recalculó sola**. Un solo dato movió 20 platos.

**Y lo peor, que es lo que dice Julio:** la corrección de hoy dura hasta la próxima entrega de pan.
Si vuelve a recepcionarse en unidades, vuelve a romperse.

---

## 2. RECON: el alcance (medido, 129 artículos con recepciones)

| | |
|---|---|
| Artículos con **factor de conversión inconsistente** entre recepciones | **27 de 129 (21 %)** |
| Artículos con el **coste unitario variando ×10 o más** | **12** |

**No es un fallo, son dos:**

**A · Se recepciona en formatos distintos y nada lo distingue**
- *Agua Mineral 50 CL*: factores **1** y **24** · coste entre 0,14 € y 13,28 € — **ratio 95**
- *Bacon Ahumado*: 1000 (kg) vs 5000 (caja de 5 kg) · 5,82 € → 69,43 €
- *Queso Gouda*: 1000 vs 6000 · 17 recepciones, ratio 8

**B · El formato del artículo cambia y las recepciones viejas quedan con el antiguo**
- *Kebab Ternera*: 10000 vs 8000 · *Milanesa de Pollo*: 20 vs 6 · *Lechuga Romana*: 1000 vs 400

### La raíz, en una frase
> **El sistema aplica el factor del formato de compra sin comprobar que la cantidad introducida
> sea de ese formato.** Nadie verifica que 480 unidades de pan no pueden ser 480 cajas.

Y no hay ninguna defensa posterior: un coste que cae 80 veces **se acepta en silencio** y recalcula
medio catálogo.

### La raíz de raíces (RECON adicional 12/08)
La frase de arriba dice *qué* pasa. Esto dice *por qué puede pasar sin que nada lo pare*:
**`qty_in_base` se calcula en el CLIENTE** (`qtyInBaseFromFormat`/`unitConversion.ts`), y
**`confirm_goods_receipt` se fía de lo que le manda el navegador, sin recomprobarlo en servidor.**
Esta deuda ya estaba declarada en `CONTEXTO_CLAUDE.md` el 24/06 ("que la recepción al CONFIRMAR no
permita 'confirmar y olvidar' en silencio… requiere RECON de `confirm_goods_receipt` + benchmark
blind-receiving") — siete semanas antes de este documento, sin resolver todavía. Un cliente puede
mandar cualquier cosa: un bug de UI, una caché de formato antigua, un desplegable mal tocado. Todo
lo que sigue depende de que esto se cierre en algún punto de la Capa 1 (§3).

---

## 3. Lo que YA EXISTE — RECON adicional del 12/08

Antes de diseñar la solución, esto es lo que **ya está construido y en producción**, cableado en la
propia pantalla de recepción (`GoodsReceiptForm.tsx`):

| Pieza | Qué hace | Dónde vive |
|---|---|---|
| `article_supplier.negotiated_price` | Precio **fijado y aprobado**, independiente del último recibido. **44 de 248 artículos** lo tienen poblado hoy. | Columna, editable en la ficha del ingrediente |
| `price_drift_for(cuenta, artículo, meses)` | Mediana de las últimas recepciones + % de desviación del último coste frente a esa mediana | Función SQL, `STABLE` |
| `negotiatedAlertFor` / `driftAlertFor` | Pintan avisos en la pantalla de recepción: "🤝 por encima de lo pactado", "📈 tendencia al alza" | `GoodsReceiptForm.tsx`, umbral por defecto `driftAlertPct: 25` |

**Es decir: la maquinaria de "coste de referencia" y de "vigía" ya existe.** Lo que el diseño
original de este documento proponía construir desde cero, en gran parte **ya está.**

### Entonces, ¿por qué no funcionó con el Pan de Pita?
Porque **`negotiatedAlertFor`/`driftAlertFor` son un aviso, nunca un bloqueo.** Son badges
informativos en un panel resumen — "🤝 N artículo(s)…", "📈 N artículo(s)…" — que se pueden no
mirar, o mirar y confirmar igual. No hay ningún `disabled` de confirmación ligado a ellos. Un error
de ×80 se muestra exactamente con la misma severidad visual que una subida de proveedor del 26 %
(el umbral del 25 % no distingue "raro" de "imposible"), y en ningún caso impide nada.

**Consecuencia para el diseño:** no hay que reconstruir el cálculo de mediana ni la columna de
referencia — eso ya existe y funciona. Hay que:
1. Que `computed_cost` **use** `negotiated_price` cuando el real diverja (hoy no lo usa: el
   escandallo se calcula igual, el badge es solo informativo y no toca el coste).
2. Convertir el aviso de recepción en un **bloqueo real**, no una nota.
3. Mover esa comprobación **al servidor** (dentro de `confirm_goods_receipt`), cerrando de paso la
   deuda del 24/06 — un cliente que ya no puede recibir directamente el factor no puede mandar
   cualquier cosa aunque tenga un bug.

---

## 4. La solución en tres capas, con el alcance corregido

Ninguna sola basta. Las tres siguen siendo la tríada del proyecto: **en caliente · barrido · vigía**
— pero el tamaño de cada una ya no es el que parecía antes del RECON adicional.

### Capa 3 — VIGÍA: construida al 90 %, falta la parte proactiva
`price_drift_for` ya calcula exactamente lo que hace falta. Lo que falta es que alguien lo mire sin
tener que estar recibiendo ese artículo ese día:
- Alarma si un artículo cambia de coste **más de ×2 entre recepciones consecutivas** — reutiliza
  `price_drift_for`, no un cálculo nuevo.
- Alarma si un artículo se recepciona con **un factor distinto al de su formato activo** — esto sí
  es nuevo (hoy no se compara el factor usado contra el vigente, solo el coste resultante).
- **Informe semanal** de artículos con coste inestable, EMPUJADO (email/notificación), no solo
  visible si alguien entra a mirar. Esta es la pieza que falta de verdad: hoy el dato existe pero
  es pasivo, nadie lo va a buscar.

### Coste de referencia: la columna ya existe, falta que blinde el escandallo
`negotiated_price` ya está. Lo nuevo es exclusivamente:
1. **Blindar el escandallo de verdad.** Cuando el coste real diverja demasiado del de referencia
   (mismo umbral que la Capa 1, §4.2 más abajo), `computed_cost` **usa el de referencia**, no el
   real corrompido. Hoy `negotiated_price` solo alimenta el badge de la pantalla de recepción — no
   toca el escandallo en ningún punto. Ese es el trabajo real de esta pieza.
2. **Cubrir el hueco de cobertura.** Solo 44 de 248 artículos tienen `negotiated_price` hoy — para
   los otros 204 no hay nada que blinde el escandallo si su coste real se corrompe. Sembrarlo con la
   **mediana de las últimas 3 recepciones válidas** de cada artículo (recomendado en §6) para que la
   protección no dependa de que alguien lo rellene a mano uno a uno primero.
3. Sirve también para **medir la deriva real de precios** (ya lo hace, vía `price_drift_for`) y
   **distinguir** error de recepción (÷3 o ×3, brusco) de subida de proveedor (5–30 %, sostenida) —
   la tabla de la versión anterior de este documento sigue siendo válida:

| Divergencia | Qué significa | Acción |
|---|---|---|
| ×3 o más, brusca | **Error de recepción** | Bloquear y preguntar (Capa 1) |
| 5–30 %, sostenida | **El proveedor ha subido** | Avisar: revisar precio de venta o proveedor |

### Capa 1 — EN CALIENTE: la pieza genuina, y con más alcance del que se le dio al principio
Esta es la única capa que de verdad no existe todavía, y ahora incluye dos cosas, no una:

**4.1 — El aviso se convierte en bloqueo real.**
Al grabar una línea, comparar el **coste por unidad base** resultante con el histórico del artículo
(mediana de las últimas N recepciones válidas, vía `price_drift_for` — reutilizado, no reinventado):
- Divergencia **> ×3 o < ÷3** → **la línea NO se acepta en silencio**. Se marca `needs_review` y se
  pregunta en pantalla:
  > *"Pan de Pita: el coste sale a 0,0037 €/ud y las últimas compras fueron a 0,33 €/ud (90 veces
  > menos). ¿Has recibido **480 cajas** o **480 unidades**?"*
  Con dos botones que **corrigen el factor**, no el precio.
- Es la pregunta clave: el operario **sí sabe** qué le han traído. Hoy no se le pregunta nunca —
  solo se le informa, y de forma que no interrumpe nada.
- Primera recepción de un artículo (sin histórico) → se acepta, pero se marca para revisión.

**Por qué esto y no validar el factor:** el formato puede ser correcto y la cantidad estar en otra
unidad. Lo único que delata el error **es el resultado**, no los datos de entrada.

**4.2 — La comprobación se mueve al servidor.**
Hoy `qty_in_base` lo calcula el cliente y `confirm_goods_receipt` se lo cree. El bloqueo del punto
anterior, si vive solo en el cliente, es una capa de pintura sobre la misma grieta: un bug de UI, una
caché vieja o una llamada directa a la RPC lo saltarían igual que hoy salta el aviso. Por eso la
Capa 1 real incluye mover la comprobación **dentro de `confirm_goods_receipt`** (o una función que
llame antes de postear el movimiento): el servidor recalcula/valida `qty_in_base` contra el formato
vigente y contra la mediana histórica, y si diverge más del umbral, la función devuelve el estado de
bloqueo en vez de confirmar en silencio. Esto cierra a la vez la deuda declarada el 24/06.

### Capa 2 — BARRIDO: sin cambios de fondo, ahora con mejor referencia
Recalcular `qty_in_base` de las recepciones cuyo factor no cuadra con el formato vigente, y
re-derivar `computed_cost`. **No se hace a ciegas:** primero un informe de los 27 artículos con lo
que cambiaría cada uno, y Julio aprueba. Con la Capa "coste de referencia" ya construida, el barrido
tiene además contra qué comparar cada corrección propuesta, no solo el formato vigente.
⚠️ **Cuidado con la frontera de inventario**: un recálculo retroactivo no puede escribir por detrás
de un recuento aprobado (misma regla que el consumo de ventas).

---

## 5. La pregunta que hay que responder: si el aviso no se atendía, ¿por qué el bloqueo sí?

Es la pregunta correcta y la respuesta tiene que quedar escrita, no dada por hecha.

**El aviso de hoy y el bloqueo propuesto no son el mismo mecanismo con distinta intensidad — son
mecanismos de naturaleza distinta:**

- El aviso de hoy es **un resumen pasivo**: un badge en un panel, "🤝 N artículo(s)…". Se puede no
  mirar. Se puede mirar y decidir "ya lo reviso luego". No impide nada — la recepción se confirma
  igual, con el coste roto ya escrito en `stock_movement` y ya propagado a `computed_cost`.
- El bloqueo propuesto es **una pregunta concreta con dos respuestas posibles** — "480 cajas" /
  "480 unidades" — colocada **en el camino crítico del gesto que el operario ya tiene que hacer
  para terminar** (confirmar la recepción). No hay "no verlo": está donde tiene que tocar para
  seguir. No hay "ya lo reviso luego": sin contestarla, no hay recepción confirmada, y sin recepción
  confirmada no entra el stock — así que tampoco se puede "confirmar y pasar de largo" por
  necesidad operativa (el stock hace falta para seguir vendiendo).

La diferencia no es de severidad visual (rojo en vez de ámbar) ni de redacción (más alarmante). Es
que uno es **información que se puede ignorar** y el otro es **un requisito de la transacción**. Y
la pregunta la puede responder quien está delante del pedido — es la única persona que sabe si lo
que tiene en el carro son cajas o unidades — así que responderla no es fricción añadida sin sentido:
es la única persona con el dato que falta, en el único momento en que lo tiene a la vista.

---

## 6. Fases (corregidas)

| Fase | Contenido | Riesgo | Ya existe |
|---|---|---|---|
| **R1** | **Vigía**: alarma de factor distinto al vigente + informe semanal empujado. El cálculo de mediana/deriva (`price_drift_for`) ya está. Solo lectura. | ninguno | ✅ 90 % |
| **R2** | **Coste de referencia protege el escandallo**: `computed_cost` usa `negotiated_price` cuando el real diverge + siembra por mediana para los 204 artículos sin poblar. La columna y el precio pactado ya existen. | bajo | La columna sí, el uso en el escandallo no |
| **R3** | **Capa 1**: bloqueo real (pregunta con 2 botones, no confirma sin responder) **+ mover `qty_in_base`/la validación al servidor** (`confirm_goods_receipt`). Toca la pantalla que usa el equipo a diario Y cierra la deuda de raíz del 24/06. | medio-alto: pantalla diaria + cambio de dónde vive la lógica | No — pieza genuina |
| **R4** | **Barrido** (Capa 2): reparar el histórico, con informe previo y aprobación. Se apoya en el coste de referencia de R2 para decidir qué es correcto. | medio: recálculo masivo | No |

**R1 y R2 no tocan la operación diaria — y R1 es casi trabajo de fontanería, no de diseño nuevo.
R3 es el que de verdad lo arregla, y el que más toca.**

---

## 7. Por qué esto va antes que casi todo

Sin costes fiables **no valen**: los escandallos, el food cost, el AvT, T7 entero, los pedidos
automáticos, ni la negociación con proveedores. Es el cimiento del diferencial de Folvy — el
inventario perpetuo con coste real— y hoy **se corrompe solo cada vez que llega una entrega**.

Es, con diferencia, la deuda técnica más cara del proyecto. Y una parte relevante de la solución
—la vigilancia, el precio de referencia— **ya estaba medio construida sin que nadie hubiera cerrado
el círculo hasta convertirla en algo que protege de verdad.**

---

## 8. Pendiente de Julio

1. **Aprobar el diseño con las fases ya corregidas** (R1 casi hecho, R2 acotado a "usar la columna
   que ya existe", R3 con el alcance ampliado a servidor).
2. **Umbral de bloqueo en la Capa 1:** propuesto ×3 / ÷3. Es el punto donde un error de formato
   (×24, ×80) siempre salta y una subida de proveedor normal (5–30 %) nunca molesta.
3. **Siembra de `negotiated_price` para los 204 artículos sin poblar** (R2): ¿mediana automática de
   las últimas 3 recepciones (recomendado, mismo criterio que T7), o fijarlos uno a uno?
4. **R3 toca la pantalla que el equipo usa a diario y mueve lógica al servidor** — más alcance que
   la versión anterior de este documento. ¿Confirmas que quieres ir a por las dos cosas juntas (UX +
   servidor) en la misma fase, o prefieres partirlo (primero bloqueo en cliente, servidor después)?
