# ENCARGO CODE — Recepción: el formato deja de ser un enlace ciego

**Fecha:** 2026-08-12 · **Rama nueva:** `fix/recepcion-selector-formato`
⚠️ **Depende de `fix/enlace-pedido-recepcion` (commit `c58254e`)** — misma pantalla
(`GoodsReceiptForm.tsx`). Ramifica **desde ella**, no desde main, o habrá conflicto.

---

## 1. El problema, visto en pantalla (ALB-00105, 12/08)

Dos líneas de un albarán real de Cloudtown, tal como las ve quien recepciona:

```
Servilleta master servis
formato: —
Recibido (cuéntalo)  [ 2 ]     € / formato [ 41.507 ]
elige formato ↑                                        ← enlace de texto diminuto

SALSERA PP+ TAPA BISABRA 2 OZ 60ml
formato: —
Recibido (cuéntalo)  [ 8 ]     € / formato [ 1.14 ]
elige formato ↑

2 con cantidad · 0 entrarán a stock · 2 sin mapear
```

**Tres fallos, y los tres los señaló Julio:**

1. **"elige formato ↑" no funciona.** Es un enlace de texto minúsculo y al pulsarlo no pasa nada
   útil. La flecha apunta a un sitio al que no lleva.
2. **No dice qué formato hay seleccionado** — pone `formato: —` y ya. Se trabaja a ciegas.
3. **No hay camino para crear un formato** cuando el artículo no tiene ninguno. Y ese caso es real:
   *Rollo Papel Seca Manos*, *Bolsa Marrón Con Asas*, *Papel Aluminio 44x200*, *Espátula Plancha*
   son artículos de compra **sin ningún formato activo** (verificado por MCP). Aunque el enlace
   funcionara y abriera una lista, aparecería **vacía** y el operario seguiría atascado.

**Y el sistema lo sabe y deja pasar:** *"0 entrarán a stock · 2 sin mapear"* está escrito en la
propia pantalla, en gris, y aun así se puede confirmar. Ese albarán se registraría sin tocar
inventario ni coste.

---

## 2. Criterio de diseño (no negociable)

**Julio, sobre el personal:** *"las capacidades profesionales del personal son muy bajas; no les
pidas lógica. O les vas guiando paso a paso o les bloqueas. Si hay decisión, hay error."*
Y sobre esta pantalla: *"si fuera un botón más grande, más comercial, y que te mandara a los
formatos o a crear un formato serían muchos menos errores; igual si informara qué formato tiene
seleccionado — ir a ciegas es error seguro."*

→ **Nada de enlaces de texto. Nada de estados mudos. Ningún camino sin salida.**

---

## 3. Qué hay que construir

### 3.1 El formato siempre visible
- **Con formato asignado:** mostrarlo **grande y legible**, con su equivalencia y el coste unitario
  que resulta:
  > **Caja · 4.500 uds** — 41,51 € → **0,0092 €/ud**
  Que el operario **vea el resultado** es la mejor defensa: un coste absurdo se nota mirándolo.
- **Sin formato:** no `formato: —` en gris. Un aviso claro de que **esa línea no entrará a stock**
  si se deja así.

### 3.2 Botón grande, no enlace
Sustituir `elige formato ↑` por un **botón de ancho completo**, del sistema de diseño, con verbo
claro: **"Elegir formato"** / **"Cambiar formato"** según haya o no.
Tamaño mínimo de toque cómodo — se usa en el muelle, de pie, con prisa y a veces con guantes.

### 3.3 El selector: lista + crear, siempre
Al pulsar, hoja/modal con:
- **Los formatos activos del artículo**, en tarjetas grandes: nombre, equivalencia en unidad base,
  y **el coste unitario que saldría con la cantidad y el importe ya introducidos**. Eso convierte
  la elección en comparación visual, no en cálculo mental.
- **Siempre, al final: "Crear formato nuevo"** — con nombre y cuántas unidades base contiene.
  Es obligatorio: hay artículos de compra sin ningún formato.
- Si el artículo **no tiene ninguno**, la hoja abre directamente en crear, sin lista vacía.

⚠️ **Un formato creado aquí se guarda en el artículo** (`recipe_item_purchase_format`), no solo en
esta línea: la próxima recepción ya lo tendrá.

### 3.4 Preselección cuando se pueda deducir
- **Un solo formato activo** → **preseleccionado**, no se pregunta.
- **Varios** → preseleccionar **el más usado en recepciones anteriores de ese artículo**, marcado
  como *"el habitual"*. El operario confirma en vez de elegir.
- **Ninguno** → botón en estado de aviso, imposible de pasar por alto.

### 3.5 Confirmar con líneas sin formato: bloqueado
Hoy se puede confirmar con *"0 entrarán a stock"*. **No debe poderse.**
- Botón de confirmar deshabilitado mientras haya líneas con cantidad y sin formato.
- Mensaje concreto, no genérico: *"2 líneas no entrarán a stock: falta el formato."*
- **Excepción explícita**, no implícita: para descartar una línea a conciencia (algo que no se
  inventaría), un control claro de **"no inventariar esta línea"**. Descartar debe ser un acto
  deliberado, nunca el resultado de no hacer nada.

---

## 4. Verificación

1. Línea con **un** formato activo → sale preseleccionado, con equivalencia y **coste unitario
   resultante** a la vista.
2. Línea con **varios** (p. ej. *Servilletas 30 x 40*: Paquete=150 · Caja=4500) → sale el habitual,
   y el selector muestra los dos con su coste unitario resultante.
3. Línea **sin ninguno** (p. ej. *Bolsa Marrón Con Asas*) → la hoja abre en crear; al guardar, el
   formato queda en el artículo y se puede comprobar en otra recepción.
4. **Confirmar está bloqueado** mientras quede una línea con cantidad y sin formato; el mensaje dice
   cuántas y por qué.
5. Marcar "no inventariar" una línea → deja confirmar, y esa línea **no entra a stock** a propósito.
6. **No regresión:** una recepción con todo mapeado se confirma igual que hoy y mueve stock y coste.
7. Caso real de prueba: **ALB-00105**, con *Servilleta master servis* (albarán: "CAJA DE 4500
   UNIDADES", 2 bultos, 41,507 €) → al elegir *Caja (=4500)* debe salir **0,0092 €/ud**.

⚠️ **Avisar a Julio antes de confirmar cualquier recepción real:** mueve stock y coste.

---

## 5. Reglas
- Usar el **sistema de diseño existente**, no inventar componentes.
- **NO tocar el WIP de Julio:** `ticketRenderer.ts`, `DailyCountWizard.tsx`, migraciones
  `20260811T2200` / `T2201`.
- Worktree aislado. `tsc -b` limpio (no `--noEmit`). Ficheros completos, TS strict.
- **No mergear.** Julio verifica en pantalla.
- Punto de verificación no ejecutable → se reporta **NO EJECUTADO**.

---

## 6. Por qué esto importa

El formato es lo que convierte *"2 bultos"* en *"9.000 servilletas"*. Si falla, el coste unitario
sale multiplicado o dividido por miles y **contamina todos los escandallos que usen ese artículo**.
Es la misma raíz del caso del Pan de Pita: 480 unidades tratadas como 480 cajas → coste ×80 abajo →
toda la carta de Meraki descuadrada, y la Pita Mixta aparentando un 91 % de margen.

Medido en producción: **27 de 129 artículos** tienen factores de conversión inconsistentes entre
recepciones, y **12 tienen el coste variando ×10 o más**.
