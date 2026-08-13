# ENCARGO CODE — Reparar el enlace pedido ↔ recepción (104 recepciones, 1 enlazada)

**Fecha:** 2026-08-12 · **Rama:** `fix/enlace-pedido-recepcion` · **Commit:** `c58254e` → **PR #54** (mergeado `df1e2d4`)
**Diseño relacionado:** `folvy_recepcion_un_paso_diseno_20260812.md`
**Estado:** ✅ mergeado y desplegado. Este doc fija el encargo tal como se mandó (reconstruido desde la sesión del 12/08; nunca se había guardado como fichero).

> **Diagnóstico ya cerrado** (RECON de Code + verificación por MCP, 12/08). No hay que investigar: es construcción.

---

## 1. El fallo, con la línea exacta

En `GoodsReceiptForm.tsx`:

```ts
const correcting = !!prefill                                   // ~línea 539
...
if (order || correcting) { setCandidateOrders([]); return }    // primera línea del efecto de candidatos
```

Y la sección entera del selector de pedido —**banner automático Y picker manual**— está condicionada
a `!correcting` (~línea 1690).

**Consecuencia:** cuando la oficina abre un borrador para confirmarlo, `prefill` viene relleno →
`correcting = true` → la búsqueda de candidatos **sale en la primera línea** y el bloque de enlazar
**no existe en el árbol renderizado**. En la sesión donde de verdad se confirma, **no hay ningún
camino, ni automático ni manual, para enlazar un pedido**.

### Por qué afecta al 100 % de las recepciones
Verificado por MCP: los dos locales activos tienen **`locations.receipt_approval = 'oficina'`**. Toda
recepción pasa por dos pasos —muelle crea borrador, oficina confirma— y el segundo es justo el que
tiene el enlace desactivado.

### La evidencia
| | |
|---|---|
| Recepciones por `ocr` | **104** · enlazadas: **1** |
| Recepciones `manual` | 1 · enlazadas: 0 |
| Pedidos | 46 (30 cancelados, 5 borrador, 2 enviados, 1 recibido) |

**Caso rector — PED-00036 vs ALB-00102/103/104:** mismo proveedor, mismo local, día siguiente,
**22 de 24 artículos coinciden (92 %)**, y PED-00036 era el **único** candidato de ese
proveedor+local. Los tres albaranes tardaron **más de una hora** entre creación y confirmación
(3.936 / 3.960 / 4.063 s): **no fue prisa**, fue que en la sesión de confirmación el enlace no existe.

---

## 2. Las tres correcciones (cubren los DOS modos de aprobación)

**Corrección 1 y 2 — modo `oficina` (Llorente29 hoy):** la raíz es la guarda `correcting`. El efecto
de candidatos y la sección del selector **no** deben desactivarse por venir de un borrador. Que el
banner automático y el picker manual estén disponibles al revisar el borrador.

**Corrección 3 — modo directo (otros clientes):** ahí el selector sí aparece, pero **el guardado
puede adelantar a la búsqueda** de candidatos. Es la única defensa en ese modo. Los dos retornos
tempranos del efecto deben **apagar `loadingOrders` explícitamente**; si no, una corrida cancelada a
medio fetch lo deja pegado en `true` y el botón de guardar no vuelve a habilitarse nunca (cambiar
"se guarda sin enlazar" por "no se puede guardar" es peor que el bug original).

**Preselección de candidato único:** separar el caso de **1 candidato** (enlaza solo siempre, sin
desempate) del de **2+** (desempate por solape de líneas, que solo tiene sentido con líneas de OCR
que comparar). La auto-selección corría solo en modo OCR; la revisión de un borrador en oficina no
pasa `ocrPrefill`, así que un candidato único en oficina se listaba igual que dos.

---

## 3. 🔴 El fix que salva el encargo entero (hallazgo de Code, no estaba en el diseño)

`updateGoodsReceipt` **nunca escribía `purchase_order_id`** — `GoodsReceiptUpdate` no tenía ese
campo. Aunque el formulario calcule `linkedOrderId` perfectamente, **la sesión donde se confirma lo
tiraba a la basura**: A y B habrían quedado cosméticas (el enlace se ve en pantalla y no se guarda).
Añadir el campo a `GoodsReceiptUpdate` + `receiptUpdateToRow` + la llamada en `persist()`.

---

## 4. Alcance y verificación

- **Sin migración:** cero backend, cero backfill de las 104 históricas. Solo 2 ficheros de cliente.
- **Verificación obligatoria en los DOS modos**, no solo en el que usa Llorente29.
- **La verificación en pantalla la hace Julio** (una recepción confirmada mueve stock y coste de
  verdad): abrir una recepción nueva de Cloudtown / Foodint Alcalá con un pedido en `enviado`; el
  pedido debe salir **preseleccionado** y `goods_receipt.purchase_order_id` debe quedar relleno al
  confirmar (era 1 de 107).

---

## 5. Por qué importa

El formato correcto viene del pedido. Enlazar pedido↔recepción es lo que **impide de raíz el error
del Pan de Pita** (480 unidades tratadas como 480 cajas → coste ×80). El del muelle sabe si llegaron
6 cajas o 480 panes; la oficina no. Por eso, en el modo directo, quien confirma es quien menos
formación tiene, y ahí el enlace (y el bloqueo por coste que vendrá después) importa aún más.
