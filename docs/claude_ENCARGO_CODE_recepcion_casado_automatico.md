# ENCARGO CODE — R1' · Que la recepción LEA la memoria que ya aprende

**Fecha:** 2026-08-12 · **Rama nueva:** `feat/recepcion-casado-automatico`
**Diseño:** `folvy_recepcion_un_paso_diseno_20260812.md` §1 y §4.2 · **Esta es la fase R1'**, la
primera y la que desbloquea las otras dos ramas de hoy.

---

## 0. Por qué esto es lo siguiente y no una fase más

Las dos ramas de hoy están **desplegadas y enterradas**:
- **PR #54** (enlace pedido↔recepción) — funciona; se ve el bloque *"¿De qué pedido viene?"*.
- **PR #55** (selector de formato) — **no se ve**. Verificado en pantalla con ALB-00105: sigue
  `formato: —`, sin botón, y *"Revisar y confirmar"* activo con *"0 entrarán a stock · 2 sin mapear"*.

**Causa:** las líneas están `sin mapear` (`recipe_item_id` null). Sin artículo no hay formatos que
ofrecer, así que tu bloque nuevo **ni se pinta**. El muro es el casado, no el formato.

> **Sin R1', el trabajo de PR #55 es inalcanzable.** No está entregado: está desplegado, que no es
> lo mismo.

---

## 1. 🔴 EL HALLAZGO: la memoria ya existe, aprende bien, y NADIE la lee

`learn_from_receipt(p_receipt_id)` está en producción y al confirmar escribe en `article_supplier`:
`supplier_item_name` (**el texto tal cual del albarán**), `supplier_code`, `purchase_format_id` y
`last_price` (€/base canónico).

**Y está poblada** (verificado por MCP, cuenta Llorente29):

| | |
|---|---|
| Filas | **248** |
| Con texto del albarán | 140 |
| Con código de proveedor | 173 |
| **Con formato** | **240** |

**Comprobación decisiva:** de las **97 líneas hoy sin casar, 85 (el 87,6 %) tienen texto idéntico
ya casado antes, con el mismo proveedor.** Ejemplos reales del modal que ve Julio:

| Texto del albarán | Ya casado con | Veces | Código proveedor | Formato aprendido |
|---|---|---|---|---|
| Cebolla roja | Cebolla Morada | 7 | `210203006` | bolsa (=1000) |
| Cilantro manojo | Cilantro | 10 | `210501036` | Manojo (=125) |
| Cebolla tierna fina manojo | Cebollino | 10 | — | — |
| Aceite girasol 25 LT | Aceite Alto Oleico | 8 | — | — |

**El sistema pregunta 10 veces lo mismo teniendo la respuesta guardada.** No falta memoria: falta la
consulta.

⚠️ **NO crear ninguna tabla nueva.** El diseño original proponía `supplier_line_mapping`; **sobra
entera**. Todo está en `article_supplier`.

---

## 2. Qué hay que construir

### 2.1 Resolver al escanear — orden de más fiable a menos

En el flujo OCR, para cada línea sin `recipe_item_id`, buscar en `article_supplier` **filtrando por
`supplier_id` del albarán** (la memoria es por proveedor: "Cebolla roja" de dos proveedores pueden
ser artículos distintos):

1. **`supplier_code` exacto** → casa solo. Confianza máxima. *(173 filas lo tienen)*
2. **`supplier_item_name` exacto normalizado** → casa solo. *(Aquí caen los 85 de hoy.)*
   Normalizar igual en los dos lados: minúsculas, sin acentos, espacios colapsados, `btrim`.
3. **Texto parecido** (el `fuzzy` que ya existe) → **propone**, marca `map_needs_review = true`,
   **no bloquea**.
4. **Nada** → única línea que pide acción al operario.

**Siempre arrastra `purchase_format_id`** junto con el artículo. Casar sin formato no sirve: es
justo lo que deja la línea a medias hoy.

Rellenar `map_source` con el criterio usado (`code` / `learned` / `fuzzy`) — el campo ya existe y
admite esos valores.

### 2.2 Caso extra detectado — memoria con artículo pero sin texto
Verificado: la relación **Cloudtown → Servilletas 30 x 40 → Caja (4500)** existe en
`article_supplier` **con `supplier_item_name` a null**. Tiene el artículo y el formato correctos,
pero no el texto por el que buscar.

→ Cuando el texto del albarán no case por 1-3 pero exista **una única fila de ese proveedor** cuyo
artículo encaje razonablemente por nombre, **proponerla** (nunca casado silencioso: `needs_review`).
Al confirmar, `learn_from_receipt` aprenderá el texto y la próxima vez casará por la vía 2.

### 2.3 Lo casado automáticamente es SIEMPRE modificable
*(decisión de Julio: "siempre que coincida, mejor casado automático, pero con la opción de
modificarlo a voluntad")*
En la propia línea, junto al artículo resuelto, un **[Cambiar]** visible. Nunca un casado que no se
pueda deshacer.

### 2.4 La línea muestra lo que ha resuelto
No basta con casar por dentro. La línea debe verse resuelta:
```
Servilleta master servis                          ✓ reconocido
→ Servilletas 30 x 40 · Caja (4.500 ud)            [Cambiar]
Recibido [ 2 ] cajas   41,51 €  →  0,0092 €/ud
```
**El coste unitario resultante siempre visible.** Es la mejor defensa contra el error de formato: un
`0,0037 €/ud` de pan se ve mal a simple vista (caso real del 5/08 que descuadró toda la carta de
Meraki).

---

## 3. Fuera de alcance (NO tocar en este encargo)
- `learn_from_receipt` — funciona bien, no se toca. Solo hay que **leerla**.
- El paso "Meter al stock" y su fusión con confirmar → **R3**, encargo aparte.
- Puntos de pedido → **R5**, depende de que esto y R3 estén hechos.
- **Sin migración ni backfill.** Cero cambios de backend si se puede resolver en cliente; si hace
  falta una RPC de lectura, que sea **solo lectura**.

---

## 4. Verificación

1. **ALB-00105** (Cloudtown / Carabanchel) — el caso rector de Julio:
   *Servilleta master servis* debe quedar **reconocida** (vía §2.2), con formato **Caja (4.500)** y
   mostrando **0,0092 €/ud** (41,507 ÷ 4500).
2. **ALB-00107** — de sus 12 líneas sin casar, *Cebolla roja*, *Cilantro manojo*, *Cebolla tierna
   fina manojo* y *Aceite girasol 25 LT* deben casar **solas**. Reporta cuántas de las 12 se
   resuelven sin intervención.
3. **Aislamiento por proveedor:** una línea con texto conocido pero de **otro** proveedor **NO**
   debe casar por la vía 2.
4. **Lo casado se puede cambiar** desde la línea.
5. **No regresión:** una línea sin memoria sigue pidiendo acción, y una ya casada a mano no se pisa.
6. **Medida global:** de las **97 líneas** hoy sin casar, cuántas resuelve el automático. La
   expectativa medida es **~85**. Si sale muy por debajo, **PARA y avisa** — no ajustes el número.

⚠️ **Confirmar una recepción mueve stock y coste real.** Avisar a Julio antes de confirmar nada;
para verificar el casado basta con abrir la pantalla, sin confirmar.

---

## 5. Reglas
- Worktree aislado. `tsc -b` limpio (no `--noEmit`). Ficheros completos, TS strict.
- **NO tocar el WIP de Julio:** `ticketRenderer.ts`, `DailyCountWizard.tsx`, migraciones
  `20260811T2200` / `T2201`.
- **No mergear.** Julio verifica en pantalla.
- Punto de verificación no ejecutable → **NO EJECUTADO**, nunca "superado".
- Declara el estado git al terminar.

---

## 6. La regla que sale de la sesión del 12/08 y aplica a este encargo

En una sola sesión aparecieron **seis** piezas construidas, correctas y **desconectadas**:
`negotiated_price` (no alimenta el coste) · `price_drift_for` (avisa, nunca bloquea) ·
`autoclose_daily_count` (nadie la llamaba) · `learn_from_receipt` (nadie la consulta) ·
P1 ciclo de compra (el enlace no estaba donde se confirma) · `stock_level` (vacía).

> **Ninguna pieza se da por terminada hasta que algo la consume y se ha verificado con datos reales
> que la consume.** Un `create function` en verde no es una entrega.

Aplicado aquí: **este encargo no está hecho cuando el código compile, sino cuando ALB-00105 muestre
la servilleta reconocida con su formato y su coste unitario en pantalla.**
